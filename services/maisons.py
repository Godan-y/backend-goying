import os
import json
import uuid
import logging
import unicodedata
from datetime import datetime, timezone
from urllib.parse import unquote, urlparse

import boto3

from fastapi import APIRouter, Depends, Request, UploadFile, File, Form, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from firebase import db
from firebase_admin import firestore
from dependencies import require_role


router = APIRouter()
templates = Jinja2Templates(directory="templates")

logger = logging.getLogger(__name__)


# ============================================================
# AWS S3
# ============================================================

AWS_ACCESS_KEY = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
BUCKET_NAME = os.environ.get("AWS_BUCKET_NAME", "gm-biblio-storage")
REGION = os.environ.get("AWS_REGION", "eu-west-3")

# Debug: do not log secrets
logger.info("AWS ACCESS present: %s", bool(AWS_ACCESS_KEY))
logger.info("AWS SECRET present: %s", bool(AWS_SECRET_KEY))
logger.info("AWS BUCKET: %s", BUCKET_NAME)
logger.info("AWS REGION: %s", REGION)


s3_client = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY,
    aws_secret_access_key=AWS_SECRET_KEY,
    region_name=REGION,
)


# ============================================================
# PAGES HTML
# ============================================================


@router.get(
    "/dashboard/maisons",
    response_class=HTMLResponse,
    name="maisons_dashboard_page",
)
def dashboard_maisons(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="maisons.html",
        context={}
    )


@router.get("/maisons/ajouter", response_class=HTMLResponse)
def page_ajouter_maison(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="ajouter_maison.html",
        context={}
    )


@router.get("/maisons/{maison_id}/modifier", response_class=HTMLResponse)
def page_modifier_maison(request: Request, maison_id: str):
    return templates.TemplateResponse(
        request=request,
        name="modifier_maison.html",
        context={"maison_id": maison_id},
    )


@router.get("/maisons", response_class=HTMLResponse)
def liste_maisons(request: Request):
    maisons = []
    error = None

    try:
        documents = db.collection("maisons").order_by(
            "createdAt",
            direction=firestore.Query.DESCENDING,
        ).stream()

        for document in documents:
            maison = document.to_dict()
            maison["id"] = document.id
            maisons.append(maison)

    except Exception as e:
        error = str(e)
        logger.exception("Erreur lors de la récupération des maisons")

    return templates.TemplateResponse(
        request=request,
        name="maisons_ajoutees.html",
        context={"maisons": maisons, "error": error},
    )


@router.get("/maisons/approuvees", response_class=HTMLResponse)
def page_maisons_approuvees(request: Request):
    maisons = []
    error = None

    try:
        documents = (
            db.collection("maisons")
            .where("approuvee", "==", True)
            .order_by("createdAt", direction=firestore.Query.DESCENDING)
            .stream()
        )

        for document in documents:
            maison = document.to_dict()
            maison["id"] = document.id
            maisons.append(maison)

    except Exception as e:
        error = str(e)
        logger.exception("Erreur lors de la récupération des maisons approuvées")

    return templates.TemplateResponse(
        request=request,
        name="maisons_approuvees.html",
        context={"maisons": maisons, "error": error},
    )


@router.get("/maisons/disponibles", response_class=HTMLResponse)
def page_maisons_disponibles(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="maisons_disponibles.html",
        context={}
    )


@router.get("/maisons/prises", response_class=HTMLResponse)
def page_maisons_prises(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="maisons_prises.html",
        context={}
    )


@router.get("/maisons/reservees", response_class=HTMLResponse)
def page_maisons_reservees(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="maisons_reservees.html",
        context={},
    )


@router.get("/maisons/soumises", response_class=HTMLResponse)
def page_maisons_soumises(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="maisons_soumises.html",
        context={},
    )


