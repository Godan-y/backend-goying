from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from dotenv import load_dotenv
load_dotenv()

from auth import create_access_token, verify_password
from firebase import db
from services.dashboards import router as dashboards_router
from services.prestataires import router as prestataires_router
from services.maisons import router as maisons_router
from services.voitures import router as voitures_router
app = FastAPI(title="Plateforme de services")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://goyingservices.com",
        "https://www.goyingservices.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

ROLE_REDIRECTS = {
    "prestataires": "/gestion/prestataires",
    "maisons": "/dashboard/maisons",
    "voitures": "/dashboard/voitures",
}


class LoginRequest(BaseModel):
    nom: str
    mot_de_passe: str


@app.get("/", response_class=HTMLResponse)
def accueil(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={}
    )


@app.get("/gestion/maisons", response_class=HTMLResponse)
def page_gestion_maisons(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="maisons.html",
        context={}
    )


@app.get("/gestion/prestataires", response_class=HTMLResponse)
def page_gestion_prestataires(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="prestataires.html",
        context={}
    )


@app.get("/prestataires/ajouter", response_class=HTMLResponse)
def page_ajouter_prestataire(request: Request, type: str = "chauffeur"):
    type_prestataire = type if type in {"chauffeur", "menagere"} else "chauffeur"
    return templates.TemplateResponse(
        request=request,
        name="ajouter_prestataire.html",
        context={"type_prestataire": type_prestataire},
    )


@app.get("/prestataires/{prestataire_id}/modifier", response_class=HTMLResponse)
def page_modifier_prestataire(request: Request, prestataire_id: str):
    return templates.TemplateResponse(
        request=request,
        name="modifier_prestataire.html",
        context={"prestataire_id": prestataire_id},
    )


@app.get("/prestataires/en-attente", response_class=HTMLResponse)
def page_prestataires_en_attente(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="prestataires_en_attente.html",
        context={}
    )


@app.get("/prestataires/approuves", response_class=HTMLResponse)
def page_prestataires_approuves(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="prestataires_approuves.html",
        context={}
    )


@app.get("/prestataires/refuses", response_class=HTMLResponse)
def page_prestataires_refuses(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="prestataires_refuses.html",
        context={}
    )


@app.get("/prestataires/reserves", response_class=HTMLResponse)
def page_prestataires_reserves(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="prestataires_reserves.html",
        context={}
    )


@app.get("/prestataires/pris", response_class=HTMLResponse)
def page_prestataires_pris(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="prestataires_pris.html",
        context={}
    )


@app.get("/prestataires/rendez-vous", response_class=HTMLResponse)
def page_rendez_vous(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="rendez_vous.html",
        context={}
    )


@app.get("/gestion/voitures", response_class=HTMLResponse)
def page_gestion_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="voitures.html",
        context={}
    )


@app.get("/voitures/ajouter", response_class=HTMLResponse)
def page_ajouter_voiture(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="ajouter_voiture.html",
        context={},
    )


@app.get("/voitures/vente/ajouter", response_class=HTMLResponse)
def page_ajouter_vente_voiture(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="ajouter_vente_voiture.html",
        context={},
    )


@app.get("/voitures/ventes", response_class=HTMLResponse)
def page_annonces_vente_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="ventes_voitures.html",
        context={},
    )


@app.get("/voitures/demandes-achat", response_class=HTMLResponse)
def page_demandes_achat_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="demandes_achat_voitures.html",
        context={},
    )


@app.get("/voitures/soumissions", response_class=HTMLResponse)
def page_soumissions_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="soumissions_voitures.html",
        context={},
    )


@app.get("/voitures/liste", response_class=HTMLResponse)
def page_liste_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="voitures_liste.html",
        context={},
    )


@app.get("/voitures/{vehicle_id}/modifier", response_class=HTMLResponse)
def page_modifier_voiture(request: Request, vehicle_id: str):
    return templates.TemplateResponse(
        request=request,
        name="modifier_voiture.html",
        context={"vehicle_id": vehicle_id},
    )


@app.get("/voitures/reservations", response_class=HTMLResponse)
def page_reservations_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="reservations_voitures.html",
        context={"historique": False},
    )


@app.get("/voitures/reservations/historique", response_class=HTMLResponse)
def page_historique_reservations_voitures(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="reservations_voitures.html",
        context={"historique": True},
    )



@app.get("/api")
def api_accueil():
    return {
        "message": "Bienvenue sur notre plateforme",
        "services": [
            "Gestionnaire de prestataires",
            "Gestionnaire de maisons",
            "Gestionnaire de voitures",
        ],
    }


@app.post("/login")
@app.post("/api/login")
def login(data: LoginRequest):
    nom = data.nom.strip()
    gestionnaire = _find_gestionnaire_by_name(nom)

    if not gestionnaire:
        raise HTTPException(status_code=401, detail="Gestionnaire introuvable")

    if not verify_password(data.mot_de_passe, gestionnaire["mot_de_passe"]):
        raise HTTPException(status_code=401, detail="Mot de passe incorrect")

    if str(gestionnaire.get("statut", "")).strip().lower() != "actif":
        raise HTTPException(status_code=403, detail="Votre compte est désactivé")

    role = str(gestionnaire.get("role", "")).strip().lower()
    redirect = ROLE_REDIRECTS.get(role)

    if not redirect:
        raise HTTPException(status_code=403, detail="Rôle non reconnu")

    return {
        "message": "Connexion réussie",
        "nom": gestionnaire["nom"],
        "role": role,
        "redirect": redirect,
        "access_token": create_access_token(
            {
                "sub": gestionnaire["nom"],
                "role": role,
            }
        ),
        "token_type": "bearer",
    }


def _find_gestionnaire_by_name(nom: str):
    nom_recherche = nom.strip().lower()

    if "/" not in nom:
        document = db.collection("gestionnaires").document(nom.strip()).get()
        if document.exists:
            gestionnaire = document.to_dict()
            gestionnaire.setdefault("nom", document.id)
            return gestionnaire

    for document in db.collection("gestionnaires").stream():
        gestionnaire = document.to_dict()
        nom_stocke = str(gestionnaire.get("nom", document.id)).strip().lower()
        if nom_stocke == nom_recherche:
            gestionnaire.setdefault("nom", document.id)
            return gestionnaire

    return None


app.include_router(dashboards_router)
app.include_router(prestataires_router)
app.include_router(maisons_router)
app.include_router(voitures_router)
