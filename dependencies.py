import logging

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordBearer
from firebase_admin import auth as firebase_auth
from jose import JWTError, jwt

from auth import JWT_ALGORITHM, JWT_SECRET_KEY
from services.users import ensure_user_profile_active, get_or_create_user_profile

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")
firebase_bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


def get_current_gestionnaire(token: str = Depends(oauth2_scheme)):
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token invalide ou expiré",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise credentials_error from exc

    nom = payload.get("sub")
    role = payload.get("role")

    if not nom or not role:
        raise credentials_error

    return {
        "nom": nom,
        "role": role,
    }


def require_role(expected_role: str):
    def dependency(gestionnaire: dict = Depends(get_current_gestionnaire)):
        if gestionnaire["role"] != expected_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès interdit pour ce rôle",
            )

        return gestionnaire

    return dependency


def get_current_firebase_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(firebase_bearer_scheme),
):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentification client requise",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return firebase_auth.verify_id_token(credentials.credentials)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session client invalide ou expirée",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def require_firebase_user(
    firebase_user: dict = Depends(get_current_firebase_user),
) -> dict:
    uid = firebase_user.get("uid")
    if not isinstance(uid, str) or not uid.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session client invalide ou expirée",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return firebase_user


def require_user_profile(
    firebase_user: dict = Depends(require_firebase_user),
) -> dict:
    try:
        profile = get_or_create_user_profile(firebase_user)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible de récupérer ou créer le profil utilisateur Goying")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le profil utilisateur est temporairement indisponible",
        ) from exc

    ensure_user_profile_active(profile)
    return profile


def require_admin(
    user_profile: dict = Depends(require_user_profile),
) -> dict:
    if user_profile.get("isAdmin") is not True:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès réservé à l'administration",
        )
    return user_profile
