import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field, field_validator
import boto3

from dependencies import get_current_firebase_user
from firebase import db


router = APIRouter(tags=["prestataire"])
logger = logging.getLogger(__name__)
AWS_BUCKET_NAME = os.environ.get("AWS_BUCKET_NAME", "gm-biblio-storage")
AWS_REGION = os.environ.get("AWS_REGION", "eu-west-3")
MAX_PORTFOLIO_IMAGE_SIZE = 5 * 1024 * 1024
MAX_PORTFOLIO_IMAGES = 6
ALLOWED_IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


class ProviderAvailabilityUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    provider_availability: str = Field(alias="providerAvailability")


class UploadImageRequest(BaseModel):
    content_type: str = Field(alias="contentType")


class PortfolioUploadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    upload_type: str = Field(alias="uploadType")
    images: list[UploadImageRequest]

    @field_validator("upload_type")
    @classmethod
    def validate_upload_type(cls, value: str) -> str:
        if value not in {"avatar", "portfolio"}:
            raise ValueError("Type d'image invalide")
        return value


class ProfessionalApplicationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    full_name: str = Field(alias="fullName", min_length=1, max_length=160)
    phone: str = Field(min_length=8, max_length=32)
    specialty: str = Field(min_length=1, max_length=40)
    listing: dict[str, Any]


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


def _own_payment_application(firebase_user: dict):
    account_ref = db.collection("professionalAccounts").document(firebase_user["uid"])
    account_snapshot = account_ref.get()
    if not account_snapshot.exists:
        raise HTTPException(status_code=404, detail="Aucun dossier prestataire n'a été trouvé")
    account = account_snapshot.to_dict() or {}
    application_id = str(account.get("applicationId") or "").strip()
    if not application_id:
        raise HTTPException(status_code=404, detail="Aucun dossier de paiement n'a été trouvé")
    application_ref = db.collection("professionalApplications").document(application_id)
    application_snapshot = application_ref.get()
    if not application_snapshot.exists:
        raise HTTPException(status_code=404, detail="Aucun dossier de paiement n'a été trouvé")
    application = application_snapshot.to_dict() or {}
    if (application.get("session") or {}).get("uid") != firebase_user["uid"]:
        raise HTTPException(status_code=403, detail="Accès interdit à ce dossier")
    return application_ref, application


@router.post("/api/professional-payment-status")
def professional_payment_status(firebase_user: dict = Depends(get_current_firebase_user)):
    _, application = _own_payment_application(firebase_user)
    return {
        "paymentStatus": str(application.get("paymentStatus") or "À vérifier manuellement"),
        "paymentVerificationRequestedAt": application.get("paymentVerificationRequestedAt"),
    }


