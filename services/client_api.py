import logging
import hashlib
import os
import re
import time
import uuid
from datetime import date, datetime, timedelta, timezone
from threading import Lock

import boto3
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field

from dependencies import require_admin, require_verified_firebase_user
from firebase import db
from services.notification_service import send_notification

router = APIRouter(tags=["parcours-client"])
logger = logging.getLogger(__name__)
BUCKET = os.environ.get("AWS_BUCKET_NAME", "gm-biblio-storage")
REGION = os.environ.get("AWS_REGION", "eu-west-3")
MAX_IMAGE_SIZE = 5 * 1024 * 1024
IMAGE_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_PARTNERSHIP_TIMES: dict[str, list[float]] = {}
_PARTNERSHIP_LOCK = Lock()


class ImageRequest(BaseModel):
    content_type: str = Field(alias="contentType")


class ImagePreparation(BaseModel):
    image: ImageRequest


class PropertyBookingRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    property_id: str = Field(alias="propertyId", min_length=1, max_length=128)
    client_name: str = Field(alias="clientName", min_length=1, max_length=160)
    client_phone: str = Field(alias="clientPhone", min_length=8, max_length=32)
    visit_date: str = Field(alias="visitDate", min_length=10, max_length=10)
    visit_time: str = Field(alias="visitTime", min_length=5, max_length=5)


class VehiclePurchaseRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    vehicle_id: str = Field(alias="vehicleId", min_length=1, max_length=128)
    buyer_name: str = Field(alias="buyerName", min_length=1, max_length=160)
    buyer_whatsapp: str = Field(alias="buyerWhatsApp", min_length=8, max_length=32)
    buyer_commune: str = Field(default="", alias="buyerCommune", max_length=160)
    consent: bool


class CarRentalBookingRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    vehicle_id: str = Field(alias="vehicleId", min_length=1, max_length=128)
    rental_date: str = Field(alias="date", min_length=10, max_length=10)
    duration_days: int = Field(alias="durationDays", ge=1, le=30)
    client_name: str = Field(alias="clientName", min_length=1, max_length=160)
    client_whatsapp: str = Field(alias="clientWhatsApp", min_length=8, max_length=32)


def _partnership_created_at(value: object) -> datetime | None:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _prepare_image(user_id: str, area: str, content_type: str):
    extension = IMAGE_TYPES.get(content_type)
    if not extension:
        raise HTTPException(status_code=400, detail="Seules les images JPEG, PNG et WebP sont acceptées")
    key = f"goying/{area}/{user_id}/{uuid.uuid4().hex}.{extension}"
    try:
        client = boto3.client("s3", region_name=REGION)
        signed = client.generate_presigned_post(
            Bucket=BUCKET, Key=key, Fields={"Content-Type": content_type},
            Conditions=[["content-length-range", 1, MAX_IMAGE_SIZE], {"Content-Type": content_type}],
            ExpiresIn=300,
        )
        return {**signed, "publicUrl": f"https://{BUCKET}.s3.{REGION}.amazonaws.com/{key}"}
    except Exception as exc:
        logger.exception("Impossible de préparer un upload S3")
        raise HTTPException(status_code=503, detail="Impossible de préparer l'envoi de la photo") from exc


@router.post("/api/property-submission-uploads")
def prepare_property_image(request: ImagePreparation, user: dict = Depends(require_verified_firebase_user)):
    return {"upload": _prepare_image(user["uid"], "property-submissions", request.image.content_type)}


@router.post("/api/vehicle-submission-uploads")
def prepare_vehicle_image(request: ImagePreparation, user: dict = Depends(require_verified_firebase_user)):
    return {"upload": _prepare_image(user["uid"], "vehicle-submissions", request.image.content_type)}