@router.get("/maisons/api/reservations")
def reservations_maisons(_gestionnaire: dict = Depends(require_role("maisons"))):
    reservations = []
    try:
        properties = {}
        for document in db.collection("propertyBookings").stream():
            reservation = document.to_dict() or {}
            if str(reservation.get("serviceType", "")).strip().lower() != "immobilier":
                continue
            reservation["id"] = document.id
            property_id = _reservation_property_id(reservation)
            if property_id:
                if property_id not in properties:
                    property_snapshot = db.collection("maisons").document(property_id).get()
                    properties[property_id] = (
                        property_snapshot.to_dict() or {}
                        if property_snapshot.exists
                        else {}
                    )
                reservation["property"] = {
                    **(
                        reservation.get("property")
                        if isinstance(reservation.get("property"), dict)
                        else {}
                    ),
                    **properties[property_id],
                    "id": property_id,
                }
            reservations.append(reservation)
    except Exception as e:
        logger.exception("Erreur lors de la récupération des maisons réservées")
        raise HTTPException(status_code=500, detail=f"Erreur Firebase : {str(e)}")

    reservations.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
    return {"reservations": reservations}


@router.get("/maisons/api/soumises")
def maisons_soumises(_gestionnaire: dict = Depends(require_role("maisons"))):
    try:
        submissions = []
        for document in db.collection("propertySubmissions").stream():
            submission = document.to_dict()
            submission["id"] = document.id
            submissions.append(submission)
    except Exception as exc:
        logger.exception("Erreur lors de la récupération des maisons soumises")
        raise HTTPException(
            status_code=500,
            detail="Impossible de récupérer les maisons soumises",
        ) from exc

    submissions.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
    return {"submissions": submissions}


