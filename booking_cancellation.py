import logging
import unicodedata

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import firestore

from dependencies import get_current_firebase_user, require_user_profile
from firebase import db


router = APIRouter(tags=["réservations"])
logger = logging.getLogger(__name__)
BOOKING_COLLECTIONS = ("propertyBookings", "carBookings", "bookings")


def _normalized(value: object) -> str:
    return unicodedata.normalize("NFD", str(value or "").strip().lower()).encode(
        "ascii", "ignore"
    ).decode("ascii")


def _is_approved(booking: dict) -> bool:
    status = _normalized(booking.get("status") or booking.get("statut"))
    if status in {"annule", "annulee", "refuse", "refusee", "cancelled", "canceled"}:
        return False
    return booking.get("approved") is True or status in {
        "confirme",
        "approuve",
        "confirmed",
        "approved",
    }


def _belongs_to_user(booking: dict, firebase_user: dict) -> bool:
    booking_uid = str(booking.get("clientUid") or booking.get("clientId") or "").strip()
    if booking_uid:
        return booking_uid == str(firebase_user.get("uid") or "").strip()

    booking_email = str(booking.get("clientEmail") or "").strip().lower()
    firebase_email = str(firebase_user.get("email") or "").strip().lower()
    return bool(booking_email and firebase_email and booking_email == firebase_email)


def cancel_booking(
    booking_id: str,
    firebase_user: dict = Depends(get_current_firebase_user),
    _user_profile: dict = Depends(require_user_profile),
):
    if not str(firebase_user.get("uid") or "").strip():
        raise HTTPException(status_code=401, detail="Session client invalide ou expirée")

    transaction = db.transaction()

    @firestore.transactional
    def delete_owned_booking(transaction):
        matches = []
        for collection_name in BOOKING_COLLECTIONS:
            reference = db.collection(collection_name).document(booking_id)
            snapshot = reference.get(transaction=transaction)
            if snapshot.exists:
                matches.append((collection_name, reference, snapshot.to_dict() or {}))

        if not matches:
            raise HTTPException(status_code=404, detail="Réservation introuvable")
        if len(matches) > 1:
            raise HTTPException(
                status_code=409,
                detail="Identifiant de réservation ambigu; contactez le support.",
            )

        collection_name, booking_reference, booking = matches[0]
        if not _belongs_to_user(booking, firebase_user):
            raise HTTPException(
                status_code=403,
                detail="Vous ne pouvez annuler que vos propres réservations.",
            )

        property_id = str(booking.get("propertyId") or booking.get("bien_id") or "").strip()
        is_property_booking = (
            collection_name == "propertyBookings"
            and _normalized(booking.get("serviceType")) == "immobilier"
        )
        released_property_id = None

        if is_property_booking and _is_approved(booking):
            if not property_id:
                raise HTTPException(
                    status_code=409,
                    detail="La maison liée à cette réservation ne peut pas être identifiée.",
                )

            property_reference = db.collection("maisons").document(property_id)
            property_snapshot = property_reference.get(transaction=transaction)
            if not property_snapshot.exists:
                raise HTTPException(status_code=404, detail="Maison liée à la réservation introuvable")

            property_data = property_snapshot.to_dict() or {}
            if property_data.get("reservedByBookingId") != booking_id:
                raise HTTPException(
                    status_code=409,
                    detail="La maison n’est pas enregistrée comme réservée par cette demande. "
                    "La réservation n’a pas été supprimée.",
                )

            for field in ("propertyId", "bien_id"):
                matching_bookings = db.collection("propertyBookings").where(
                    field, "==", property_id
                )
                for other_snapshot in transaction.get(matching_bookings):
                    if other_snapshot.id == booking_id:
                        continue
                    other_booking = other_snapshot.to_dict() or {}
                    if (
                        _normalized(other_booking.get("serviceType")) == "immobilier"
                        and _is_approved(other_booking)
                    ):
                        raise HTTPException(
                            status_code=409,
                            detail="Une autre réservation approuvée est liée à cette maison. "
                            "Elle ne peut pas être remise disponible.",
                        )

            transaction.update(property_reference, {
                "statut": "disponible",
                "disponibilite": "disponible",
                "reservedByBookingId": firestore.DELETE_FIELD,
            })
            released_property_id = property_id

        transaction.delete(booking_reference)
        return collection_name, released_property_id

    try:
        collection_name, released_property_id = delete_owned_booking(transaction)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Échec de l’annulation de la réservation %s", booking_id)
        raise HTTPException(
            status_code=500,
            detail="Impossible de supprimer la réservation. Réessayez.",
        ) from exc

    return {
        "message": "Réservation supprimée",
        "booking_id": booking_id,
        "booking_collection": collection_name,
        "property_id": released_property_id,
    }


router.delete("/api/bookings/{booking_id}")(cancel_booking)
router.delete("/api/bookings/{booking_id}/cancel")(cancel_booking)
router.post("/api/bookings/{booking_id}/cancel")(cancel_booking)