def _request_id(value: object) -> str:
    result = str(value or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", result):
        raise HTTPException(status_code=400, detail="Identifiant de demande invalide")
    return result


@router.post("/api/property-submissions", status_code=201)
def submit_property(data: dict, background_tasks: BackgroundTasks, user: dict = Depends(require_verified_firebase_user)):
    required = ("reporterName", "reporterPhone", "country", "city", "province", "commune", "quartier", "avenue", "referencePhotoUrl")
    if any(not isinstance(data.get(key), str) or not data[key].strip() or len(data[key]) > 240 for key in required):
        raise HTTPException(status_code=400, detail="Veuillez compléter les informations et ajouter la photo de référence")
    expected_photo_prefix = f"https://{BUCKET}.s3.{REGION}.amazonaws.com/goying/property-submissions/{user['uid']}/"
    if not data["referencePhotoUrl"].startswith(expected_photo_prefix):
        raise HTTPException(status_code=400, detail="La photo de référence ne provient pas du stockage autorisé")
    if not data.get("policyAcceptance"):
        raise HTTPException(status_code=400, detail="L'acceptation de la politique applicable est requise")
    phone = re.sub(r"[^0-9+]", "", data["reporterPhone"])
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(status_code=400, detail="Le numéro WhatsApp doit inclure un indicatif international")
    ref = db.collection("propertySubmissions").document(f"{user['uid']}_{_request_id(data.get('submissionRequestId'))}")
    try:
        if ref.get().exists:
            return {"id": ref.id}
        values = {key: data.get(key) for key in required + ("category", "policyAcceptance")}
        values.update({"id": ref.id, "reporterUid": user["uid"], "reporterPhone": phone, "status": "En attente", "submittedAt": datetime.now(timezone.utc)})
        ref.create(values)
        background_tasks.add_task(send_notification, "property_submission", "Nouveau bien soumis", "Un utilisateur a soumis un bien immobilier.", {"Identifiant": ref.id, "Ville": data.get("city"), "Commune": data.get("commune"), "Catégorie": data.get("category")})
        return {"id": ref.id}
    except Exception as exc:
        logger.exception("Échec de soumission immobilière")
        raise HTTPException(status_code=503, detail="La soumission immobilière n'a pas pu être enregistrée") from exc


@router.post("/api/vehicle-submissions", status_code=201)
def submit_vehicle(data: dict, background_tasks: BackgroundTasks, user: dict = Depends(require_verified_firebase_user)):
    required = ("ownerName", "ownerPhone", "brand", "model", "year", "vehicleType", "country", "city", "commune")
    if any(not isinstance(data.get(key), str) or not data[key].strip() for key in required):
        raise HTTPException(status_code=400, detail="Veuillez compléter les informations obligatoires du véhicule")
    photos = data.get("photoUrls")
    expected_photo_prefix = f"https://{BUCKET}.s3.{REGION}.amazonaws.com/goying/vehicle-submissions/{user['uid']}/"
    if not isinstance(photos, list) or not 1 <= len(photos) <= 6 or any(not isinstance(url, str) or not url.startswith(expected_photo_prefix) for url in photos):
        raise HTTPException(status_code=400, detail="Ajoutez entre une et six photos valides")
    if data.get("consent") is not True or data.get("policyAccepted") is not True or not data.get("policyAcceptance"):
        raise HTTPException(status_code=400, detail="Les consentements requis sont manquants")
    phone = re.sub(r"[^0-9+]", "", data["ownerPhone"])
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(status_code=400, detail="Le numéro WhatsApp doit inclure un indicatif international")
    ref = db.collection("vehicleSubmissions").document(f"{user['uid']}_{_request_id(data.get('submissionRequestId'))}")
    try:
        if ref.get().exists:
            return {"id": ref.id}
        allowed = set(required) | {"address", "preferredContact", "color", "transmission", "fuel", "seats", "mileage", "condition", "listingIntent", "desiredPrice", "pricePeriod", "additionalInformation", "visitAddress", "availableDays", "availableHours", "locationComment", "photoUrls", "policyAcceptance"}
        values = {key: value for key, value in data.items() if key in allowed}
        values.update({"id": ref.id, "ownerUid": user["uid"], "ownerPhone": phone, "status": "En attente", "submittedAt": datetime.now(timezone.utc)})
        ref.create(values)
        background_tasks.add_task(send_notification, "vehicle_submission", "Nouveau véhicule soumis", "Un utilisateur a soumis un véhicule à examiner.", {"Identifiant": ref.id, "Véhicule": f"{data.get('brand', '')} {data.get('model', '')}".strip(), "Ville": data.get("city"), "Intention": data.get("listingIntent")})
        return {"id": ref.id}
    except Exception as exc:
        logger.exception("Échec de soumission de véhicule")
        raise HTTPException(status_code=503, detail="La demande de véhicule n'a pas pu être enregistrée") from exc


@router.post("/api/property-bookings", status_code=201)
def create_property_booking(data: PropertyBookingRequest, background_tasks: BackgroundTasks, user: dict = Depends(require_verified_firebase_user)):
    phone = re.sub(r"[^0-9+]", "", data.client_phone)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(status_code=400, detail="Le numéro WhatsApp doit inclure un indicatif international valide")
    try:
        visit_date = date.fromisoformat(data.visit_date)
        datetime.strptime(data.visit_time, "%H:%M")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="La date ou l'heure de visite est invalide") from exc
    if visit_date < date.today():
        raise HTTPException(status_code=400, detail="La date de visite ne peut pas être passée")
    house_ref = db.collection("maisons").document(data.property_id)
    booking_ref = db.collection("propertyBookings").document()
    transaction = db.transaction()

    @firestore.transactional
    def save_booking(transaction):
        snapshot = house_ref.get(transaction=transaction)
        house = snapshot.to_dict() if snapshot.exists else None
        availability = (house or {}).get("disponibilite", (house or {}).get("availability", True))
        status_value = str((house or {}).get("statut") or (house or {}).get("status") or "").strip().lower()
        approved = (house or {}).get("approuvee") in (True, "true", 1) or status_value in ("approuvee", "approuve")
        if not house or not approved or availability in (False, "indisponible", "réservée", "reservee"):
            raise HTTPException(status_code=409, detail="Ce bien n'est plus disponible")
        transaction.create(booking_ref, {"serviceType": "Immobilier", "itemName": str(house.get("titre") or "Maison"), "status": "En attente", "statut": "En attente", "clientUid": user["uid"], "clientId": user["uid"], "clientName": data.client_name.strip(), "nom_client": data.client_name.strip(), "clientEmail": str(user.get("email") or ""), "clientWhatsApp": phone, "telephone_client": phone, "propertyId": data.property_id, "bien_id": data.property_id, "type_bien": "maison", "titre_bien": str(house.get("titre") or "Maison"), "photo_bien": str(house.get("photo_url") or ""), "localisation": str(house.get("commune") or house.get("adresse") or ""), "visitDate": data.visit_date, "visitTime": data.visit_time, "date": data.visit_date, "createdAt": datetime.now(timezone.utc)})
    try:
        save_booking(transaction)
        background_tasks.add_task(send_notification, "property_booking", "Nouvelle réservation immobilière", "Une réservation immobilière a été créée.", {"Réservation": booking_ref.id, "Bien": data.property_id, "Client": data.client_name.strip(), "Date de visite": data.visit_date})
        return {"id": booking_ref.id}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Échec de réservation immobilière")
        raise HTTPException(status_code=503, detail="La réservation immobilière n'a pas pu être enregistrée") from exc


