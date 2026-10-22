import logging
import os
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from firebase_admin import auth as firebase_auth
from fastapi.security import HTTPAuthorizationCredentials

from dependencies import firebase_bearer_scheme, require_admin
from services.users import ensure_user_profile_active, get_user_profile

router = APIRouter(tags=["admin-ui"])
templates = Jinja2Templates(directory="templates")
logger = logging.getLogger(__name__)

ADMIN_SESSION_COOKIE = "goying_admin_session"
ADMIN_SESSION_MAX_AGE = 8 * 60 * 60


def _firebase_web_config() -> dict[str, str]:
    return {
        "apiKey": os.getenv("FIREBASE_WEB_API_KEY", ""),
        "authDomain": os.getenv("FIREBASE_WEB_AUTH_DOMAIN", ""),
        "projectId": os.getenv("FIREBASE_WEB_PROJECT_ID", ""),
        "appId": os.getenv("FIREBASE_WEB_APP_ID", ""),
    }


def _ensure_web_config(config: dict[str, str]) -> None:
    if not all(config.values()):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La configuration Firebase Web de l'administration est incomplète",
        )


@router.get("/admin/login", response_class=HTMLResponse, include_in_schema=False)
def admin_login_page(request: Request):
    config = _firebase_web_config()
    configured = all(config.values())
    response = templates.TemplateResponse(
        request=request,
        name="admin_login.html",
        context={"firebase_web_config": config, "firebase_configured": configured},
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def require_admin_session(
    session_cookie: str | None = Cookie(default=None, alias=ADMIN_SESSION_COOKIE),
) -> dict[str, Any]:
    if not session_cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Connexion administrateur requise",
        )
    try:
        claims = firebase_auth.verify_session_cookie(session_cookie, check_revoked=True)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session administrateur invalide ou expirée",
        ) from exc

    uid = claims.get("uid")
    if not isinstance(uid, str) or not uid.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session administrateur invalide ou expirée",
        )
    try:
        profile = get_user_profile(uid)
    except Exception as exc:
        logger.exception("Impossible de vérifier le profil de la session admin")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La session administrateur est temporairement indisponible",
        ) from exc
    if profile is None:
        raise HTTPException(status_code=403, detail="Accès réservé à l'administration")
    ensure_user_profile_active(profile)
    if profile.get("isAdmin") is not True:
        raise HTTPException(status_code=403, detail="Accès réservé à l'administration")
    return profile


@router.get(
    "/admin/users",
    response_class=HTMLResponse,
    include_in_schema=False,
    dependencies=[Depends(require_admin_session)],
)
def admin_users_page(request: Request):
    config = _firebase_web_config()
    _ensure_web_config(config)
    response = templates.TemplateResponse(
        request=request,
        name="admin_users.html",
        context={"firebase_web_config": config},
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@router.post(
    "/api/admin/session",
    include_in_schema=False,
    dependencies=[Depends(require_admin)],
)
def create_admin_session(
    request: Request,
    response: Response,
    credentials: HTTPAuthorizationCredentials | None = Depends(firebase_bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentification Firebase requise",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        cookie = firebase_auth.create_session_cookie(
            credentials.credentials,
            expires_in=timedelta(seconds=ADMIN_SESSION_MAX_AGE),
        )
    except Exception as exc:
        logger.exception("La création de session d'administration a échoué")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Impossible de créer la session administrateur",
        ) from exc

    response.set_cookie(
        key=ADMIN_SESSION_COOKIE,
        value=cookie,
        max_age=ADMIN_SESSION_MAX_AGE,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return {"ok": True}


@router.delete("/api/admin/session", include_in_schema=False)
def delete_admin_session(request: Request, response: Response):
    response.delete_cookie(
        key=ADMIN_SESSION_COOKIE,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/",
    )
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return {"ok": True}