@router.delete("/maisons/api/soumises/{submission_id}")
def supprimer_maison_soumise(
    submission_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    reference = db.collection("propertySubmissions").document(submission_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Maison soumise introuvable")

    submission = snapshot.to_dict()
    reference.delete()

    image_key = _trusted_submission_s3_key(submission.get("referencePhotoUrl"))
    if image_key:
        try:
            s3_client.delete_object(Bucket=BUCKET_NAME, Key=image_key)
        except Exception as exc:
            logger.exception("Impossible de supprimer l'image de la soumission %s", submission_id)
            raise HTTPException(
                status_code=502,
                detail={
                    "message": "Soumission supprimée de Firestore, mais sa photo S3 n'a pas pu être supprimée",
                    "deleted_from_firestore": True,
                },
            ) from exc

    return {"message": "Maison soumise supprimée", "id": submission_id}


@router.patch("/maisons/api/reservations/{reservation_id}/approuver")
def approuver_reservation_maison(
    reservation_id: str,
    gestionnaire: dict = Depends(require_role("maisons")),
):
    reservation_reference = db.collection("propertyBookings").document(reservation_id)
    transaction = db.transaction()

    @firestore.transactional
    def approve_booking(transaction):
        reservation_snapshot = reservation_reference.get(transaction=transaction)
        if not reservation_snapshot.exists:
            raise HTTPException(status_code=404, detail="Réservation immobilière introuvable")

        reservation = reservation_snapshot.to_dict() or {}
        if str(reservation.get("serviceType", "")).strip().lower() != "immobilier":
            raise HTTPException(status_code=404, detail="Réservation immobilière introuvable")
        status = _normaliser_statut(reservation.get("status") or reservation.get("statut"))
        if status in {"annule", "annulee", "refuse", "refusee", "cancelled", "canceled"}:
            raise HTTPException(
                status_code=409,
                detail="Cette réservation a été annulée et ne peut plus être approuvée",
            )
        if _reservation_est_approuvee(reservation):
            raise HTTPException(status_code=409, detail="Cette réservation a déjà été approuvée")
        if status not in {"en attente", "en_attente", "pending"}:
            raise HTTPException(
                status_code=409,
                detail="Le statut de cette réservation ne permet pas son approbation",
            )

        property_id = _reservation_property_id(reservation)
        if not property_id:
            raise HTTPException(status_code=400, detail="La réservation ne contient aucune maison liée")

        property_reference = db.collection("maisons").document(property_id)
        property_snapshot = property_reference.get(transaction=transaction)
        if not property_snapshot.exists:
            raise HTTPException(status_code=404, detail="Maison liée à la réservation introuvable")
        property_data = property_snapshot.to_dict() or {}
        if not _maison_est_disponible(property_data):
            raise HTTPException(
                status_code=409,
                detail="Cette maison est déjà indisponible ou sa disponibilité ne peut pas être confirmée",
            )

        for field in ("propertyId", "bien_id"):
            matching_bookings = db.collection("propertyBookings").where(field, "==", property_id)
            for other_snapshot in transaction.get(matching_bookings):
                if other_snapshot.id == reservation_id:
                    continue
                other_booking = other_snapshot.to_dict() or {}
                if (
                    str(other_booking.get("serviceType", "")).strip().lower() == "immobilier"
                    and _reservation_est_approuvee(other_booking)
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="Une autre réservation approuvée est déjà liée à cette maison",
                    )

        now = datetime.now(timezone.utc)
        transaction.update(reservation_reference, {
            "status": "Confirmé",
            "approved": True,
            "acknowledgedByProvider": True,
            "acknowledgedAt": now,
            "approvedBy": gestionnaire["nom"],
        })
        transaction.update(property_reference, {
            "statut": "indisponible",
            "disponibilite": "indisponible",
            "reservedByBookingId": reservation_id,
        })
        return property_id

    property_id = approve_booking(transaction)

    return {
        "message": "Réservation approuvée et maison rendue indisponible",
        "reservation_id": reservation_id,
        "property_id": property_id,
        "status": "Confirmé",
        "disponibilite": "indisponible",
    }


@router.patch("/maisons/api/reservations/{reservation_id}/liberer")
def liberer_reservation_maison(
    reservation_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    reservation_reference = db.collection("propertyBookings").document(reservation_id)
    transaction = db.transaction()

    @firestore.transactional
    def release_booking(transaction):
        reservation_snapshot = reservation_reference.get(transaction=transaction)
        if not reservation_snapshot.exists:
            raise HTTPException(status_code=404, detail="Réservation immobilière introuvable")

        reservation = reservation_snapshot.to_dict() or {}
        if str(reservation.get("serviceType", "")).strip().lower() != "immobilier":
            raise HTTPException(status_code=404, detail="Réservation immobilière introuvable")
        if not _reservation_est_approuvee(reservation):
            raise HTTPException(
                status_code=409,
                detail="Seule une réservation approuvée peut libérer cette maison",
            )

        property_id = _reservation_property_id(reservation)
        if not property_id:
            raise HTTPException(status_code=400, detail="La réservation ne contient aucune maison liée")

        property_reference = db.collection("maisons").document(property_id)
        property_snapshot = property_reference.get(transaction=transaction)
        if not property_snapshot.exists:
            raise HTTPException(status_code=404, detail="Maison liée à la réservation introuvable")
        property_data = property_snapshot.to_dict() or {}
        if property_data.get("reservedByBookingId") != reservation_id:
            raise HTTPException(
                status_code=409,
                detail="Cette réservation n'est pas enregistrée comme étant à l'origine de l'indisponibilité. Vérifiez la disponibilité depuis la gestion des maisons.",
            )

        for field in ("propertyId", "bien_id"):
            matching_bookings = db.collection("propertyBookings").where(field, "==", property_id)
            for other_snapshot in transaction.get(matching_bookings):
                if other_snapshot.id == reservation_id:
                    continue
                other_booking = other_snapshot.to_dict() or {}
                if (
                    str(other_booking.get("serviceType", "")).strip().lower() == "immobilier"
                    and _reservation_est_approuvee(other_booking)
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="Une autre réservation approuvée est liée à cette maison. Elle ne peut pas être libérée ici.",
                    )

        transaction.update(reservation_reference, {
            "status": "Annulée",
            "approved": False,
            "acknowledgedByProvider": False,
            "releasedAt": datetime.now(timezone.utc),
        })
        transaction.update(property_reference, {
            "statut": "disponible",
            "disponibilite": "disponible",
            "reservedByBookingId": firestore.DELETE_FIELD,
        })
        return property_id

    property_id = release_booking(transaction)

    return {
        "message": "Maison remise disponible et réaffichée",
        "reservation_id": reservation_id,
        "property_id": property_id,
        "status": "Annulée",
        "disponibilite": "disponible",
    }


def _reservation_property_id(reservation: dict) -> str:
    return str(reservation.get("propertyId") or reservation.get("bien_id") or "").strip()


def _normaliser_statut(value: object) -> str:
    return unicodedata.normalize("NFD", str(value or "").strip().lower()).encode(
        "ascii",
        "ignore",
    ).decode("ascii")


def _reservation_est_approuvee(reservation: dict) -> bool:
    statut = _normaliser_statut(reservation.get("status") or reservation.get("statut"))
    if statut in {"annule", "annulee", "refuse", "refusee", "cancelled", "canceled"}:
        return False
    return reservation.get("approved") is True or statut in {
        "confirme",
        "approuve",
        "confirmed",
        "approved",
    }


def _maison_est_disponible(maison: dict) -> bool:
    if maison.get("reservedByBookingId"):
        return False
    statut = _normaliser_statut(maison.get("statut"))
    if maison.get("approuvee") and statut in {"a_louer", "a_vendre"}:
        return True
    if statut in {"disponible", "available"}:
        return True
    return False


# ============================================================
# AJOUTER UNE MAISON
# ============================================================


@router.get("/api/maisons")
def api_liste_maisons(statut: str | None = None):
    maisons = []

    try:
        reservations_approuvees = set()
        for reservation_document in db.collection("propertyBookings").stream():
            reservation = reservation_document.to_dict()
            if _reservation_est_approuvee(reservation):
                property_id = _reservation_property_id(reservation)
                if property_id:
                    reservations_approuvees.add(property_id)

        documents = db.collection("maisons").stream()
        for document in documents:
            maison = document.to_dict()
            maison["id"] = document.id
            maison_statut = maison.get("statut")
            if maison.get("approuvee") and maison_statut in ["a_vendre", "a_louer"]:
                maison_statut = "disponible"
            if document.id in reservations_approuvees and (statut is None or statut == "disponible"):
                continue
            if statut and maison_statut != statut:
                continue
            maison["statut"] = maison_statut
            maisons.append(maison)
    except Exception as e:
        logger.exception("Erreur lors de la récupération des maisons pour l'API")
        raise HTTPException(status_code=500, detail=f"Erreur Firebase : {str(e)}")

    return maisons


@router.get("/api/maisons/statistiques")
def statistiques_maisons():
    try:
        maisons = [document.to_dict() or {} for document in db.collection("maisons").stream()]
    except Exception as e:
        logger.exception("Erreur lors du calcul des statistiques des maisons")
        raise HTTPException(status_code=500, detail=f"Erreur Firebase : {str(e)}")

    return _statistiques_maisons(maisons)


def _statistiques_maisons(maisons: list[dict]) -> dict[str, int]:
    total = len(maisons)
    approuvees = sum(1 for maison in maisons if maison.get("approuvee"))
    disponibles = 0
    prises = 0

    for maison in maisons:
        statut = maison.get("statut")
        if maison.get("approuvee") and statut in ["a_vendre", "a_louer"]:
            statut = "disponible"
        if statut == "disponible":
            disponibles += 1
        elif statut == "indisponible":
            prises += 1

    return {
        "total": total,
        "approuvees": approuvees,
        "disponibles": disponibles,
        "prises": prises,
    }


@router.get("/maisons/api/dashboard")
def donnees_dashboard_maisons(
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    try:
        maisons = []
        for document in db.collection("maisons").stream():
            maison = document.to_dict() or {}
            maison["id"] = document.id
            maisons.append(maison)

        maisons.sort(key=lambda item: str(item.get("createdAt", "")), reverse=True)
        maison_ids = {maison["id"] for maison in maisons}

        submissions = list(db.collection("propertySubmissions").stream())
        reservations = []
        maisons_reservees = set()
        for document in db.collection("propertyBookings").stream():
            reservation = document.to_dict() or {}
            if str(reservation.get("serviceType", "")).strip().lower() != "immobilier":
                continue

            reservation["id"] = document.id
            reservations.append(reservation)
            if _reservation_est_approuvee(reservation):
                maison_id = _reservation_property_id(reservation)
                if maison_id:
                    maisons_reservees.add(maison_id)

        reservations.sort(
            key=lambda item: str(item.get("createdAt", "")),
            reverse=True,
        )
        houses_for_preview = [
            {
                key: _dashboard_json_value(maison.get(key))
                for key in (
                    "id",
                    "titre",
                    "type_maison",
                    "commune",
                    "quartier",
                    "avenue",
                    "type",
                    "prix",
                    "devise",
                    "photo_url",
                    "photo_urls",
                    "approuvee",
                    "statut",
                    "disponibilite",
                    "createdAt",
                )
                if key in maison
            }
            for maison in maisons[:4]
        ]
        booking_previews = []
        for reservation in reservations[:4]:
            property_id = _reservation_property_id(reservation)
            property_data = next(
                (maison for maison in maisons if maison["id"] == property_id),
                {},
            )
            booking_previews.append({
                "id": reservation["id"],
                "title": reservation.get("titre_bien")
                or reservation.get("itemName")
                or property_data.get("titre"),
                "clientName": reservation.get("clientName")
                or reservation.get("nom_client"),
                "date": _dashboard_json_value(reservation.get("date")),
                "createdAt": _dashboard_json_value(reservation.get("createdAt")),
                "costInfo": reservation.get("costInfo"),
                "status": reservation.get("status") or reservation.get("statut"),
                "location": reservation.get("localisation")
                or property_data.get("commune"),
            })

        statistics = _statistiques_maisons(maisons)
        statistics.update({
            "reservees": len(maisons_reservees.intersection(maison_ids)),
            "soumises": len(submissions),
        })
    except Exception as exc:
        logger.exception("Erreur lors du chargement du dashboard maisons")
        raise HTTPException(
            status_code=500,
            detail="Impossible de charger les données du dashboard maisons",
        ) from exc

    return {
        "statistics": statistics,
        "maisons": houses_for_preview,
        "reservations": booking_previews,
    }


def _dashboard_json_value(value):
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _parse_informations_personnalisees(value: str) -> list[dict[str, str]]:
    try:
        informations = json.loads(value or "[]")
        if not isinstance(informations, list):
            raise ValueError
        return [
            {
                "nom": str(information.get("nom", "")).strip(),
                "valeur": str(information.get("valeur", "")).strip(),
            }
            for information in informations
            if isinstance(information, dict)
            and (str(information.get("nom", "")).strip() or str(information.get("valeur", "")).strip())
        ]
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=400,
            detail="Les informations supplémentaires sont invalides",
        ) from exc


async def _upload_house_photos(photos: list[UploadFile]) -> list[tuple[str, str]]:
    if any(not photo.filename for photo in photos):
        raise HTTPException(status_code=400, detail="Chaque photo doit avoir un nom de fichier")
    if any(not photo.content_type or not photo.content_type.startswith("image/") for photo in photos):
        raise HTTPException(status_code=400, detail="Tous les fichiers doivent être des images")

    fichiers_uploades = []
    try:
        for photo in photos:
            extension = os.path.splitext(photo.filename)[1].lower()
            nom_fichier = f"goying/maisons/{uuid.uuid4()}{extension}"
            contenu = await photo.read()
            s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=nom_fichier,
                Body=contenu,
                ContentType=photo.content_type,
            )
            fichiers_uploades.append(
                (nom_fichier, f"https://{BUCKET_NAME}.s3.{REGION}.amazonaws.com/{nom_fichier}")
            )
    except Exception as exc:
        for nom_fichier, _ in fichiers_uploades:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=nom_fichier)
            except Exception:
                logger.exception("Impossible de nettoyer l'image S3 %s", nom_fichier)
        raise HTTPException(status_code=500, detail=f"Erreur upload S3 : {str(exc)}") from exc

    return fichiers_uploades


def _house_fields(
    commune: str = "",
    quartier: str = "",
    avenue: str = "",
    titre: str = "",
    type_maison: str = "",
    description: str = "",
    informations_complementaires: str = "",
    informations_personnalisees: str = "[]",
    chambres: int | None = None,
    superficie: str = "",
    salles_bains: int | None = None,
    prix: float | None = None,
    type: str = "",
    telephone: str = "",
) -> dict:
    return {
        "commune": commune.strip(),
        "quartier": quartier.strip(),
        "avenue": avenue.strip(),
        "titre": titre.strip(),
        "type_maison": type_maison.strip(),
        "description": description.strip(),
        "informations_complementaires": informations_complementaires.strip(),
        "informations_personnalisees": _parse_informations_personnalisees(informations_personnalisees),
        "chambres": chambres,
        "superficie": superficie.strip(),
        "salles_bains": salles_bains,
        "prix": prix,
        "type": type.strip(),
        "telephone": telephone.strip(),
    }


def _trusted_house_s3_key(photo_url: object) -> str | None:
    if not isinstance(photo_url, str):
        return None
    parsed = urlparse(photo_url)
    trusted_hosts = {
        f"{BUCKET_NAME}.s3.{REGION}.amazonaws.com",
        f"{BUCKET_NAME}.s3.amazonaws.com",
    }
    key = unquote(parsed.path).lstrip("/")
    if parsed.scheme != "https" or parsed.netloc.lower() not in trusted_hosts:
        return None
    if not key.startswith("goying/maisons/") or not key[len("goying/maisons/"):]:
        return None
    return key


def _trusted_submission_s3_key(photo_url: object) -> str | None:
    if not isinstance(photo_url, str):
        return None
    parsed = urlparse(photo_url)
    trusted_hosts = {
        f"{BUCKET_NAME}.s3.{REGION}.amazonaws.com",
        f"{BUCKET_NAME}.s3.amazonaws.com",
    }
    key = unquote(parsed.path).lstrip("/")
    if parsed.scheme != "https" or parsed.netloc.lower() not in trusted_hosts:
        return None
    if not key.startswith("goying/property-submissions/") or not key[len("goying/property-submissions/"):]:
        return None
    return key


@router.get("/api/maisons/{maison_id}")
def recuperer_maison(
    maison_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    document = db.collection("maisons").document(maison_id).get()
    if not document.exists:
        raise HTTPException(status_code=404, detail="Maison introuvable")
    maison = document.to_dict()
    maison["id"] = document.id
    return maison


@router.put("/api/maisons/{maison_id}")
async def modifier_maison(
    maison_id: str,
    commune: str = Form(""),
    quartier: str = Form(""),
    avenue: str = Form(""),
    titre: str = Form(""),
    type_maison: str = Form(...),
    description: str = Form(""),
    informations_complementaires: str = Form(""),
    informations_personnalisees: str = Form("[]"),
    chambres: int | None = Form(None),
    superficie: str = Form(""),
    salles_bains: int | None = Form(None),
    prix: float | None = Form(None),
    type: str = Form(""),
    telephone: str = Form(""),
    photos: list[UploadFile] | None = File(None),
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    reference = db.collection("maisons").document(maison_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Maison introuvable")

    maison = _house_fields(
        commune, quartier, avenue, titre, type_maison, description,
        informations_complementaires, informations_personnalisees, chambres,
        superficie, salles_bains, prix, type, telephone,
    )
    nouvelles_photos = [photo for photo in (photos or []) if photo.filename]
    fichiers_uploades = await _upload_house_photos(nouvelles_photos) if nouvelles_photos else []
    anciennes_photos = snapshot.to_dict().get("photo_urls") or []
    if not anciennes_photos and snapshot.to_dict().get("photo_url"):
        anciennes_photos = [snapshot.to_dict()["photo_url"]]
    photo_urls = [str(url) for url in anciennes_photos] + [url for _, url in fichiers_uploades]
    if photo_urls:
        maison.update({"photo_urls": photo_urls, "photo_url": photo_urls[0]})

    try:
        reference.update(maison)
    except Exception as exc:
        for nom_fichier, _ in fichiers_uploades:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=nom_fichier)
            except Exception:
                logger.exception("Impossible de nettoyer l'image S3 %s", nom_fichier)
        raise HTTPException(status_code=500, detail=f"Erreur Firebase : {str(exc)}") from exc

    maison["id"] = maison_id
    return {"success": True, "message": "Maison modifiée avec succès", "maison": maison}


@router.delete("/api/maisons/{maison_id}")
def supprimer_maison(
    maison_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    reference = db.collection("maisons").document(maison_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Maison introuvable")

    maison = snapshot.to_dict()
    reference.delete()

    photo_urls = list(maison.get("photo_urls") or [])
    if maison.get("photo_url"):
        photo_urls.append(maison["photo_url"])
    keys = {key for key in (_trusted_house_s3_key(url) for url in photo_urls) if key}
    echecs = []
    for key in keys:
        try:
            s3_client.delete_object(Bucket=BUCKET_NAME, Key=key)
        except Exception as exc:
            logger.exception("Impossible de supprimer l'image S3 %s", key)
            echecs.append({"key": key, "error": str(exc)})

    if echecs:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "Maison supprimée de Firestore, mais certaines images S3 n'ont pas été supprimées",
                "deleted_from_firestore": True,
                "s3_failures": echecs,
            },
        )
    return {"success": True, "message": "Maison et images associées supprimées avec succès"}


@router.post("/api/maisons")
async def ajouter_maison(
    commune: str = Form(""),
    quartier: str = Form(""),
    avenue: str = Form(""),
    titre: str = Form(""),
    type_maison: str = Form(...),
    description: str = Form(""),
    informations_complementaires: str = Form(""),
    informations_personnalisees: str = Form("[]"),
    chambres: int | None = Form(None),
    superficie: str = Form(""),
    salles_bains: int | None = Form(None),
    prix: float | None = Form(None),
    type: str = Form(""),
    telephone: str = Form(""),
    photos: list[UploadFile] | None = File(None),
):

    photos = [photo for photo in (photos or []) if photo.filename]
    maison = _house_fields(
        commune, quartier, avenue, titre, type_maison, description,
        informations_complementaires, informations_personnalisees, chambres,
        superficie, salles_bains, prix, type, telephone,
    )
    fichiers_uploades = await _upload_house_photos(photos) if photos else []

    photo_urls = [url for _, url in fichiers_uploades]
    photo_url = photo_urls[0] if photo_urls else ""

    maison.update({
        "photo_url": photo_url,
        "photo_urls": photo_urls,
        "approuvee": False,
        "statut": "en_attente",
        "disponibilite": "indisponible",
        "createdAt": firestore.SERVER_TIMESTAMP,
    })

    try:
        document = db.collection("maisons").add(maison)
        return {"success": True, "message": "Maison ajoutée avec succès", "id": document[1].id, "photo_url": photo_url, "photo_urls": photo_urls}

    except Exception as e:
        for nom_fichier, _ in fichiers_uploades:
            try:
                s3_client.delete_object(Bucket=BUCKET_NAME, Key=nom_fichier)
            except Exception:
                pass
        raise HTTPException(status_code=500, detail=f"Erreur Firebase : {str(e)}")


@router.post("/api/maisons/{maison_id}/approuver")
def approuver_maison(
    maison_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    reference = db.collection("maisons").document(maison_id)
    document = reference.get()

    if not document.exists:
        raise HTTPException(status_code=404, detail="Maison introuvable")

    maison = document.to_dict()
    type_maison = maison.get("type")

    if type_maison not in ["a_louer", "a_vendre"]:
        raise HTTPException(status_code=400, detail="Type de maison invalide")

    reference.update({"approuvee": True, "statut": "disponible", "disponibilite": "disponible"})

    return {
        "message": "Maison approuvée avec succès",
        "maison_id": maison_id,
        "approuvee": True,
        "statut": "disponible",
        "disponibilite": "disponible",
    }


def _changer_disponibilite(maison_id: str, disponibilite: str):
    reference = db.collection("maisons").document(maison_id)
    document = reference.get()

    if not document.exists:
        raise HTTPException(status_code=404, detail="Maison introuvable")

    maison = document.to_dict()
    if not maison.get("approuvee"):
        raise HTTPException(status_code=400, detail="La maison doit être approuvée avant de changer sa disponibilité")

    reference.update({"statut": disponibilite, "disponibilite": disponibilite})
    return {
        "message": "Disponibilité de la maison mise à jour",
        "maison_id": maison_id,
        "disponibilite": disponibilite,
    }


@router.post("/api/maisons/{maison_id}/indisponible")
def rendre_maison_indisponible(
    maison_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    return _changer_disponibilite(maison_id, "indisponible")


@router.post("/api/maisons/{maison_id}/disponible")
def rendre_maison_disponible(
    maison_id: str,
    _gestionnaire: dict = Depends(require_role("maisons")),
):
    return _changer_disponibilite(maison_id, "disponible")
