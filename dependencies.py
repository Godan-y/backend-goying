from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from auth import JWT_ALGORITHM, JWT_SECRET_KEY

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/login")


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
