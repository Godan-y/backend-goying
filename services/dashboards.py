from fastapi import APIRouter, Depends

from dependencies import require_role

router = APIRouter(prefix="/dashboard", tags=["dashboards"])


@router.get("/prestataires")
def dashboard_prestataires(_gestionnaire: dict = Depends(require_role("prestataires"))):
    return {
        "page": "Gestionnaire de prestataires",
        "sections": [
            "Nouvelles demandes",
            "Prestataires approuvés",
            "Prestataires refusés",
            "Rendez-vous demandés",
        ],
    }


@router.get("/maisons/data")
def dashboard_maisons(_gestionnaire: dict = Depends(require_role("maisons"))):
    return {
        "page": "Gestionnaire de maisons",
        "sections": [
            "Nouvelles maisons",
            "Maisons approuvées",
            "Maisons refusées",
        ],
    }


@router.get("/voitures")
def dashboard_voitures(_gestionnaire: dict = Depends(require_role("voitures"))):
    return {
        "page": "Gestionnaire de voitures",
        "sections": [
            "Nouvelles voitures",
            "Voitures approuvées",
            "Voitures refusées",
        ],
    }
