import logging

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import firestore

from dependencies import get_current_firebase_user
from firebase import db


router = APIRouter(tags=["reservations"])
logger = logging.getLogger(__name__)
BOOKING_COLLECTIONS = ("bookings", "carBookings", "propertyBookings")


@router.delete("/api/bookings/{booking_id}")
def cancel_booking(
    booking_id: str,
    firebase_user: dict = Depends(get_current_firebase_user),
):
    if not booking_id or len(booking_id) > 128:
        raise HTTPException(status_code=400, detail="Réservation invalide")

    transaction = db.transaction()

    @firestore.transactional
    def delete_owned_booking(transaction):
        booking_record = None
        for collection_name in BOOKING_COLLECTIONS:
            reference = db.collection(collection_name).document(booking_id)
            snapshot = reference.get(transaction=transaction)
            if snapshot.exists:
                booking_record = (collection_name, reference, snapshot.to_dict() or {})
                break

        if booking_record is None:
            raise HTTPException(status_code=404, detail="Réservation introuvable")

        collection_name, booking_reference, booking = booking_record
        owner_uid = str(booking.get("clientUid") or booking.get("clientId") or "")
        if owner_uid != firebase_user["uid"]:
            raise HTTPException(
                status_code=403,
                detail="Vous ne pouvez supprimer que vos propres réservations",
            )

        if collection_name == "propertyBookings":
            property_id = str(booking.get("propertyId") or booking.get("bien_id") or "").strip()
            if property_id:
                property_reference = db.collection("maisons").document(property_id)
                property_snapshot = property_reference.get(transaction=transaction)
                if property_snapshot.exists:
                    transaction.update(
                        property_reference,
                        {"disponibilite": "disponible", "availability": "available"},
                    )

        transaction.delete(booking_reference)

    try:
        delete_owned_booking(transaction)
        return {"id": booking_id, "cancelled": True}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de l'annulation de la réservation")
        raise HTTPException(
            status_code=500,
            detail="La réservation n'a pas pu être supprimée",
        ) from exc