@router.post("/api/vehicle-purchase-requests", status_code=201)
def create_vehicle_purchase_request(data: VehiclePurchaseRequest, background_tasks: BackgroundTasks, user: dict = Depends(require_verified_firebase_user)):
    phone = re.sub(r"[^0-9+]", "", data.buyer_whatsapp)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(status_code=400, detail="Le numéro WhatsApp doit inclure un indicatif international valide")
    if data.consent is not True:
        raise HTTPException(status_code=400, detail="Votre consentement est requis")
    sales = db.collection("vehicleSales")
    sale_ref = sales.document(data.vehicle_id)
    sale_snapshot = sale_ref.get()
    if not sale_snapshot.exists:
        matching = list(sales.where("id", "==", data.vehicle_id).limit(1).stream())
        if not matching:
            raise HTTPException(status_code=404, detail="Cette annonce de véhicule est introuvable")
        sale_ref, sale_snapshot = matching[0].reference, matching[0]
    if str((sale_snapshot.to_dict() or {}).get("status") or "").strip().lower() != "disponible":
        raise HTTPException(status_code=409, detail="Ce véhicule n'est plus disponible à l'achat")
    request_key = hashlib.sha256(f"{user['uid']}:{sale_ref.id}".encode("utf-8")).hexdigest()
    request_ref = db.collection("vehiclePurchaseRequests").document(request_key)
    transaction = db.transaction()

    @firestore.transactional
    def save_request(transaction):
        if request_ref.get(transaction=transaction).exists:
            raise HTTPException(status_code=409, detail="Vous avez déjà envoyé une demande pour ce véhicule")
        current = sale_ref.get(transaction=transaction)
        if not current.exists or str((current.to_dict() or {}).get("status") or "").strip().lower() != "disponible":
            raise HTTPException(status_code=409, detail="Ce véhicule n'est plus disponible à l'achat")
        transaction.create(request_ref, {
            "id": request_ref.id, "vehicleId": data.vehicle_id,
            "buyerUid": user["uid"], "buyerName": data.buyer_name.strip(),
            "buyerWhatsApp": phone, "buyerCommune": data.buyer_commune.strip(),
            "consent": True, "status": "Nouvelle", "createdAt": datetime.now(timezone.utc),
        })
    try:
        save_request(transaction)
        background_tasks.add_task(send_notification, "vehicle_purchase_request", "Nouvelle demande d'achat de véhicule", "Un acheteur a envoyé une demande pour une annonce disponible.", {"Demande": request_ref.id, "Véhicule": data.vehicle_id, "Acheteur": data.buyer_name.strip(), "Commune": data.buyer_commune.strip()})
        return {"id": request_ref.id, "status": "Nouvelle"}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Échec de la demande d'achat de véhicule")
        raise HTTPException(status_code=503, detail="La demande d'achat n'a pas pu être enregistrée") from exc