@router.post("/api/professional-payment-verification-requests", status_code=201)
def request_professional_payment_verification(firebase_user: dict = Depends(get_current_firebase_user)):
    reference, application = _own_payment_application(firebase_user)
    try:
        transaction = db.transaction()

        @firestore.transactional
        def save_request(transaction):
            current = reference.get(transaction=transaction)
            current_data = current.to_dict() or {}
            if current_data.get("paymentVerificationRequestedAt"):
                raise HTTPException(status_code=409, detail="Une demande de vérification est déjà en cours")
            if str(current_data.get("paymentStatus") or "").strip().lower() in {"payé", "paye", "confirmé", "confirme"}:
                raise HTTPException(status_code=409, detail="Le paiement est déjà marqué comme confirmé")
            now = datetime.now(timezone.utc)
            transaction.update(reference, {"paymentVerificationRequestedAt": now})
            return now

        requested_at = save_request(transaction)
        return {
            "paymentStatus": "Vérification demandée",
            "paymentVerificationRequestedAt": requested_at.isoformat(),
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible d'enregistrer la demande de vérification de paiement")
        raise HTTPException(status_code=503, detail="La demande de vérification n'a pas pu être enregistrée") from exc


@router.post("/api/professional-session")
def professional_session(firebase_user: dict = Depends(get_current_firebase_user)):
    account_ref = db.collection("professionalAccounts").document(firebase_user["uid"])
    snapshot = account_ref.get()
    if not snapshot.exists:
        return {"providerStatus": "Non inscrit"}
    account = snapshot.to_dict() or {}
    if str(account.get("uid") or snapshot.id) != firebase_user["uid"]:
        raise HTTPException(status_code=403, detail="Accès interdit à ce dossier")
    result = {
        "email": str(account.get("email") or firebase_user.get("email") or ""),
        "fullName": str(account.get("fullName") or ""),
        "specialty": str(account.get("specialty") or ""),
        "providerStatus": str(account.get("status") or "En attente"),
    }
    provider = _find_verified_provider(firebase_user)
    if provider is not None:
        listing = provider.to_dict() or {}
        listing["id"] = provider.id
        result["providerStatus"] = "Confirmé"
        result["providerListing"] = listing
    return result


@router.post("/api/professional-applications", status_code=201)
def create_professional_application(
    request: ProfessionalApplicationRequest,
    firebase_user: dict = Depends(get_current_firebase_user),
):
    specialty = request.specialty.strip().lower()
    if specialty not in {"chauffeur", "menagere", "coiffeur", "maquilleuse", "professeur"}:
        raise HTTPException(status_code=400, detail="Spécialité invalide")
    if not request.phone.strip().startswith("+"):
        raise HTTPException(status_code=400, detail="Le numéro WhatsApp doit utiliser le format international")

    allowed_listing_fields = {
        "name", "specialty", "priceRate", "pricePerMonth", "currency", "priceNegotiable",
        "vehicleModel", "serviceType", "transmission", "experienceYears", "skills",
        "country", "city", "commune", "zones", "bio", "phone", "managementMode",
    }
    listing = {
        key: value for key, value in request.listing.items()
        if key in allowed_listing_fields
    }
    if not listing:
        raise HTTPException(status_code=400, detail="Informations de profil manquantes")

    application_id = f"application-{uuid.uuid4().hex}"
    account_reference = db.collection("professionalAccounts").document(firebase_user["uid"])
    application_reference = db.collection("professionalApplications").document(application_id)
    transaction = db.transaction()

    @firestore.transactional
    def save_application(transaction):
        if account_reference.get(transaction=transaction).exists:
            raise HTTPException(status_code=409, detail="Un dossier prestataire existe déjà pour ce compte")

        listing["id"] = f"provider-{uuid.uuid4().hex}"
        listing["name"] = request.full_name.strip()
        listing["phone"] = request.phone.strip()
        listing["verified"] = False
        listing["status"] = "indisponible"
        listing["managementMode"] = "admin" if specialty in {"chauffeur", "menagere"} else "provider"

        session = {
            "uid": firebase_user["uid"],
            "email": str(firebase_user.get("email") or "").strip().lower(),
            "fullName": request.full_name.strip(),
            "role": "prestataire",
            "specialty": specialty,
            "phone": request.phone.strip(),
        }
        now = datetime.now(timezone.utc)
        transaction.create(application_reference, {
            "id": application_id,
            "session": session,
            "listing": listing,
            "specialty": specialty,
            "status": "En attente",
            "submittedAt": now,
            "paymentStatus": "À vérifier manuellement",
        })
        transaction.create(account_reference, {
            "uid": firebase_user["uid"],
            "email": session["email"],
            "fullName": session["fullName"],
            "role": "prestataire",
            "specialty": specialty,
            "status": "En attente",
            "applicationId": application_id,
            "createdAt": now,
        })

    try:
        save_application(transaction)
        return {"id": application_id, "status": "En attente"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible de créer le dossier prestataire")
        raise HTTPException(
            status_code=503,
            detail="Votre dossier n'a pas pu être enregistré",
        ) from exc


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


@router.post("/api/portfolio-uploads")
def prepare_portfolio_uploads(
    request: PortfolioUploadRequest,
    firebase_user: dict = Depends(get_current_firebase_user),
):
    _verified_provider_or_error(firebase_user)
    maximum_image_count = 1 if request.upload_type == "avatar" else MAX_PORTFOLIO_IMAGES
    if not request.images or len(request.images) > maximum_image_count:
        raise HTTPException(
            status_code=400,
            detail=f"Envoyez entre 1 et {maximum_image_count} image{'s' if maximum_image_count > 1 else ''}",
        )
    if any(image.content_type not in ALLOWED_IMAGE_TYPES for image in request.images):
        raise HTTPException(
            status_code=400,
            detail="Seules les images JPEG, PNG et WebP sont acceptées",
        )

    try:
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            region_name=AWS_REGION,
        )
        folder = "avatars" if request.upload_type == "avatar" else "portfolios"
        uploads = []
        for image in request.images:
            key = f"goying/{folder}/{firebase_user['uid']}/{uuid.uuid4()}.{ALLOWED_IMAGE_TYPES[image.content_type]}"
            signed_post = s3_client.generate_presigned_post(
                Bucket=AWS_BUCKET_NAME,
                Key=key,
                Fields={"Content-Type": image.content_type},
                Conditions=[
                    ["content-length-range", 1, MAX_PORTFOLIO_IMAGE_SIZE],
                    {"Content-Type": image.content_type},
                ],
                ExpiresIn=300,
            )
            uploads.append({
                **signed_post,
                "publicUrl": f"https://{AWS_BUCKET_NAME}.s3.{AWS_REGION}.amazonaws.com/{key}",
            })
        return {"uploads": uploads}
    except Exception as exc:
        logger.exception("Impossible de préparer les uploads S3 du prestataire")
        raise HTTPException(
            status_code=503,
            detail="Impossible de préparer l'envoi des images",
        ) from exc


class ProviderProfileUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    full_name: str = Field(alias="fullName", min_length=1, max_length=160)
    phone: str = Field(min_length=8, max_length=32)
    country: str = Field(max_length=120)
    city: str = Field(max_length=120)
    commune: str = Field(max_length=120)
    bio: str = Field(max_length=2000)
    skills: list[str] = Field(max_length=30)
    price_rate: str = Field(alias="priceRate", max_length=120)
    avatar_url: str = Field(alias="avatarUrl", max_length=2048)
    portfolio: list[str] = Field(max_length=6)


@router.post("/api/provider-profile")
def update_provider_profile(
    request: ProviderProfileUpdate,
    firebase_user: dict = Depends(get_current_firebase_user),
):
    provider = _verified_provider_or_error(firebase_user)
    values = {
        "name": request.full_name.strip(),
        "phone": request.phone.strip(),
        "country": request.country.strip(),
        "city": request.city.strip(),
        "commune": request.commune.strip(),
        "bio": request.bio.strip(),
        "skills": [skill.strip()[:120] for skill in request.skills if skill.strip()],
        "priceRate": request.price_rate.strip(),
        "avatarUrl": request.avatar_url.strip(),
        "photo_profil": request.avatar_url.strip(),
        "portfolio": [url.strip() for url in request.portfolio if url.strip()],
        "updatedAt": datetime.now(timezone.utc),
    }
    if any(len(url) > 2048 for url in values["portfolio"]):
        raise HTTPException(status_code=400, detail="Une adresse d'image est trop longue")
    try:
        provider.reference.update(values)
    except Exception as exc:
        logger.exception("Impossible de mettre à jour le profil prestataire")
        raise HTTPException(status_code=503, detail="Le profil n'a pas pu être mis à jour") from exc
    return {"avatarUrl": values["avatarUrl"], "portfolio": values["portfolio"]}
