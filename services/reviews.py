import logging
import unicodedata

from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field

from dependencies import get_current_firebase_user, require_user_profile
from firebase import db


router = APIRouter()
logger = logging.getLogger(__name__)
BOOKING_COLLECTIONS = ("bookings", "carBookings", "propertyBookings")
PROVIDER_COLLECTIONS = {"chauffeurs", "providers"}


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


@router.post("/api/booking-reviews", status_code=status.HTTP_201_CREATED)
def create_booking_review(
    request: BookingReviewRequest,
    firebase_user: dict = Depends(get_current_firebase_user),
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
        if not _is_completed(booking):
            raise HTTPException(
                status_code=403,
                detail="Un avis peut être laissé uniquement après la fin de la prestation",
            )

        booking_client_uid = str(booking.get("clientUid") or booking.get("clientId") or "")
        booking_client_email = str(booking.get("clientEmail") or "").strip().lower()
        firebase_email = str(firebase_user.get("email") or "").strip().lower()
        if booking_client_uid != firebase_user["uid"] and booking_client_email != firebase_email:
            raise HTTPException(
                status_code=403,
                detail="Vous ne pouvez évaluer que vos propres réservations",
            )

        provider_id = str(booking.get("providerId") or "").strip()
        provider_collection = str(booking.get("providerCollection") or "").strip()
        if not provider_id or provider_collection not in PROVIDER_COLLECTIONS:
            raise HTTPException(
                status_code=403,
                detail="Cette réservation ne peut pas recevoir d'avis",
            )

        review_reference = db.collection("reviews").document(
            f"{booking_collection}_{request.booking_id}"
        )
        if review_reference.get(transaction=transaction).exists or booking.get("reviewedAt"):
            raise HTTPException(
                status_code=409,
                detail="Un avis a déjà été enregistré pour cette réservation",
            )

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
        now = firestore.SERVER_TIMESTAMP

        transaction.create(
            review_reference,
            {
                "bookingId": request.booking_id,
                "bookingCollection": booking_collection,
                "clientUid": firebase_user["uid"],
                "providerId": provider_id,
                "providerCollection": provider_collection,
                "rating": request.rating,
                "comment": request.comment.strip(),
                "createdAt": now,
            },
        )
        transaction.update(
            provider_reference,
            {"rating": average_rating, "reviewsCount": reviews_count},
        )
        transaction.update(booking_reference, {"reviewedAt": now})
        return {"rating": average_rating, "reviewsCount": reviews_count}

    try:
        return save_review(transaction)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de l'enregistrement de l'avis")
        raise HTTPException(
            status_code=500,
            detail="Votre avis n'a pas pu être enregistré",
        ) from exc
