from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer, OAuth2PasswordBearer
from firebase_admin import auth as firebase_auth
from jose import JWTError, jwt

from auth import JWT_ALGORITHM, JWT_SECRET_KEY

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")
firebase_bearer_scheme = HTTPBearer(auto_error=False)


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
