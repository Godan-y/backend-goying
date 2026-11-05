import logging
import unicodedata
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field

from dependencies import require_user_profile, require_verified_firebase_user
from firebase import db
from services.notification_service import send_notification


router = APIRouter()
logger = logging.getLogger(__name__)
BOOKING_COLLECTIONS = ("bookings", "carBookings", "propertyBookings")
PROVIDER_COLLECTIONS = {"chauffeurs", "providers"}
PROPERTY_BOOKING_COLLECTION = "propertyBookings"
CAR_BOOKING_COLLECTION = "carBookings"


class BookingReviewRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    booking_id: str = Field(min_length=1, alias="bookingId")
    rating: int = Field(ge=1, le=5)
    comment: str = Field(default="", max_length=1000)


def _normalized(value: object) -> str:
    return unicodedata.normalize("NFD", str(value or "").strip().lower()).encode(
        "ascii", "ignore"
    ).decode("ascii")


def _is_completed(booking: dict) -> bool:
    return _normalized(booking.get("status") or booking.get("statut")) in {
        "termine",
        "completed",
    }


def _has_server_completion_marker(collection_name: str, booking: dict) -> bool:
    marker_field = {
        "bookings": "adminCompletedAt",
        "carBookings": "completedAt",
        "propertyBookings": "completedAt",
    }.get(collection_name)
    return bool(marker_field and _is_completed(booking) and _timestamp_to_iso(booking.get(marker_field)))