@router.post("/api/car-bookings", status_code=201)
def create_car_booking(data: CarRentalBookingRequest, background_tasks: BackgroundTasks, user: dict = Depends(require_verified_firebase_user)):
    phone = re.sub(r"[^0-9+]", "", data.client_whatsapp)
    if not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(status_code=400, detail="Le numéro WhatsApp doit inclure un indicatif international valide")
    try:
        start = date.fromisoformat(data.rental_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="La date de réservation est invalide") from exc
    if start < date.today():
        raise HTTPException(status_code=400, detail="La date de réservation ne peut pas être passée")
    end = start + timedelta(days=data.duration_days)
    vehicle_ref = db.collection("vehicles").document(data.vehicle_id)
    booking_ref = db.collection("carBookings").document()
    transaction = db.transaction()

    @firestore.transactional
    def save_booking(transaction):
        vehicle_snapshot = vehicle_ref.get(transaction=transaction)
        vehicle = vehicle_snapshot.to_dict() if vehicle_snapshot.exists else None
        if not vehicle:
            raise HTTPException(status_code=404, detail="Véhicule introuvable")
        available = vehicle.get("isAvailable", True) is not False
        status_value = str(vehicle.get("status") or vehicle.get("statut") or vehicle.get("disponibilite") or "").strip().lower()
        if not available or status_value in {"indisponible", "réservé", "reserve", "reserved", "booked"}:
            raise HTTPException(status_code=409, detail="Ce véhicule n'est plus disponible")
        price = vehicle.get("pricePerDay", vehicle.get("prixParJour"))
        if isinstance(price, bool) or not isinstance(price, (int, float)) or price <= 0:
            raise HTTPException(status_code=409, detail="Le prix de location de ce véhicule est indisponible")
        queries = [
            db.collection("carBookings").where("vehicleId", "==", data.vehicle_id),
            db.collection("carBookings").where("bien_id", "==", data.vehicle_id),
        ]
        existing_records = {}
        for query in queries:
            for existing in transaction.get(query):
                existing_records[existing.id] = existing
        for existing in existing_records.values():
            record = existing.to_dict() or {}
            existing_status = str(record.get("status") or record.get("statut") or "").strip().lower()
            if existing_status in {"annulé", "annule", "cancelled", "terminé", "termine", "completed"}:
                continue
            old_start, old_end = record.get("rentalStartDate"), record.get("rentalEndDate")
            if old_start and old_end and str(old_start) < end.isoformat() and str(old_end) > start.isoformat():
                raise HTTPException(status_code=409, detail="Ce véhicule est déjà réservé pour ces dates")
            if not old_start and str(record.get("date") or record.get("date_reservation") or "")[:10] == start.isoformat():
                raise HTTPException(status_code=409, detail="Ce véhicule est déjà réservé à cette date")
        name = data.client_name.strip()
        total = round(float(price) * data.duration_days, 2)
        transaction.create(booking_ref, {
            "serviceType": "Automobile", "itemName": f"{vehicle.get('brand', '')} {vehicle.get('model', '')}".strip(),
            "status": "En attente", "statut": "En attente", "clientUid": user["uid"], "clientId": user["uid"],
            "clientName": name, "nom_client": name, "clientEmail": str(user.get("email") or ""),
            "clientWhatsApp": phone, "telephone_client": phone, "vehicleId": data.vehicle_id, "bien_id": data.vehicle_id,
            "titre_bien": f"{vehicle.get('brand', '')} {vehicle.get('model', '')}".strip(),
            "photo_bien": str(vehicle.get("imageUrl") or vehicle.get("photo_url") or ""),
            "rentalStartDate": start.isoformat(), "rentalEndDate": end.isoformat(), "durationDays": data.duration_days,
            "date": start.isoformat(), "prix": float(price), "totalPrice": total,
            "devise": str(vehicle.get("currency") or ""), "createdAt": datetime.now(timezone.utc),
        })
        return total
    try:
        total = save_booking(transaction)
        background_tasks.add_task(send_notification, "car_booking", "Nouvelle réservation automobile", "Une réservation de véhicule a été créée.", {"Réservation": booking_ref.id, "Véhicule": data.vehicle_id, "Client": data.client_name.strip(), "Début": start.isoformat(), "Durée (jours)": data.duration_days})
        return {"id": booking_ref.id, "status": "En attente", "totalPrice": total}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Échec de réservation automobile")
        raise HTTPException(status_code=503, detail="La réservation n'a pas pu être enregistrée") from exc


