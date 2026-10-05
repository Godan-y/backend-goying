from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat
from pydantic import BaseModel

from dependencies import require_role
from firebase import db

router = APIRouter(prefix="/prestataires", tags=["prestataires"])

BOOKING_STATUS_PENDING = "En attente"
BOOKING_STATUS_CONFIRMED = "Confirmé"
BOOKING_STATUS_IN_PROGRESS = "En cours"
BOOKING_STATUS_AWAITING_VALIDATION = "À valider"
BOOKING_STATUS_COMPLETED = "Terminé"
BOOKING_STATUS_CANCELLED = "Annulé"
ADMIN_MANAGED_CATEGORIES = {"chauffeur", "chauffeuse", "menagere", "ménagère"}
VALID_MANAGEMENT_MODES = {"admin", "provider"}


class NouveauPrestataire(BaseModel):
    nom: str
    post_nom: str = ""
    prenom: str = ""
    telephone: str
    indicatif_telephone: str = ""
    region_telephone: str = ""
    description: str = ""
    pays: str = ""
    ville: str = ""
    commune: str = ""
    annees_experience: str = ""
    competences: str = ""
    tarif_mensuel: str = ""
    prix_negociable: bool = False
    permis_conduire: str = ""
    type_service: str = ""
    transmission: str = ""
    modele_vehicule: str = ""
    type: str


class ValidationTelephonePrestataire(BaseModel):
    telephone: str
    indicatif_telephone: str = ""
    region_telephone: str = ""


class PrestataireModification(BaseModel):
    nom: str
    post_nom: str = ""
    prenom: str = ""
    telephone: str
    description: str = ""
    pays: str = ""
    ville: str = ""
    commune: str = ""
    annees_experience: str = ""
    competences: str = ""
    tarif_mensuel: str = ""
    prix_negociable: bool = False
    permis_conduire: str = ""
    type_service: str = ""
    transmission: str = ""
    modele_vehicule: str = ""
    type: str


