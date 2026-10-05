import logging
import math
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Literal
from urllib.parse import unquote, urlparse

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from firebase_admin import firestore
from pydantic import BaseModel

from dependencies import require_role
from firebase import db


router = APIRouter()
logger = logging.getLogger(__name__)

AWS_ACCESS_KEY = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
BUCKET_NAME = os.environ.get("AWS_BUCKET_NAME", "gm-biblio-storage")
REGION = os.environ.get("AWS_REGION", "eu-west-3")

s3_client = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=REGION,
)

ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024
MAX_VEHICLE_SALE_PHOTOS = 10
VEHICLE_SALE_TYPES = {
    "Citadine",
    "Berline",
    "SUV",
    "4x4",
    "Pickup",
    "Minibus",
    "Utilitaire",
    "Autre",
}
VEHICLE_SALE_CONDITIONS = {
    "Neuf",
    "Occasion - Comme neuf",
    "Occasion - Bon état",
    "Occasion - État moyen",
    "Pour pièces / Non roulant",
}
ACTIVE_BOOKING_STATUSES = {"En attente", "Confirmé", "En cours"}
BOOKING_STATUS_TRANSITIONS = {
    "En attente": {"Confirmer": "Confirmé", "Annuler": "Annulé"},
    "Confirmé": {"Démarrer": "En cours", "Annuler": "Annulé"},
    "En cours": {"Terminer": "Terminé", "Annuler": "Annulé"},
}
PURCHASE_REQUEST_STATUS_TRANSITIONS = {
    "Nouvelle": {
        "Vendeur contacté",
        "Acheteur contacté",
        "Véhicule disponible",
        "Vente annulée",
    },
    "Vendeur contacté": {
        "Acheteur contacté",
        "Véhicule disponible",
        "Vente annulée",
    },
    "Acheteur contacté": {
        "Vendeur contacté",
        "Véhicule disponible",
        "Vente annulée",
    },
    "Véhicule disponible": {
        "Mise en relation effectuée",
        "Vente annulée",
    },
    "Mise en relation effectuée": {"Vente réalisée", "Vente annulée"},
    "Vente réalisée": set(),
    "Vente annulée": set(),
}


class VehicleAvailabilityUpdate(BaseModel):
    is_available: bool


class VehicleSaleStatusUpdate(BaseModel):
    status: Literal["Disponible", "Indisponible"]


class PurchaseRequestStatusUpdate(BaseModel):
    status: str


class VehicleUpdate(BaseModel):
    brand: str
    model: str
    category: str
    fuel: str
    transmission: str
    seats: int
    price_per_day: int
    currency: str
    features: list[str]
    is_available: bool
    city: str = ""
    commune: str = ""


def _parse_features(features: str) -> list[str]:
    values = []
    for feature in features.split(","):
        value = feature.strip()
        if value and value not in values:
            values.append(value)

    if not values:
        raise HTTPException(
            status_code=400,
            detail="Ajoutez au moins une fonctionnalité pour la voiture",
        )

    return values


async def _upload_images(
    photos: list[UploadFile],
    storage_folder: str = "vehicles",
) -> list[tuple[str, str]]:
    uploaded_files = []

    try:
        for photo in photos:
            extension = os.path.splitext(photo.filename or "")[1].lower()
            if extension not in ALLOWED_IMAGE_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail="Les photos doivent être au format JPG, PNG ou WebP",
                )
            if not photo.content_type or not photo.content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail="Tous les fichiers doivent être des images")

            content = await photo.read()
            if not content:
                raise HTTPException(status_code=400, detail="Une photo envoyée est vide")
            if len(content) > MAX_IMAGE_SIZE_BYTES:
                raise HTTPException(
                    status_code=400,
                    detail="Chaque photo doit faire au maximum 10 Mo",
                )

            key = f"goying/{storage_folder}/{uuid.uuid4()}{extension}"
            s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=key,
                Body=content,
                ContentType=photo.content_type,
            )
            uploaded_files.append(
                (key, f"https://{BUCKET_NAME}.s3.{REGION}.amazonaws.com/{key}")
            )
    except HTTPException:
        for key, _ in uploaded_files:
            s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
        raise
    except Exception as exc:
        logger.exception("Erreur pendant l'envoi des photos de la voiture")
        for key, _ in uploaded_files:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
            except Exception:
                logger.exception("Impossible de supprimer une photo après un échec d'upload")
        raise HTTPException(status_code=500, detail="Erreur lors de l'envoi des photos") from exc

    return uploaded_files