@router.post("/api/partnership-requests", status_code=201)
def create_partnership(data: dict, request: Request, background_tasks: BackgroundTasks):
    now = time.time()
    key = request.client.host if request.client else "unknown"
    with _PARTNERSHIP_LOCK:
        recent = [value for value in _PARTNERSHIP_TIMES.get(key, []) if now - value < 3600]
        if len(recent) >= 5:
            raise HTTPException(status_code=429, detail="Trop de propositions ont été envoyées. Réessayez plus tard.")
        _PARTNERSHIP_TIMES[key] = recent + [now]
    fields = ("organizationName", "entityType", "contactName", "officialEmail", "phone", "collaborationArea")
    if any(not isinstance(data.get(field), str) or not data[field].strip() for field in fields):
        raise HTTPException(status_code=400, detail="Veuillez renseigner tous les champs obligatoires du partenariat")
    email = data["officialEmail"].strip().lower()
    phone = re.sub(r"[^0-9+]", "", data["phone"])
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or not re.fullmatch(r"\+[1-9]\d{7,14}", phone):
        raise HTTPException(status_code=400, detail="L'adresse e-mail ou le numéro WhatsApp est invalide")
    values = {field: data[field].strip() for field in fields}
    values.update({"officialEmail": email, "phone": phone, "status": "nouveau", "createdAt": datetime.now(timezone.utc)})
    try:
        ref = db.collection("partnershipRequests").document()
        ref.create(values)
        background_tasks.add_task(send_notification, "partnership_request", "Nouvelle demande de partenariat", "Une organisation a soumis une proposition de partenariat.", {"Demande": ref.id, "Organisation": values["organizationName"], "Contact": values["contactName"], "Domaine": values["collaborationArea"]})
        return {"id": ref.id}
    except Exception as exc:
        logger.exception("Échec de proposition de partenariat")
        raise HTTPException(status_code=503, detail="La proposition de partenariat n'a pas pu être enregistrée") from exc