def _timestamp_to_iso(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if hasattr(value, "to_datetime"):
        converted = value.to_datetime()
        if isinstance(converted, datetime):
            return converted.astimezone(timezone.utc).isoformat()
    return None


def _find_booking(collection_name: str, booking_id: str) -> dict | None:
    if collection_name not in BOOKING_COLLECTIONS or not booking_id:
        return None
    snapshot = db.collection(collection_name).document(booking_id).get()
    return snapshot.to_dict() if snapshot.exists else None


@router.get("/api/public-reviews")
def list_public_reviews():
    reviews = []
    snapshots = db.collection("reviews").order_by(
        "createdAt", direction=firestore.Query.DESCENDING
    ).limit(12).stream()

    for snapshot in snapshots:
        review = snapshot.to_dict() or {}
        comment = str(review.get("comment") or "").strip()
        booking = _find_booking(
            str(review.get("bookingCollection") or ""),
            str(review.get("bookingId") or ""),
        )
        if not comment or booking is None or not _is_completed(booking):
            continue

        rating = review.get("rating")
        if not isinstance(rating, int) or not 1 <= rating <= 5:
            continue

        created_at = _timestamp_to_iso(review.get("createdAt"))
        reviews.append(
            {
                "id": snapshot.id,
                "rating": rating,
                "comment": comment,
                "serviceType": str(booking.get("serviceType") or "Service Goying"),
                "itemName": str(booking.get("itemName") or ""),
                "createdAt": created_at,
            }
        )

    return {"reviews": reviews}


@router.post("/api/booking-reviews", status_code=status.HTTP_201_CREATED)
def create_booking_review(
    request: BookingReviewRequest,
    background_tasks: BackgroundTasks,
    firebase_user: dict = Depends(require_verified_firebase_user),
    _user_profile: dict = Depends(require_user_profile),
):
    transaction = db.transaction()

    @firestore.transactional
    def save_review(transaction):
        booking_record = None
        for collection_name in BOOKING_COLLECTIONS:
            reference = db.collection(collection_name).document(request.booking_id)
            snapshot = reference.get(transaction=transaction)
            if snapshot.exists:
                booking_record = (collection_name, reference, snapshot.to_dict() or {})
                break

        if booking_record is None:
            raise HTTPException(status_code=404, detail="Réservation introuvable")

        booking_collection, booking_reference, booking = booking_record
        if not _has_server_completion_marker(booking_collection, booking):
            raise HTTPException(
                status_code=403,
                detail="Un avis peut être laissé uniquement après la fin de la prestation",
            )

        booking_client_uid = str(booking.get("clientUid") or booking.get("clientId") or "")
        booking_client_email = str(booking.get("clientEmail") or "").strip().lower()
        firebase_email = str(firebase_user.get("email") or "").strip().lower()
        owns_by_uid = bool(firebase_user.get("uid")) and booking_client_uid == firebase_user.get("uid")
        owns_by_verified_email = (
            firebase_user.get("email_verified") is True
            and bool(firebase_email)
            and booking_client_email == firebase_email
        )
        if not owns_by_uid and not owns_by_verified_email:
            raise HTTPException(
                status_code=403,
                detail="Vous ne pouvez évaluer que vos propres réservations",
            )

        provider_id = str(booking.get("providerId") or "").strip()
        provider_collection = str(booking.get("providerCollection") or "").strip()
        has_provider = bool(provider_id and provider_collection in PROVIDER_COLLECTIONS)
        service_type = _normalized(booking.get("serviceType"))
        is_property_booking = (
            booking_collection == PROPERTY_BOOKING_COLLECTION
            and service_type == "immobilier"
        )
        is_car_rental = (
            booking_collection == CAR_BOOKING_COLLECTION
            and service_type == "automobile"
        )
        is_provider_service = (
            booking_collection == "bookings"
            and has_provider
            and service_type in {"chauffeur", "service a la personne"}
        )
        has_provider = is_provider_service
        if not (is_provider_service or is_property_booking or is_car_rental):
            raise HTTPException(
                status_code=403,
                detail="Cette réservation ne peut pas recevoir d'avis",
            )

        aggregate_reference = None
        aggregate_data = None
        aggregate_fields = ("rating", "reviewsCount")
        aggregate_id = None
        if is_property_booking:
            aggregate_id = str(booking.get("propertyId") or booking.get("bien_id") or "").strip()
            aggregate_collection = "maisons"
            aggregate_fields = ("note", "avis")
        elif is_car_rental:
            aggregate_id = str(booking.get("vehicleId") or booking.get("bien_id") or "").strip()
            aggregate_collection = "vehicles"
        if is_property_booking or is_car_rental:
            if not aggregate_id:
                raise HTTPException(status_code=403, detail="Cette réservation ne contient aucun bien associé")
            aggregate_reference = db.collection(aggregate_collection).document(aggregate_id)
            aggregate_snapshot = aggregate_reference.get(transaction=transaction)
            aggregate_data = aggregate_snapshot.to_dict() if aggregate_snapshot.exists else None
            if not aggregate_data:
                raise HTTPException(status_code=404, detail="Le bien associé à la réservation est introuvable")

        review_reference = db.collection("reviews").document(
            f"{booking_collection}_{request.booking_id}"
        )
        if review_reference.get(transaction=transaction).exists or booking.get("reviewedAt"):
            raise HTTPException(
                status_code=409,
                detail="Un avis a déjà été enregistré pour cette réservation",
            )

        provider_reference = None
        average_rating = None
        reviews_count = None
        if has_provider:
            provider_reference = db.collection(provider_collection).document(provider_id)
            provider_snapshot = provider_reference.get(transaction=transaction)
            if not provider_snapshot.exists:
                raise HTTPException(status_code=404, detail="Prestataire introuvable")

            provider = provider_snapshot.to_dict() or {}
            current_rating = float(provider.get("rating") or provider.get("note") or 0)
            current_reviews_count = int(provider.get("reviewsCount") or provider.get("avis") or 0)
            reviews_count = current_reviews_count + 1
            average_rating = round(
                (current_rating * current_reviews_count + request.rating) / reviews_count,
                1,
            )
        elif aggregate_reference is not None and aggregate_data is not None:
            current_rating = float(aggregate_data.get(aggregate_fields[0]) or 0)
            current_reviews_count = int(aggregate_data.get(aggregate_fields[1]) or 0)
            reviews_count = current_reviews_count + 1
            average_rating = round(
                (current_rating * current_reviews_count + request.rating) / reviews_count,
                1,
            )
        now = firestore.SERVER_TIMESTAMP

        transaction.create(
            review_reference,
            {
                "bookingId": request.booking_id,
                "bookingCollection": booking_collection,
                "clientUid": firebase_user["uid"],
                **({"providerId": provider_id, "providerCollection": provider_collection} if has_provider else {}),
                "rating": request.rating,
                "comment": request.comment.strip(),
                "createdAt": now,
            },
        )
        if provider_reference is not None:
            transaction.update(
                provider_reference,
                {"rating": average_rating, "reviewsCount": reviews_count},
            )
        elif aggregate_reference is not None:
            transaction.update(
                aggregate_reference,
                {aggregate_fields[0]: average_rating, aggregate_fields[1]: reviews_count},
            )
        transaction.update(booking_reference, {"reviewedAt": now})
        if has_provider or aggregate_reference is not None:
            return {"rating": average_rating, "reviewsCount": reviews_count}
        return {"rating": request.rating, "reviewsCount": 1}

    try:
        result = save_review(transaction)
        notification_details = {
            "Réservation": request.booking_id,
            "Note": request.rating,
        }
        comment = request.comment.strip()
        if comment:
            notification_details["Commentaire"] = comment
        background_tasks.add_task(
            send_notification,
            "booking_review",
            "Nouvel avis reçu",
            "Un client a laissé un avis sur une réservation terminée.",
            notification_details,
        )
        return result
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de l'enregistrement de l'avis")
        raise HTTPException(
            status_code=500,
            detail="Votre avis n'a pas pu être enregistré",
        ) from exc