@router.get("/api/voitures")
def lister_voitures(_gestionnaire: dict = Depends(require_role("voitures"))):
    try:
        vehicles = []
        for document in db.collection("vehicles").stream():
            vehicle = document.to_dict()
            vehicle["id"] = document.id
            vehicle.setdefault("isAvailable", True)
            vehicles.append(vehicle)
    except Exception as exc:
        logger.exception("Erreur lors de la récupération des voitures")
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer les voitures",
        ) from exc

    vehicles.sort(key=lambda vehicle: str(vehicle.get("createdAt", "")), reverse=True)
    return {"vehicles": vehicles}


@router.patch("/api/voitures/{vehicle_id}/availability")
def modifier_disponibilite_voiture(
    vehicle_id: str,
    availability: VehicleAvailabilityUpdate,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("vehicles").document(vehicle_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Voiture introuvable")

    reference.update(
        {
            "isAvailable": availability.is_available,
            "updatedAt": datetime.now(timezone.utc),
        }
    )
    return {
        "message": "Disponibilité de la voiture mise à jour",
        "id": vehicle_id,
        "isAvailable": availability.is_available,
    }


@router.get("/api/voitures/details/{vehicle_id}")
def obtenir_voiture(
    vehicle_id: str,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    snapshot = db.collection("vehicles").document(vehicle_id).get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Voiture introuvable")
    vehicle = snapshot.to_dict()
    vehicle["id"] = snapshot.id
    vehicle.setdefault("isAvailable", True)
    return vehicle


@router.patch("/api/voitures/{vehicle_id}")
def modifier_voiture(
    vehicle_id: str,
    vehicle_update: VehicleUpdate,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    if not all(
        value.strip()
        for value in (
            vehicle_update.brand,
            vehicle_update.model,
            vehicle_update.category,
            vehicle_update.fuel,
            vehicle_update.transmission,
            vehicle_update.currency,
        )
    ):
        raise HTTPException(status_code=400, detail="Tous les champs texte sont obligatoires")
    if vehicle_update.seats < 1:
        raise HTTPException(status_code=400, detail="Le nombre de places doit être supérieur à zéro")
    if vehicle_update.price_per_day < 0:
        raise HTTPException(status_code=400, detail="Le prix journalier ne peut pas être négatif")

    reference = db.collection("vehicles").document(vehicle_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Voiture introuvable")
    reference.update(
        {
            "brand": vehicle_update.brand.strip(),
            "model": vehicle_update.model.strip(),
            "category": vehicle_update.category.strip(),
            "fuel": vehicle_update.fuel.strip(),
            "transmission": vehicle_update.transmission.strip(),
            "seats": vehicle_update.seats,
            "pricePerDay": vehicle_update.price_per_day,
            "currency": vehicle_update.currency.strip(),
            "features": [feature.strip() for feature in vehicle_update.features if feature.strip()],
            "isAvailable": vehicle_update.is_available,
            "city": vehicle_update.city.strip(),
            "commune": vehicle_update.commune.strip(),
            "updatedAt": datetime.now(timezone.utc),
        }
    )
    return {"message": "Voiture modifiée", "id": vehicle_id}


@router.post("/api/voitures/{vehicle_id}/photos")
async def ajouter_photos_voiture(
    vehicle_id: str,
    photos: list[UploadFile] = File(...),
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("vehicles").document(vehicle_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Voiture introuvable")
    if not photos or any(not photo.filename for photo in photos):
        raise HTTPException(status_code=400, detail="Ajoutez au moins une photo")

    uploaded_files = await _upload_images(photos)
    try:
        existing_urls = snapshot.to_dict().get("imageUrls") or []
        if not isinstance(existing_urls, list):
            existing_urls = []
        image_urls = [*existing_urls, *[url for _, url in uploaded_files]]
        reference.update(
            {
                "imageUrls": image_urls,
                "imageUrl": image_urls[0],
                "updatedAt": datetime.now(timezone.utc),
            }
        )
    except Exception as exc:
        logger.exception("Erreur lors de l'ajout des photos de voiture dans Firebase")
        for key, _ in uploaded_files:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
            except (BotoCoreError, ClientError):
                logger.exception("Impossible de supprimer une image après un échec Firebase")
        raise HTTPException(status_code=500, detail="Impossible d'ajouter les photos") from exc

    return {"message": "Photos ajoutées", "id": vehicle_id, "imageUrls": image_urls}


@router.delete("/api/voitures/{vehicle_id}")
def supprimer_voiture(
    vehicle_id: str,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("vehicles").document(vehicle_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Voiture introuvable")

    vehicle = snapshot.to_dict()
    try:
        reference.delete()
    except Exception as exc:
        logger.exception("Erreur lors de la suppression de la voiture dans Firebase")
        raise HTTPException(
            status_code=500,
            detail="Impossible de supprimer la voiture",
        ) from exc

    failed_keys = []
    for key in _vehicle_image_keys(vehicle):
        try:
            s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
        except (BotoCoreError, ClientError):
            logger.exception("Impossible de supprimer l'image S3 de la voiture : %s", key)
            failed_keys.append(key)

    if failed_keys:
        raise HTTPException(
            status_code=500,
            detail=(
                "La voiture a été supprimée, mais certaines images S3 doivent être "
                "supprimées manuellement"
            ),
        )

    return {"message": "Voiture et images supprimées", "id": vehicle_id}


def _vehicle_image_keys(vehicle: dict) -> list[str]:
    image_urls = vehicle.get("imageUrls") or []
    if not isinstance(image_urls, list):
        image_urls = []
    if vehicle.get("imageUrl"):
        image_urls.append(vehicle["imageUrl"])

    expected_host = f"{BUCKET_NAME}.s3.{REGION}.amazonaws.com"
    keys = []
    for image_url in image_urls:
        parsed_url = urlparse(str(image_url))
        key = unquote(parsed_url.path.lstrip("/"))
        if parsed_url.netloc != expected_host or not key.startswith("goying/vehicles/"):
            logger.warning("URL d'image ignorée lors de la suppression : %s", image_url)
            continue
        if key not in keys:
            keys.append(key)

    return keys


@router.get("/api/voitures/reservations")
def lister_reservations_voitures(
    historique: bool = False,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    try:
        reservations = []
        for document in db.collection("carBookings").stream():
            reservation = document.to_dict()
            reservation["id"] = document.id
            status = _normaliser_statut_reservation(
                reservation.get("status") or reservation.get("statut")
            )
            reservation["status"] = status
            reservation["vehicleImageUrl"] = _reservation_vehicle_image_url(reservation)
            if (not historique and status in ACTIVE_BOOKING_STATUSES) or (
                historique and status in {"Terminé", "Annulé"}
            ):
                reservations.append(reservation)
    except Exception as exc:
        logger.exception("Erreur lors de la récupération des réservations automobiles")
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer les réservations automobiles",
        ) from exc

    reservations.sort(key=lambda reservation: str(reservation.get("createdAt", "")), reverse=True)
    return {"reservations": reservations}


def _reservation_vehicle_image_url(reservation: dict) -> str:
    image_url = str(
        reservation.get("photo_bien") or reservation.get("vehicleImageUrl") or ""
    ).strip()
    if image_url:
        return image_url

    vehicle_id = str(reservation.get("vehicleId") or reservation.get("bien_id") or "").strip()
    if not vehicle_id:
        return ""

    try:
        vehicle_snapshot = db.collection("vehicles").document(vehicle_id).get()
    except Exception as exc:
        logger.exception(
            "Erreur lors de la récupération de l'image du véhicule %s",
            vehicle_id,
        )
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer l'image du véhicule réservé",
        ) from exc

    if not vehicle_snapshot.exists:
        return ""

    vehicle = vehicle_snapshot.to_dict()
    image_urls = vehicle.get("imageUrls") or vehicle.get("photo_urls") or []
    if isinstance(image_urls, list) and image_urls:
        return str(image_urls[0])
    return str(vehicle.get("imageUrl") or vehicle.get("photo_url") or "")


@router.patch("/api/voitures/reservations/{reservation_id}/{action}")
def modifier_statut_reservation_voiture(
    reservation_id: str,
    action: str,
    gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("carBookings").document(reservation_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Réservation automobile introuvable")

    reservation = snapshot.to_dict()
    current_status = _normaliser_statut_reservation(reservation.get("status"))
    next_status = BOOKING_STATUS_TRANSITIONS.get(current_status, {}).get(action.capitalize())
    if not next_status:
        raise HTTPException(
            status_code=400,
            detail="Cette action n'est pas autorisée pour le statut actuel",
        )

    now = datetime.now(timezone.utc)
    update = {
        "status": next_status,
        "updatedAt": now,
        "updatedBy": gestionnaire["nom"],
    }
    if next_status == "Confirmé":
        update["confirmedAt"] = now
    elif next_status == "En cours":
        update["startedAt"] = now
    elif next_status == "Terminé":
        update["completedAt"] = now
    elif next_status == "Annulé":
        update["cancelledAt"] = now

    reference.update(update)
    return {"message": "Statut de réservation mis à jour", "id": reservation_id, "status": next_status}


@router.delete("/api/voitures/reservations/{reservation_id}")
def supprimer_reservation_voiture(
    reservation_id: str,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("carBookings").document(reservation_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Réservation automobile introuvable")

    try:
        reference.delete()
    except Exception as exc:
        logger.exception("Erreur lors de la suppression de la réservation automobile")
        raise HTTPException(
            status_code=500,
            detail="Impossible de supprimer la réservation automobile",
        ) from exc
    return {"message": "Réservation supprimée", "id": reservation_id}


def _normaliser_statut_reservation(status: object) -> str:
    statuses = {
        "en attente": "En attente",
        "pending": "En attente",
        "confirmé": "Confirmé",
        "confirme": "Confirmé",
        "approved": "Confirmé",
        "en cours": "En cours",
        "in progress": "En cours",
        "terminé": "Terminé",
        "termine": "Terminé",
        "completed": "Terminé",
        "annulé": "Annulé",
        "annule": "Annulé",
        "cancelled": "Annulé",
    }
    value = str(status or "").strip()
    return statuses.get(value.lower(), value or "En attente")


@router.post("/api/voitures", status_code=201)
async def ajouter_voiture(
    brand: str = Form(...),
    model: str = Form(...),
    category: str = Form(...),
    fuel: str = Form(...),
    transmission: str = Form(...),
    seats: int = Form(...),
    price_per_day: int = Form(...),
    currency: str = Form("€"),
    features: str = Form(...),
    city: str = Form(...),
    commune: str = Form(...),
    is_available: bool = Form(True),
    photos: list[UploadFile] = File(...),
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    text_fields = {
        "marque": brand,
        "modèle": model,
        "catégorie": category,
        "carburant": fuel,
        "transmission": transmission,
        "devise": currency,
        "ville": city,
        "commune / quartier": commune,
    }
    empty_fields = [label for label, value in text_fields.items() if not value.strip()]
    if empty_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Les champs suivants sont obligatoires : {', '.join(empty_fields)}",
        )
    if seats < 1:
        raise HTTPException(status_code=400, detail="Le nombre de places doit être supérieur à zéro")
    if price_per_day < 0:
        raise HTTPException(status_code=400, detail="Le prix journalier ne peut pas être négatif")
    if not photos or any(not photo.filename for photo in photos):
        raise HTTPException(status_code=400, detail="Ajoutez au moins une photo de la voiture")

    feature_list = _parse_features(features)
    uploaded_files = await _upload_images(photos)
    image_urls = [url for _, url in uploaded_files]
    vehicle_reference = db.collection("vehicles").document()

    vehicle = {
        "id": vehicle_reference.id,
        "brand": brand.strip(),
        "model": model.strip(),
        "city": city.strip(),
        "commune": commune.strip(),
        "category": category.strip(),
        "currency": currency.strip(),
        "features": feature_list,
        "fuel": fuel.strip(),
        "imageUrl": image_urls[0],
        "imageUrls": image_urls,
        "isAvailable": is_available,
        "pricePerDay": price_per_day,
        "rating": 0,
        "reviewsCount": 0,
        "seats": seats,
        "transmission": transmission.strip(),
        "createdBy": _gestionnaire["nom"],
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": datetime.now(timezone.utc),
    }

    try:
        vehicle_reference.set(vehicle)
    except Exception as exc:
        logger.exception("Erreur lors de l'enregistrement de la voiture dans Firebase")
        for key, _ in uploaded_files:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
            except Exception:
                logger.exception("Impossible de supprimer une photo après un échec Firebase")
        raise HTTPException(status_code=500, detail="Erreur lors de l'enregistrement de la voiture") from exc

    return {
        "success": True,
        "message": "Voiture ajoutée avec succès",
        "id": vehicle_reference.id,
        "imageUrl": image_urls[0],
        "imageUrls": image_urls,
    }


@router.post("/api/voitures/ventes", status_code=201)
async def ajouter_annonce_vente_voiture(
    brand: str = Form(...),
    model: str = Form(...),
    year: int = Form(...),
    mileage: int = Form(...),
    vehicle_type: str = Form(...),
    seller_whatsapp: str = Form(...),
    transmission: str = Form(...),
    fuel: str = Form(...),
    condition: str = Form(...),
    price_usd: float = Form(...),
    price_negotiable: bool = Form(False),
    city: str = Form(...),
    commune: str = Form(...),
    description: str = Form(""),
    photos: list[UploadFile] = File(...),
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    text_fields = {
        "marque": brand,
        "modèle": model,
        "type de véhicule": vehicle_type,
        "WhatsApp du vendeur": seller_whatsapp,
        "transmission": transmission,
        "carburant": fuel,
        "état du véhicule": condition,
        "ville": city,
        "commune / quartier": commune,
    }
    empty_fields = [label for label, value in text_fields.items() if not value.strip()]
    if empty_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Les champs suivants sont obligatoires : {', '.join(empty_fields)}",
        )
    if year < 1886 or year > datetime.now().year:
        raise HTTPException(status_code=400, detail="L'année du véhicule est invalide")
    if mileage < 0:
        raise HTTPException(status_code=400, detail="Le kilométrage ne peut pas être négatif")
    if vehicle_type not in VEHICLE_SALE_TYPES:
        raise HTTPException(status_code=400, detail="Sélectionnez un type de véhicule valide")
    if condition not in VEHICLE_SALE_CONDITIONS:
        raise HTTPException(status_code=400, detail="Sélectionnez un état de véhicule valide")
    if transmission not in {"Manuelle", "Automatique"}:
        raise HTTPException(status_code=400, detail="Sélectionnez une transmission valide")
    if fuel not in {"Essence", "Diesel", "Électrique", "Hybride"}:
        raise HTTPException(status_code=400, detail="Sélectionnez un type de carburant valide")
    if not re.fullmatch(r"\+[1-9]\d{7,14}", seller_whatsapp.strip()):
        raise HTTPException(
            status_code=400,
            detail="Le numéro WhatsApp doit être au format international, par exemple +243...",
        )
    if not math.isfinite(price_usd) or price_usd <= 0:
        raise HTTPException(status_code=400, detail="Le prix de vente doit être supérieur à zéro")
    if not photos or any(not photo.filename for photo in photos):
        raise HTTPException(status_code=400, detail="Ajoutez au moins une photo du véhicule")
    if len(photos) > MAX_VEHICLE_SALE_PHOTOS:
        raise HTTPException(
            status_code=400,
            detail=f"Ajoutez au maximum {MAX_VEHICLE_SALE_PHOTOS} photos",
        )

    uploaded_files = await _upload_images(photos, storage_folder="vehicle-sales")
    image_urls = [url for _, url in uploaded_files]
    sale_reference = db.collection("vehicleSales").document()
    sale = {
        "id": sale_reference.id,
        "brand": brand.strip(),
        "model": model.strip(),
        "year": year,
        "mileage": mileage,
        "vehicleType": vehicle_type,
        "sellerWhatsApp": seller_whatsapp.strip(),
        "transmission": transmission,
        "fuel": fuel,
        "condition": condition,
        "priceUsd": price_usd,
        "priceNegotiable": price_negotiable,
        "city": city.strip(),
        "commune": commune.strip(),
        "description": description.strip(),
        "imageUrl": image_urls[0],
        "imageUrls": image_urls,
        "status": "Disponible",
        "createdBy": _gestionnaire["nom"],
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": datetime.now(timezone.utc),
    }

    try:
        sale_reference.set(sale)
    except Exception as exc:
        logger.exception("Erreur lors de l'enregistrement de l'annonce de vente dans Firebase")
        for key, _ in uploaded_files:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
            except Exception:
                logger.exception("Impossible de supprimer une photo après un échec Firebase")
        raise HTTPException(
            status_code=500,
            detail="Erreur lors de l'enregistrement de l'annonce de vente",
        ) from exc

    return {
        "success": True,
        "message": "Annonce de vente ajoutée avec succès",
        "id": sale_reference.id,
        "imageUrls": image_urls,
    }


@router.get("/api/voitures/ventes")
def lister_annonces_vente_voitures(
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    try:
        sales = []
        for document in db.collection("vehicleSales").stream():
            sale = document.to_dict()
            if sale is None:
                continue
            sale["id"] = document.id
            sales.append(sale)
    except Exception as exc:
        logger.exception("Erreur lors de la récupération des annonces de vente automobile")
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer les annonces de vente",
        ) from exc

    sales.sort(key=lambda sale: str(sale.get("createdAt", "")), reverse=True)
    return {"sales": sales}


@router.patch("/api/voitures/ventes/{sale_id}/statut")
def modifier_statut_annonce_vente_voiture(
    sale_id: str,
    update: VehicleSaleStatusUpdate,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("vehicleSales").document(sale_id)
    try:
        snapshot = reference.get()
        if not snapshot.exists:
            raise HTTPException(status_code=404, detail="Annonce de vente introuvable")
        reference.update({
            "status": update.status,
            "updatedAt": datetime.now(timezone.utc),
        })
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de la mise à jour du statut d'une annonce automobile")
        raise HTTPException(
            status_code=500,
            detail="Impossible de mettre à jour le statut de l'annonce",
        ) from exc

    return {"success": True, "id": sale_id, "status": update.status}


@router.delete("/api/voitures/ventes/{sale_id}")
def supprimer_annonce_vente_voiture(
    sale_id: str,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    reference = db.collection("vehicleSales").document(sale_id)
    try:
        snapshot = reference.get()
        if not snapshot.exists:
            raise HTTPException(status_code=404, detail="Annonce de vente introuvable")
        sale = snapshot.to_dict() or {}
        reference.delete()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de la suppression d'une annonce automobile dans Firebase")
        raise HTTPException(
            status_code=500,
            detail="Impossible de supprimer l'annonce",
        ) from exc

    failed_keys = []
    for key in _vehicle_sale_image_keys(sale):
        try:
            s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
        except (BotoCoreError, ClientError):
            logger.exception("Impossible de supprimer l'image S3 de l'annonce : %s", key)
            failed_keys.append(key)

    if failed_keys:
        raise HTTPException(
            status_code=500,
            detail=(
                "L'annonce a été supprimée, mais certaines images S3 doivent être "
                "supprimées manuellement"
            ),
        )

    return {"success": True, "message": "Annonce et images supprimées", "id": sale_id}


def _vehicle_sale_image_keys(sale: dict) -> list[str]:
    image_urls = sale.get("imageUrls")
    if not isinstance(image_urls, list):
        image_urls = []
    else:
        image_urls = list(image_urls)
    if sale.get("imageUrl"):
        image_urls.append(sale["imageUrl"])

    expected_host = f"{BUCKET_NAME}.s3.{REGION}.amazonaws.com"
    keys = []
    for image_url in image_urls:
        parsed_url = urlparse(str(image_url))
        key = unquote(parsed_url.path.lstrip("/"))
        if parsed_url.netloc != expected_host or not key.startswith("goying/vehicle-sales/"):
            logger.warning("URL d'image ignorée lors de la suppression : %s", image_url)
            continue
        if key not in keys:
            keys.append(key)
    return keys


@router.get("/api/voitures/demandes-achat")
def lister_demandes_achat_voitures(
    historique: bool = False,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    try:
        requests = []
        sales_collection = db.collection("vehicleSales")
        seller_cache = {}
        for document in db.collection("vehiclePurchaseRequests").stream():
            purchase_request = document.to_dict()
            if purchase_request is None:
                continue
            purchase_request["id"] = document.id
            if historique:
                if purchase_request.get("status") in {"Vente réalisée", "Vente annulée"}:
                    requests.append(purchase_request)
                continue

            vehicle_id = str(purchase_request.get("vehicleId") or "").strip()
            if vehicle_id and vehicle_id not in seller_cache:
                sale_snapshot = sales_collection.document(vehicle_id).get()
                if sale_snapshot.exists:
                    seller_cache[vehicle_id] = sale_snapshot.to_dict()
                else:
                    matching_sales = list(
                        sales_collection.where("id", "==", vehicle_id).limit(1).stream()
                    )
                    seller_cache[vehicle_id] = (
                        matching_sales[0].to_dict() if matching_sales else None
                    )

            sale = seller_cache.get(vehicle_id)
            if sale:
                image_urls = sale.get("imageUrls")
                purchase_request["seller"] = {
                    "sellerWhatsApp": sale.get("sellerWhatsApp"),
                    "brand": sale.get("brand"),
                    "model": sale.get("model"),
                    "year": sale.get("year"),
                    "priceUsd": sale.get("priceUsd"),
                    "city": sale.get("city"),
                    "commune": sale.get("commune"),
                    "imageUrl": sale.get("imageUrl")
                    or (image_urls[0] if isinstance(image_urls, list) and image_urls else None),
                    "imageUrls": image_urls if isinstance(image_urls, list) else [],
                    "status": sale.get("status"),
                }
            else:
                purchase_request["seller"] = None
            requests.append(purchase_request)
    except Exception as exc:
        logger.exception("Erreur lors de la récupération des demandes d'achat automobile")
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer les demandes d'achat",
        ) from exc

    requests.sort(
        key=lambda purchase_request: str(purchase_request.get("createdAt", "")),
        reverse=True,
    )
    return {"requests": requests}


@router.patch("/api/voitures/demandes-achat/{request_id}/statut")
def mettre_a_jour_statut_demande_achat_voiture(
    request_id: str,
    update: PurchaseRequestStatusUpdate,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    request_reference = db.collection("vehiclePurchaseRequests").document(request_id)
    try:
        request_snapshot = request_reference.get()
        if not request_snapshot.exists:
            raise HTTPException(status_code=404, detail="Demande d'achat introuvable")

        purchase_request = request_snapshot.to_dict() or {}
        current_status = str(purchase_request.get("status") or "Nouvelle").strip()
        allowed_statuses = PURCHASE_REQUEST_STATUS_TRANSITIONS.get(current_status)
        if allowed_statuses is None:
            raise HTTPException(
                status_code=409,
                detail=f"Le statut « {current_status} » ne permet pas cette mise à jour",
            )
        if update.status not in allowed_statuses:
            raise HTTPException(
                status_code=409,
                detail=f"Transition de statut non autorisée : {current_status} → {update.status}",
            )

        request_reference.update({
            "status": update.status,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de la mise à jour d'une demande d'achat automobile")
        raise HTTPException(
            status_code=500,
            detail="Impossible de mettre à jour le statut de la demande",
        ) from exc

    return {"success": True, "id": request_id, "status": update.status}


@router.delete("/api/voitures/demandes-achat/{request_id}")
def supprimer_demande_achat_voiture(
    request_id: str,
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    request_reference = db.collection("vehiclePurchaseRequests").document(request_id)
    try:
        request_snapshot = request_reference.get()
        if not request_snapshot.exists:
            raise HTTPException(status_code=404, detail="Demande d'achat introuvable")
        request_reference.delete()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Erreur lors de la suppression d'une demande d'achat automobile")
        raise HTTPException(
            status_code=500,
            detail="Impossible de supprimer la demande d'achat",
        ) from exc

    return {"success": True, "message": "Demande d'achat supprimée", "id": request_id}


@router.get("/api/voitures/soumissions")
def lister_soumissions_voitures(
    _gestionnaire: dict = Depends(require_role("voitures")),
):
    try:
        submissions = []
        for document in db.collection("vehicleSubmissions").stream():
            submission = document.to_dict()
            if submission is None:
                continue
            submission["id"] = document.id
            submissions.append(submission)
    except Exception as exc:
        logger.exception("Erreur lors de la récupération des soumissions de véhicules")
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer les soumissions de véhicules",
        ) from exc

    submissions.sort(
        key=lambda submission: str(submission.get("createdAt", "")),
        reverse=True,
    )
    return {"submissions": submissions}
