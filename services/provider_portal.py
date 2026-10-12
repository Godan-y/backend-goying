import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import PurePath
from typing import Literal

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, status
from firebase_admin import firestore
from google.api_core.exceptions import AlreadyExists
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from dependencies import get_current_firebase_user, require_firebase_user, require_user_profile
from firebase import db


router = APIRouter(tags=["prestataire"])
logger = logging.getLogger(__name__)

AWS_ACCESS_KEY = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
BUCKET_NAME = os.environ.get("AWS_BUCKET_NAME", "gm-biblio-storage")
REGION = os.environ.get("AWS_REGION", "eu-west-3")
PORTFOLIO_MAX_FILE_SIZE = 5 * 1024 * 1024
PORTFOLIO_MAX_IMAGES = 6
PORTFOLIO_UPLOAD_EXPIRES_SECONDS = 5 * 60
PORTFOLIO_IMAGE_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}

s3_client = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=REGION,
)


class PortfolioUploadFile(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    filename: str = Field(
        min_length=1,
        max_length=255,
        validation_alias=AliasChoices("filename", "fileName", "file_name"),
    )
    content_type: str = Field(
        validation_alias=AliasChoices("contentType", "content_type", "mimeType", "mime_type"),
    )
    file_size: int = Field(
        gt=0,
        validation_alias=AliasChoices("fileSize", "file_size", "size"),
    )


class PortfolioUploadRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    files: list[PortfolioUploadFile] | None = None
    filename: str | None = Field(
        default=None,
        validation_alias=AliasChoices("filename", "fileName", "file_name"),
    )
    content_type: str | None = Field(
        default=None,
        validation_alias=AliasChoices("contentType", "content_type", "mimeType", "mime_type"),
    )
    file_size: int | None = Field(
        default=None,
        validation_alias=AliasChoices("fileSize", "file_size", "size"),
    )


class ProfessionalApplicationListing(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=40)
    country: str = Field(min_length=1, max_length=100)
    city: str = Field(min_length=1, max_length=100)
    commune: str = Field(default="", max_length=100)
    skills: list[str] = Field(default_factory=list, max_length=50)
    experienceYears: int = Field(
        default=0,
        ge=0,
        le=80,
    )


class ProfessionalApplicationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    fullName: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=1, max_length=40)
    specialty: Literal["chauffeur", "menagere"]
    listing: ProfessionalApplicationListing


def _portfolio_upload_files(request: PortfolioUploadRequest) -> list[PortfolioUploadFile]:
    if request.files is not None:
        if not request.files:
            raise HTTPException(status_code=400, detail="Sélectionnez au moins une image.")
        return request.files

    if request.filename is None or request.content_type is None or request.file_size is None:
        raise HTTPException(
            status_code=422,
            detail="Fournissez un fichier avec son nom, son type et sa taille.",
        )
    return [
        PortfolioUploadFile(
            filename=request.filename,
            content_type=request.content_type,
            file_size=request.file_size,
        )
    ]


@router.post(
    "/api/professional-applications",
    status_code=status.HTTP_201_CREATED,
)
def create_professional_application(
    request: ProfessionalApplicationRequest,
    firebase_user: dict = Depends(require_firebase_user),
):
    uid = str(firebase_user["uid"]).strip()
    full_name = request.fullName.strip()
    phone = request.phone.strip()
    if not full_name or not phone:
        raise HTTPException(status_code=422, detail="Nom complet et téléphone obligatoires")

    listing = request.listing.model_dump()
    listing["phone"] = phone
    application_collection = db.collection("professionalApplications")
    account_reference = db.collection("professionalAccounts").document(uid)
    application_reference = application_collection.document()
    now = datetime.now(timezone.utc)
    application = {
        "uid": uid,
        "status": "En attente",
        "paymentStatus": "À vérifier manuellement",
        "specialty": request.specialty,
        "session": {
            "uid": uid,
            "email": str(firebase_user.get("email") or "").strip().lower(),
            "fullName": full_name,
            "phone": phone,
        },
        "listing": listing,
        "createdAt": now,
        "updatedAt": now,
    }
    account = {
        "uid": uid,
        "applicationId": application_reference.id,
        "status": "En attente",
        "paymentStatus": "À vérifier manuellement",
        "createdAt": now,
        "updatedAt": now,
    }

    try:
        existing_applications = (
            application_collection.where("uid", "==", uid).limit(1).stream()
        )
        if next(iter(existing_applications), None) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Une candidature prestataire existe déjà pour ce compte.",
            )

        transaction = db.transaction()

        @firestore.transactional
        def save_application(transaction):
            if account_reference.get(transaction=transaction).exists:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Une candidature prestataire existe déjà pour ce compte.",
                )
            transaction.create(application_reference, application)
            transaction.create(account_reference, account)

        save_application(transaction)
    except HTTPException:
        raise
    except AlreadyExists as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Une candidature prestataire existe déjà pour ce compte.",
        ) from exc
    except Exception as exc:
        logger.exception("Impossible d'enregistrer la candidature prestataire pour %s", uid)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="L'enregistrement de votre candidature est temporairement indisponible.",
        ) from exc

    return {
        "applicationId": application_reference.id,
        "status": application["status"],
        "paymentStatus": application["paymentStatus"],
    }