@router.get("/api/partnership-requests")
def list_partnership_requests(
    limit: int = 50,
    cursor: str | None = None,
    user: dict = Depends(require_admin),
):
    try:
        if not 1 <= limit <= 100:
            raise HTTPException(status_code=400, detail="La limite doit être comprise entre 1 et 100")
        # Stream the collection so Firestore's order_by index cannot exclude legacy
        # documents that have no createdAt field. Use an immutable, deterministic
        # key (timestamp then document ID); undated/invalid dates follow dated rows.
        all_documents = list(db.collection("partnershipRequests").stream())
        def sort_key(document):
            data = document.to_dict() or {}
            created_at = _partnership_created_at(data.get("createdAt"))
            return (created_at is None, -(created_at.timestamp()) if created_at else 0, document.id)
        all_documents.sort(key=sort_key)
        start_index = 0
        if cursor:
            cursor_index = next((index for index, document in enumerate(all_documents) if document.id == cursor), None)
            if cursor_index is None:
                raise HTTPException(status_code=400, detail="Curseur de pagination invalide")
            start_index = cursor_index + 1
        documents = all_documents[start_index:start_index + limit]
        has_more = start_index + limit < len(all_documents)
        requests = []
        allowed_fields = (
            "organizationName", "entityType", "contactName", "officialEmail",
            "phone", "collaborationArea", "status", "createdAt", "updatedAt",
        )
        for document in documents:
            data = document.to_dict() or {}
            item = {"id": document.id}
            for field in allowed_fields:
                value = data.get(field)
                if field in {"createdAt", "updatedAt"}:
                    value = value.isoformat() if hasattr(value, "isoformat") else value if isinstance(value, str) else None
                item[field] = value
            requests.append(item)
        return {"requests": requests, "nextCursor": documents[-1].id if has_more and documents else None}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible de charger les propositions de partenariat")
        raise HTTPException(status_code=503, detail="Les propositions de partenariat ne sont pas disponibles") from exc


@router.patch("/api/partnership-requests/{request_id}")
def update_partnership_request(
    request_id: str,
    data: dict,
    user: dict = Depends(require_admin),
):
    if set(data) != {"status"} or data.get("status") not in {"nouveau", "en_cours", "acceptee", "refusee"}:
        raise HTTPException(status_code=400, detail="Statut de traitement invalide")
    reference = db.collection("partnershipRequests").document(_request_id(request_id))
    try:
        snapshot = reference.get()
        if not snapshot.exists:
            raise HTTPException(status_code=404, detail="Demande de partenariat introuvable")
        reference.update({"status": data["status"], "updatedAt": datetime.now(timezone.utc)})
        return {"id": request_id, "status": data["status"]}
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible de mettre à jour la demande de partenariat")
        raise HTTPException(status_code=503, detail="La demande n'a pas pu être mise à jour") from exc
