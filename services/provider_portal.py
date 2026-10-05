from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field

from dependencies import get_current_firebase_user
from firebase import db


router = APIRouter(tags=["prestataire"])


class ProviderAvailabilityUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider_availability: str = Field(alias="providerAvailability")


def _is_verified(provider) -> bool:
    return provider.to_dict().get("verified") is True or str(
        provider.to_dict().get("verified") or ""
    ).strip().lower() == "true"


def _find_verified_provider(firebase_user: dict):
    user_id = str(firebase_user["uid"])
    account_snapshot = db.collection("professionalAccounts").document(user_id).get()
    if not account_snapshot.exists:
        accounts = list(
            db.collection("professionalAccounts").where("uid", "==", user_id).limit(1).stream()
        )
        account_snapshot = accounts[0] if accounts else None

    account = account_snapshot.to_dict() if account_snapshot and account_snapshot.exists else {}
    application_id = str(account.get("applicationId") or "").strip()
    if application_id:
        providers = list(
            db.collection("providers")
            .where("applicationId", "==", application_id)
            .stream()
        )
        verified_provider = next(
            (provider for provider in providers if _is_verified(provider)),
            None,
        )
        if verified_provider:
            return verified_provider

    email = str(firebase_user.get("email") or "").strip().lower()
    if not email:
        return None
    providers = list(
        db.collection("providers")
        .where("email", "==", email)
        .stream()
    )
    return next(
        (provider for provider in providers if _is_verified(provider)),
        None,
    )


def _verified_provider_or_error(firebase_user: dict):
    provider = _find_verified_provider(firebase_user)
    if provider is None:
        raise HTTPException(
            status_code=403,
            detail="Cette action est réservée aux prestataires approuvés",
        )
    return provider


@router.get("/api/provider-missions")
def list_provider_missions(firebase_user: dict = Depends(get_current_firebase_user)):
    provider = _verified_provider_or_error(firebase_user)
    try:
        missions = []
        for document in db.collection("bookings").where("providerId", "==", provider.id).stream():
            mission = document.to_dict() or {}
            if mission.get("acknowledgedByClient") is not True:
                missions.append({"id": document.id, **mission})
        missions.sort(key=lambda mission: str(mission.get("createdAt", "")), reverse=True)
        return {"missions": missions}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="Vos missions sont temporairement indisponibles",
        ) from exc


@router.post("/api/provider-missions/{booking_id}/complete")
def request_provider_completion(
    booking_id: str,
    firebase_user: dict = Depends(get_current_firebase_user),
):
    if not booking_id or len(booking_id) > 128:
        raise HTTPException(status_code=400, detail="Mission invalide")

    provider = _verified_provider_or_error(firebase_user)
    booking_reference = db.collection("bookings").document(booking_id)
    transaction = db.transaction()

    @firestore.transactional
    def complete_mission(transaction):
        snapshot = booking_reference.get(transaction=transaction)
        booking = snapshot.to_dict() if snapshot.exists else None
        if not booking or str(booking.get("providerId") or "") != provider.id:
            raise HTTPException(
                status_code=403,
                detail="Cette mission ne vous est pas attribuée",
            )
        if booking.get("status") not in {"Confirmé", "En cours"}:
            raise HTTPException(
                status_code=409,
                detail="Seules les missions confirmées ou en cours peuvent être terminées",
            )
        transaction.update(
            booking_reference,
            {
                "status": "À valider",
                "providerCompletionRequested": True,
                "providerCompletedAt": datetime.now(timezone.utc),
            },
        )

    complete_mission(transaction)
    return {"id": booking_id, "status": "À valider"}


@router.post("/api/provider-availability")
def update_provider_availability(
    update: ProviderAvailabilityUpdate,
    firebase_user: dict = Depends(get_current_firebase_user),
):
    if update.provider_availability not in {"disponible", "indisponible"}:
        raise HTTPException(status_code=400, detail="Disponibilité invalide")

    provider = _verified_provider_or_error(firebase_user)
    provider.reference.update(
        {
            "providerAvailability": update.provider_availability,
            "updatedAt": datetime.now(timezone.utc),
        }
    )
    return {"providerAvailability": update.provider_availability}
