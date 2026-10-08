from typing import Any

from fastapi import HTTPException, status
from firebase_admin import firestore
from google.api_core.exceptions import AlreadyExists

from firebase import db

EDITABLE_PROFILE_FIELDS = {"displayName", "telephone", "photoURL"}
MAX_UID_LENGTH = 128
MAX_DISPLAY_NAME_LENGTH = 200
MAX_EMAIL_LENGTH = 320
MAX_PHONE_LENGTH = 40
MAX_PHOTO_URL_LENGTH = 2048

_BLOCKED_STATUSES = {"bloque", "blocked"}
_INACTIVE_STATUSES = {"inactif", "inactive", "desactive", "disabled"}
_ACTIVE_STATUSES = {"actif", "active"}


class UserProfileIntegrityError(RuntimeError):
    """Raised when a Firestore profile does not match its Firebase UID."""


class InvalidUserProfileUpdate(ValueError):
    """Raised when an update includes fields not editable by the user."""


def _verified_uid(firebase_user: dict[str, Any]) -> str:
    uid = firebase_user.get("uid")
    if not isinstance(uid, str) or not uid.strip() or len(uid) > MAX_UID_LENGTH or "/" in uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session client invalide ou expirée",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return uid


def get_user_profile(uid: str) -> dict[str, Any] | None:
    """Read one profile by document ID, without scanning the users collection."""
    if not isinstance(uid, str) or not uid.strip() or len(uid) > MAX_UID_LENGTH or "/" in uid:
        return None

    snapshot = db.collection("users").document(uid).get()
    if not snapshot.exists:
        return None

    profile = snapshot.to_dict() or {}
    if profile.get("uid") != uid:
        raise UserProfileIntegrityError("User profile UID does not match its document ID")
    return profile


def _optional_claim(firebase_user: dict[str, Any], claim: str, max_length: int) -> str | None:
    value = firebase_user.get(claim)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:max_length] if value else None


def create_user_profile(firebase_user: dict[str, Any]) -> dict[str, Any]:
    """Create a least-privilege profile from verified Firebase token claims."""
    uid = _verified_uid(firebase_user)
    profile = {
        "uid": uid,
        "email": _optional_claim(firebase_user, "email", MAX_EMAIL_LENGTH),
        "displayName": _optional_claim(firebase_user, "name", MAX_DISPLAY_NAME_LENGTH),
        "photoURL": _optional_claim(firebase_user, "picture", MAX_PHOTO_URL_LENGTH),
        "role": None,
        "statut": "actif",
        "actif": True,
        "bloque": False,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    reference = db.collection("users").document(uid)
    try:
        reference.create(profile)
    except AlreadyExists:
        existing_profile = get_user_profile(uid)
        if existing_profile is None:
            raise UserProfileIntegrityError(
                "User profile disappeared after a concurrent create"
            )
        return existing_profile

    created_profile = get_user_profile(uid)
    if created_profile is None:
        raise UserProfileIntegrityError("Created user profile could not be read")
    return created_profile


def get_or_create_user_profile(firebase_user: dict[str, Any]) -> dict[str, Any]:
    """Return a UID-bound profile, creating a non-privileged profile if absent."""
    uid = _verified_uid(firebase_user)
    profile = get_user_profile(uid)
    if profile is not None:
        return profile
    return create_user_profile(firebase_user)


def ensure_user_profile_active(profile: dict[str, Any]) -> None:
    """Reject blocked or disabled Goying profiles."""
    raw_status = profile.get("statut")
    normalized_status = (
        str(raw_status).strip().lower().replace("é", "e").replace("è", "e")
        if raw_status is not None
        else "actif"
    )
    blocked_flag = profile.get("bloque", False)
    active_flag = profile.get("actif", True)

    if (
        not isinstance(blocked_flag, bool)
        or blocked_flag
        or not isinstance(active_flag, bool)
        or not active_flag
        or normalized_status in _BLOCKED_STATUSES
        or normalized_status in _INACTIVE_STATUSES
        or (raw_status is not None and normalized_status not in _ACTIVE_STATUSES)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Votre compte est bloqué ou désactivé. Contactez l'administration.",
        )


def update_current_user_profile(
    firebase_user: dict[str, Any],
    updates: dict[str, Any],
) -> dict[str, Any]:
    """Update only the caller's allowlisted, non-administrative profile fields."""
    uid = _verified_uid(firebase_user)
    unsupported_fields = set(updates) - EDITABLE_PROFILE_FIELDS
    if unsupported_fields:
        raise InvalidUserProfileUpdate(
            "Only displayName, telephone, and photoURL can be edited by the user"
        )
    if not updates:
        raise InvalidUserProfileUpdate("At least one editable profile field is required")

    field_limits = {
        "displayName": MAX_DISPLAY_NAME_LENGTH,
        "telephone": MAX_PHONE_LENGTH,
        "photoURL": MAX_PHOTO_URL_LENGTH,
    }
    normalized_updates: dict[str, str | None] = {}
    for field, value in updates.items():
        if value is not None and not isinstance(value, str):
            raise InvalidUserProfileUpdate(f"{field} must be a string or null")
        normalized_updates[field] = value.strip()[:field_limits[field]] if value else None

    get_or_create_user_profile(firebase_user)
    reference = db.collection("users").document(uid)
    reference.update({
        **normalized_updates,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    updated_profile = get_user_profile(uid)
    if updated_profile is None:
        raise UserProfileIntegrityError("Updated user profile could not be read")
    return updated_profile