def _validate_portfolio_upload(upload: PortfolioUploadFile) -> str:
    extension = PurePath(upload.filename).suffix.lower()
    expected_content_type = PORTFOLIO_IMAGE_TYPES.get(extension)
    if expected_content_type is None or upload.content_type.lower() != expected_content_type:
        raise HTTPException(
            status_code=415,
            detail="Seules les images JPEG, PNG et WebP sont autorisées.",
        )
    if upload.file_size > PORTFOLIO_MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Chaque image du portfolio doit faire au maximum 5 Mo.",
        )
    return extension


def _portfolio_image_count(provider_id: str) -> int:
    prefix = f"goying/prestataires/{provider_id}/portfolio/"
    try:
        paginator = s3_client.get_paginator("list_objects_v2")
        return sum(
            1
            for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix=prefix)
            for item in page.get("Contents", [])
            if item.get("Key") and not str(item["Key"]).endswith("/")
        )
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Impossible de vérifier le nombre d'images du portfolio")
        raise HTTPException(
            status_code=503,
            detail="Le portfolio est temporairement indisponible. Réessayez.",
        ) from exc


@router.post("/api/portfolio-uploads")
def create_portfolio_upload_urls(
    request: PortfolioUploadRequest,
    firebase_user: dict = Depends(get_current_firebase_user),
    _user_profile: dict = Depends(require_user_profile),
):
    provider = _verified_provider_or_error(firebase_user)
    uploads = _portfolio_upload_files(request)
    if len(uploads) > PORTFOLIO_MAX_IMAGES:
        raise HTTPException(
            status_code=413,
            detail=f"Le portfolio est limité à {PORTFOLIO_MAX_IMAGES} images.",
        )

    extensions = [_validate_portfolio_upload(upload) for upload in uploads]
    existing_count = _portfolio_image_count(provider.id)
    if existing_count + len(uploads) > PORTFOLIO_MAX_IMAGES:
        raise HTTPException(
            status_code=409,
            detail=f"Le portfolio contient déjà {existing_count} image(s). "
            f"La limite est de {PORTFOLIO_MAX_IMAGES}.",
        )

    public_base_url = f"https://{BUCKET_NAME}.s3.{REGION}.amazonaws.com"
    signed_uploads = []
    try:
        for upload, extension in zip(uploads, extensions):
            object_key = (
                f"goying/prestataires/{provider.id}/portfolio/{uuid.uuid4().hex}{extension}"
            )
            upload_url = s3_client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": BUCKET_NAME,
                    "Key": object_key,
                    "ContentType": upload.content_type.lower(),
                    "ContentLength": upload.file_size,
                },
                ExpiresIn=PORTFOLIO_UPLOAD_EXPIRES_SECONDS,
            )
            public_url = f"{public_base_url}/{object_key}"
            signed_uploads.append({
                "uploadUrl": upload_url,
                "publicUrl": public_url,
                "key": object_key,
                "method": "PUT",
                "headers": {
                    "Content-Type": upload.content_type.lower(),
                },
                "expiresIn": PORTFOLIO_UPLOAD_EXPIRES_SECONDS,
            })
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Impossible de préparer l'upload du portfolio du prestataire %s", provider.id)
        raise HTTPException(
            status_code=502,
            detail="Impossible de préparer l’envoi vers le stockage. Réessayez.",
        ) from exc

    response = {"uploads": signed_uploads}
    if len(signed_uploads) == 1:
        response.update(signed_uploads[0])
    return response


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
def list_provider_missions(
    firebase_user: dict = Depends(get_current_firebase_user),
    _user_profile: dict = Depends(require_user_profile),
):
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
    _user_profile: dict = Depends(require_user_profile),
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
    _user_profile: dict = Depends(require_user_profile),
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