@router.post("/api")
def ajouter_prestataire(
    prestataire: NouveauPrestataire,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    type_prestataire = prestataire.type.strip().lower()
    if type_prestataire not in {"chauffeur", "menagere"}:
        raise HTTPException(status_code=400, detail="Type de prestataire invalide")

    nom = prestataire.nom.strip()
    prenom = prestataire.prenom.strip()
    telephone = _normaliser_telephone_prestataire(
        prestataire.telephone,
        prestataire.indicatif_telephone,
        prestataire.region_telephone,
    )
    if not nom or not telephone:
        raise HTTPException(status_code=400, detail="Le nom et le téléphone sont obligatoires")
    if type_prestataire == "chauffeur" and not prestataire.permis_conduire.strip():
        raise HTTPException(status_code=400, detail="Le numéro de permis de conduire est obligatoire")

    reference = db.collection("providers").document()
    reference.set({
        "name": f"{prenom} {nom}".strip() if prenom else nom,
        "nom": nom,
        "postNom": prestataire.post_nom.strip(),
        "prenom": prenom,
        "specialty": "Chauffeur" if type_prestataire == "chauffeur" else "Ménagère",
        "categorie": type_prestataire,
        "phone": telephone,
        "description": prestataire.description.strip(),
        "bio": prestataire.description.strip(),
        "pays": prestataire.pays.strip(),
        "ville": prestataire.ville.strip(),
        "commune": prestataire.commune.strip(),
        "location": " - ".join(
            value for value in (
                prestataire.commune.strip(),
                prestataire.ville.strip(),
                prestataire.pays.strip(),
            ) if value
        ),
        "anneesExperience": prestataire.annees_experience.strip(),
        "competences": prestataire.competences.strip(),
        "skills": [skill.strip() for skill in prestataire.competences.split(",") if skill.strip()],
        "tarifMensuel": prestataire.tarif_mensuel.strip(),
        "priceRate": prestataire.tarif_mensuel.strip(),
        "prixNegociable": prestataire.prix_negociable,
        "priceNegotiable": prestataire.prix_negociable,
        "permisConduire": prestataire.permis_conduire.strip(),
        "typeService": prestataire.type_service.strip(),
        "transmission": prestataire.transmission.strip(),
        "modeleVehicule": prestataire.modele_vehicule.strip(),
        "status": "disponible",
        "availability": "disponible",
        "verified": True,
        "managementMode": "admin",
        "createdBy": _gestionnaire["nom"],
        "createdAt": datetime.now(timezone.utc),
    })

    return {"message": "Prestataire ajouté", "prestataire_id": reference.id}


@router.post("/api/telephone/valider")
def valider_telephone_prestataire(
    telephone: ValidationTelephonePrestataire,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    return {
        "telephone": _normaliser_telephone_prestataire(
            telephone.telephone,
            telephone.indicatif_telephone,
            telephone.region_telephone,
        )
    }


PHONE_COUNTRY_CONFIG = {
    "CD": ("243",),
    "CI": ("225",),
    "SN": ("221",),
    "CM": ("237",),
    "FR": ("33",),
}


def _normaliser_telephone_prestataire(
    telephone: str,
    indicatif: str,
    region: str,
) -> str:
    value = telephone.strip()
    if not value:
        raise HTTPException(status_code=422, detail="Le téléphone / WhatsApp est obligatoire")

    try:
        has_international_prefix = value.startswith("+") or value.startswith("00")
        if has_international_prefix:
            parsed = phonenumbers.parse(value, None)
        else:
            normalized_region = region.strip().upper()
            country_config = PHONE_COUNTRY_CONFIG.get(normalized_region)
            if not country_config:
                raise HTTPException(
                    status_code=422,
                    detail="Sélectionnez le pays correspondant à l'indicatif téléphonique",
                )
            normalized_calling_code = indicatif.strip().lstrip("+")
            if normalized_calling_code not in country_config:
                raise HTTPException(
                    status_code=422,
                    detail="L'indicatif téléphonique ne correspond pas au pays sélectionné",
                )
            parsed = phonenumbers.parse(value, normalized_region)
    except NumberParseException as error:
        raise HTTPException(
            status_code=422,
            detail="Le numéro saisi n'est pas un numéro de téléphone valide",
        ) from error

    if not phonenumbers.is_valid_number(parsed):
        raise HTTPException(
            status_code=422,
            detail="Le numéro saisi est incomplet ou invalide pour le pays sélectionné",
        )
    return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)


@router.get("/api/en-attente")
def prestataires_en_attente(_gestionnaire: dict = Depends(require_role("prestataires"))):
    return _lister_prestataires("en_attente")


@router.get("/api/approuves")
def prestataires_approuves(_gestionnaire: dict = Depends(require_role("prestataires"))):
    return {"prestataires": _lister_providers()}


@router.get("/api/refuses")
def prestataires_refuses(_gestionnaire: dict = Depends(require_role("prestataires"))):
    return _lister_prestataires("refuse")


@router.get("/api/disponibles")
def prestataires_disponibles(_gestionnaire: dict = Depends(require_role("prestataires"))):
    return {"prestataires": _lister_providers("disponible")}


@router.get("/api/pris")
def prestataires_pris(_gestionnaire: dict = Depends(require_role("prestataires"))):
    return {"prestataires": _lister_providers("indisponible")}


@router.get("/api/public")
def prestataires_publics():
    return {"prestataires": _lister_providers("disponible")}


@router.get("/api/rendez-vous")
def rendez_vous_demandes(_gestionnaire: dict = Depends(require_role("prestataires"))):
    rendez_vous = []
    for document in db.collection("bookings").stream():
        rendez_vous_item = document.to_dict() or {}
        provider, management_mode = _booking_provider_context(rendez_vous_item)
        metadata = {
            "documentId": document.id,
            "providerProfile": provider,
            "managementMode": management_mode,
            "providerPhone": (
                rendez_vous_item.get("providerPhone")
                or provider.get("phone")
                or provider.get("telephone")
            ),
        }
        rendez_vous.append((rendez_vous_item, metadata))

    rendez_vous.sort(key=lambda entry: str(entry[0].get("createdAt", "")), reverse=True)
    return {
        "rendez_vous": [entry[0] for entry in rendez_vous],
        "booking_metadata": [entry[1] for entry in rendez_vous],
    }


@router.delete("/rendez-vous/{rendez_vous_id}")
def supprimer_rendez_vous(
    rendez_vous_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    reference, _rendez_vous = _get_booking_reference(rendez_vous_id)
    reference.delete()
    return {"message": "Rendez-vous supprimé", "rendez_vous_id": rendez_vous_id}


@router.patch("/rendez-vous/{rendez_vous_id}/confirmer")
def confirmer_rendez_vous(
    rendez_vous_id: str,
    gestionnaire: dict = Depends(require_role("prestataires")),
):
    reference, rendez_vous = _get_booking_reference(rendez_vous_id)
    current_status = _normaliser_statut_reservation(rendez_vous.get("status"))
    if current_status != BOOKING_STATUS_PENDING:
        raise HTTPException(
            status_code=400,
            detail="Seuls les rendez-vous en attente peuvent être confirmés",
        )

    provider, management_mode = _booking_provider_context(rendez_vous)
    reference.update({
        "status": BOOKING_STATUS_CONFIRMED,
        "approved": True,
        "managementMode": management_mode,
        "providerCompletionRequested": False,
        "providerCompletedAt": None,
        "adminCompletedAt": None,
        "confirmedAt": datetime.now(timezone.utc),
        "confirmedBy": gestionnaire["nom"],
    })
    return {
        "message": "Rendez-vous confirmé",
        "rendez_vous_id": rendez_vous_id,
        "managementMode": management_mode,
        "providerPhone": provider.get("phone") or provider.get("telephone"),
    }


@router.patch("/rendez-vous/{rendez_vous_id}/remettre-en-attente")
def remettre_rendez_vous_en_attente(
    rendez_vous_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    reference, rendez_vous = _get_booking_reference(rendez_vous_id)
    current_status = _normaliser_statut_reservation(rendez_vous.get("status"))
    if current_status not in {
        BOOKING_STATUS_CONFIRMED,
        BOOKING_STATUS_IN_PROGRESS,
        BOOKING_STATUS_AWAITING_VALIDATION,
    }:
        raise HTTPException(
            status_code=400,
            detail="Seul un rendez-vous confirmé ou en cours peut être remis en attente",
        )

    reference.update({
        "status": BOOKING_STATUS_PENDING,
        "approved": False,
        "providerCompletionRequested": False,
        "providerCompletedAt": None,
        "adminCompletedAt": None,
    })
    return {"message": "Rendez-vous remis en attente", "rendez_vous_id": rendez_vous_id}


@router.patch("/rendez-vous/{rendez_vous_id}/terminer")
def terminer_rendez_vous(
    rendez_vous_id: str,
    gestionnaire: dict = Depends(require_role("prestataires")),
):
    reference, rendez_vous = _get_booking_reference(rendez_vous_id)
    _, management_mode = _booking_provider_context(rendez_vous)
    current_status = _normaliser_statut_reservation(rendez_vous.get("status"))

    if management_mode == "provider":
        if (
            current_status != BOOKING_STATUS_AWAITING_VALIDATION
            or rendez_vous.get("providerCompletionRequested") is not True
        ):
            raise HTTPException(
                status_code=400,
                detail="Le prestataire doit d'abord demander la validation de fin de prestation",
            )
    elif current_status not in {BOOKING_STATUS_CONFIRMED, BOOKING_STATUS_IN_PROGRESS}:
        raise HTTPException(
            status_code=400,
            detail="Seul un rendez-vous confirmé ou en cours peut être terminé",
        )

    reference.update({
        "status": BOOKING_STATUS_COMPLETED,
        "adminCompletedAt": datetime.now(timezone.utc),
        "adminCompletedBy": gestionnaire["nom"],
    })
    return {"message": "Prestation terminée", "rendez_vous_id": rendez_vous_id}


def _get_booking_reference(rendez_vous_id: str):
    reference = db.collection("bookings").document(rendez_vous_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Rendez-vous introuvable")
    return reference, snapshot.to_dict()


def _booking_provider_context(rendez_vous: dict) -> tuple[dict, str]:
    provider = rendez_vous.get("provider")
    if not isinstance(provider, dict):
        provider = {}

    provider_id = rendez_vous.get("providerId") or provider.get("id")
    provider_collection = rendez_vous.get("providerCollection", "providers")
    if provider_id and provider_collection in {"providers", "chauffeurs"}:
        snapshot = db.collection(provider_collection).document(str(provider_id)).get()
        if snapshot.exists:
            provider = {**snapshot.to_dict(), **provider}

    management_mode = str(
        rendez_vous.get("managementMode") or provider.get("managementMode") or ""
    ).strip().lower()
    if management_mode not in VALID_MANAGEMENT_MODES:
        category = str(
            provider.get("categorie") or provider.get("specialty") or ""
        ).strip().lower()
        management_mode = "admin" if category in ADMIN_MANAGED_CATEGORIES else "provider"

    return provider, management_mode


def _normaliser_statut_reservation(statut) -> str:
    value = str(statut or "").strip().lower()
    statuses = {
        "en attente": BOOKING_STATUS_PENDING,
        "en_attente": BOOKING_STATUS_PENDING,
        "pending": BOOKING_STATUS_PENDING,
        "confirmé": BOOKING_STATUS_CONFIRMED,
        "confirme": BOOKING_STATUS_CONFIRMED,
        "approuvé": BOOKING_STATUS_CONFIRMED,
        "approuve": BOOKING_STATUS_CONFIRMED,
        "approved": BOOKING_STATUS_CONFIRMED,
        "en cours": BOOKING_STATUS_IN_PROGRESS,
        "in progress": BOOKING_STATUS_IN_PROGRESS,
        "à valider": BOOKING_STATUS_AWAITING_VALIDATION,
        "a valider": BOOKING_STATUS_AWAITING_VALIDATION,
        "terminé": BOOKING_STATUS_COMPLETED,
        "termine": BOOKING_STATUS_COMPLETED,
        "completed": BOOKING_STATUS_COMPLETED,
        "annulé": BOOKING_STATUS_CANCELLED,
        "annule": BOOKING_STATUS_CANCELLED,
        "cancelled": BOOKING_STATUS_CANCELLED,
    }
    return statuses.get(value, str(statut or "").strip())


def _lister_prestataires(statut: str):
    prestataires = []

    for document in db.collection("professionalApplications").stream():
        item = document.to_dict()
        statut_application = _normaliser_statut(item.get("status"))
        if statut_application != statut:
            continue
        formatted = _formater_candidature(document.id, item, statut_application)
        prestataires.append(formatted)

    return {"prestataires": prestataires}


def _lister_providers(statut: str | None = None):
    prestataires = []
    for document in db.collection("providers").stream():
        item = document.to_dict()
        provider_status = str(item.get("status", "disponible")).strip().lower()
        if provider_status not in {"disponible", "indisponible"}:
            provider_status = "disponible"
        if statut is not None and provider_status != statut:
            continue
        item["id"] = document.id
        item["statut"] = "approuve" if statut is None else provider_status
        prestataires.append(item)
    return prestataires


@router.get("/api/{prestataire_id}")
def recuperer_prestataire(
    prestataire_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    reference = db.collection("providers").document(prestataire_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Prestataire introuvable")

    prestataire = snapshot.to_dict()
    prestataire["id"] = snapshot.id
    return {"prestataire": prestataire}


@router.put("/api/{prestataire_id}")
def modifier_prestataire(
    prestataire_id: str,
    prestataire: PrestataireModification,
    gestionnaire: dict = Depends(require_role("prestataires")),
):
    type_prestataire = prestataire.type.strip().lower()
    if type_prestataire not in {"chauffeur", "menagere"}:
        raise HTTPException(status_code=400, detail="Type de prestataire invalide")

    nom = prestataire.nom.strip()
    prenom = prestataire.prenom.strip()
    telephone = prestataire.telephone.strip()
    if not nom or not telephone:
        raise HTTPException(status_code=400, detail="Le nom et le téléphone sont obligatoires")
    if type_prestataire == "chauffeur" and not prestataire.permis_conduire.strip():
        raise HTTPException(status_code=400, detail="Le numéro de permis de conduire est obligatoire")

    reference = db.collection("providers").document(prestataire_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Prestataire introuvable")

    competences = prestataire.competences.strip()
    tarif_mensuel = prestataire.tarif_mensuel.strip()
    description = prestataire.description.strip()
    reference.update({
        "name": f"{prenom} {nom}".strip() if prenom else nom,
        "nom": nom,
        "postNom": prestataire.post_nom.strip(),
        "prenom": prenom,
        "specialty": "Chauffeur" if type_prestataire == "chauffeur" else "Ménagère",
        "categorie": type_prestataire,
        "phone": telephone,
        "description": description,
        "bio": description,
        "pays": prestataire.pays.strip(),
        "ville": prestataire.ville.strip(),
        "commune": prestataire.commune.strip(),
        "location": " - ".join(
            value for value in (
                prestataire.commune.strip(),
                prestataire.ville.strip(),
                prestataire.pays.strip(),
            ) if value
        ),
        "anneesExperience": prestataire.annees_experience.strip(),
        "experienceYears": prestataire.annees_experience.strip(),
        "competences": competences,
        "skills": [skill.strip() for skill in competences.split(",") if skill.strip()],
        "tarifMensuel": tarif_mensuel,
        "priceRate": tarif_mensuel,
        "prixNegociable": prestataire.prix_negociable,
        "priceNegotiable": prestataire.prix_negociable,
        "permisConduire": prestataire.permis_conduire.strip(),
        "typeService": prestataire.type_service.strip(),
        "transmission": prestataire.transmission.strip(),
        "modeleVehicule": prestataire.modele_vehicule.strip(),
        "updatedAt": datetime.now(timezone.utc),
        "updatedBy": gestionnaire["nom"],
    })
    return {"message": "Prestataire modifié", "prestataire_id": prestataire_id}


@router.delete("/api/{prestataire_id}")
def supprimer_prestataire(
    prestataire_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    reference = db.collection("providers").document(prestataire_id)
    if not reference.get().exists:
        raise HTTPException(status_code=404, detail="Prestataire introuvable")

    reference.delete()
    return {"message": "Prestataire supprimé", "prestataire_id": prestataire_id}


@router.patch("/{prestataire_id}/approuver")
def approuver_prestataire(
    prestataire_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    return _changer_statut_prestataire(prestataire_id, "approuve")


@router.patch("/{prestataire_id}/refuser")
def refuser_prestataire(
    prestataire_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    return _changer_statut_prestataire(prestataire_id, "refuse")


@router.patch("/{prestataire_id}/prendre")
def prendre_prestataire(
    prestataire_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    return _changer_disponibilite(prestataire_id, "indisponible")


@router.patch("/{prestataire_id}/rendre-disponible")
def rendre_prestataire_disponible(
    prestataire_id: str,
    _gestionnaire: dict = Depends(require_role("prestataires")),
):
    return _changer_disponibilite(prestataire_id, "disponible")


def _changer_statut_prestataire(prestataire_id: str, statut: str):
    reference = db.collection("professionalApplications").document(prestataire_id)
    snapshot = reference.get()

    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Prestataire introuvable")

    candidature = snapshot.to_dict() or {}
    current_status = _normaliser_statut(candidature.get("status"))
    allowed_statuses = {"en_attente", "refuse"} if statut == "approuve" else {"en_attente"}
    if current_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Cette demande a déjà été traitée ou son statut ne permet pas cette action",
        )

    if statut == "approuve":
        listing = candidature.get("listing") or {}
        session = candidature.get("session") or {}
        provider_id = listing.get("id") or f"provider-{prestataire_id}"
        skills = listing.get("skills") or candidature.get("skills") or candidature.get("competences") or []
        if isinstance(skills, str):
            skills = [skill.strip() for skill in skills.split(",") if skill.strip()]

        name = listing.get("name") or session.get("fullName") or "Prestataire sans nom"
        specialty = listing.get("specialty") or candidature.get("specialty") or "Prestataire"
        location = listing.get("location") or " - ".join(
            value for value in (
                listing.get("commune") or candidature.get("commune"),
                listing.get("ville") or candidature.get("ville"),
                listing.get("pays") or candidature.get("pays"),
            ) if value
        )
        db.collection("providers").document(provider_id).set(
            {
                **listing,
                "id": provider_id,
                "name": name,
                "specialty": specialty,
                "email": listing.get("email") or session.get("email"),
                "phone": listing.get("phone"),
                "avatarUrl": listing.get("avatarUrl") or listing.get("photo_url") or listing.get("photo"),
                "bio": listing.get("bio") or listing.get("description") or candidature.get("bio"),
                "experienceYears": listing.get("experienceYears") or candidature.get("experienceYears") or candidature.get("annees_experience") or 0,
                "location": location,
                "priceRate": listing.get("priceRate") or candidature.get("priceRate") or candidature.get("tarif_mensuel"),
                "skills": skills,
                "status": "disponible",
                "availability": "disponible",
                "rating": listing.get("rating", 0),
                "reviewsCount": listing.get("reviewsCount", 0),
                "verified": True,
                "managementMode": "provider",
                "applicationId": prestataire_id,
                "updatedAt": datetime.now(timezone.utc),
            },
            merge=True,
        )

    reference.update(
        {
            "status": "Approuvé" if statut == "approuve" else "Refusé",
            "updatedAt": datetime.now(timezone.utc),
        }
    )

    return {
        "message": "Statut mis à jour",
        "prestataire_id": prestataire_id,
        "statut": statut,
    }


def _changer_disponibilite(prestataire_id: str, statut: str):
    reference = db.collection("providers").document(prestataire_id)
    snapshot = reference.get()
    if not snapshot.exists:
        raise HTTPException(status_code=404, detail="Prestataire introuvable")

    reference.update({
        "status": statut,
        "availability": statut,
        "updatedAt": datetime.now(timezone.utc),
    })
    return {
        "message": "Disponibilité du prestataire mise à jour",
        "prestataire_id": prestataire_id,
        "statut": statut,
    }


def _normaliser_statut(statut):
    valeur = str(statut or "").strip().lower()
    if valeur in {"en attente", "en_attente", "pending"}:
        return "en_attente"
    if valeur in {"approuve", "approuvé", "approved", "disponible"}:
        return "approuve"
    if valeur in {"refuse", "refusé", "rejected"}:
        return "refuse"
    return valeur


def _formater_candidature(application_id, candidature, statut):
    session = candidature.get("session") or {}
    listing = candidature.get("listing") or {}
    return {
        **listing,
        "id": application_id,
        "nom": listing.get("name") or session.get("fullName"),
        "categorie": candidature.get("specialty"),
        "telephone": listing.get("phone"),
        "email": session.get("email"),
        "description": listing.get("bio"),
        "photo_url": listing.get("avatarUrl"),
        "statut": statut,
    }
