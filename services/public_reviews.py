import logging

from fastapi import APIRouter, HTTPException
from firebase_admin import firestore

from firebase import db


router = APIRouter(tags=["avis"])
logger = logging.getLogger(__name__)
BOOKING_COLLECTIONS = ("bookings", "carBookings", "propertyBookings")


@router.get("/api/public-reviews")
def list_public_reviews():
    """Return only publishable review fields; never expose client/provider identifiers."""
    try:
        documents = (
            db.collection("reviews")
            .order_by("createdAt", direction=firestore.Query.DESCENDING)
            .limit(30)
            .stream()
        )
        reviews = []
        for document in documents:
            review = document.to_dict() or {}
            comment = str(review.get("comment") or "").strip()
            try:
                rating = int(review.get("rating"))
            except (TypeError, ValueError):
                continue
            if not comment or rating < 1 or rating > 5:
                continue

            booking_collection = str(review.get("bookingCollection") or "")
            booking_id = str(review.get("bookingId") or "")
            booking = {}
            if booking_collection in BOOKING_COLLECTIONS and booking_id:
                snapshot = db.collection(booking_collection).document(booking_id).get()
                if snapshot.exists:
                    booking = snapshot.to_dict() or {}

            created_at = review.get("createdAt")
            if hasattr(created_at, "isoformat"):
                created_at = created_at.isoformat()
            reviews.append({
                "id": document.id,
                "rating": rating,
                "comment": comment,
                "serviceType": str(booking.get("serviceType") or booking.get("type_bien") or "Service Goying"),
                "itemName": str(booking.get("itemName") or booking.get("titre_bien") or ""),
                "createdAt": created_at,
            })
        return {"reviews": reviews}
    except Exception as exc:
        logger.exception("Impossible de charger les avis publics")
        raise HTTPException(status_code=503, detail="Les avis ne sont pas disponibles") from exc

