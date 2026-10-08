import logging
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from google.cloud.firestore_v1.field_path import FieldPath
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from dependencies import require_admin
from firebase import db
from services.users import get_user_profile

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])
logger = logging.getLogger(__name__)

ADMIN_STATE_DOCUMENT = "userAdministration"
USER_ADMIN_STATE_COLLECTION = "systemConfig"
ADMIN_ACTIONS_COLLECTION = "adminActions"
ADMIN_PROFILE_FIELDS = (
    "uid",
    "displayName",
    "email",
    "telephone",
    "photoURL",
    "role",
    "isAdmin",
    "statut",
    "actif",
    "bloque",
    "createdAt",
    "updatedAt",
    "lastLoginAt",
)


class AdminUserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    displayName: str | None = Field(default=None, max_length=200)
    telephone: str | None = Field(default=None, max_length=40)
    role: str | None = Field(default=None, max_length=50)
    isAdmin: bool | None = None

    @field_validator("role")
    @classmethod
    def reject_admin_role(cls, value: str | None) -> str | None:
        if value is not None:
            normalized = value.strip().lower().replace("-", "_")
            if not normalized or normalized in {
                "admin",
                "administrator",
                "global_admin",
                "superadmin",
                "super_admin",
            }:
                raise ValueError("Le rôle global administrateur est géré séparément")
            return value.strip()
        return value

    @model_validator(mode="after")
    def validate_patch(self):
        if not self.model_fields_set:
            raise ValueError("Au moins un champ modifiable est requis")
        if "isAdmin" in self.model_fields_set and self.isAdmin is None:
            raise ValueError("isAdmin doit être un booléen")
        return self


def _normalized_status(profile: dict[str, Any]) -> str:
    return (
        str(profile.get("statut") or "")
        .strip()
        .lower()
        .replace("é", "e")
        .replace("è", "e")
    )


def _is_active_admin(profile: dict[str, Any]) -> bool:
    return (
        profile.get("isAdmin") is True
        and profile.get("actif") is True
        and profile.get("bloque") is False
        and _normalized_status(profile) in {"actif", "active"}
    )


def _profile_view(profile: dict[str, Any]) -> dict[str, Any]:
    return {field: profile[field] for field in ADMIN_PROFILE_FIELDS if field in profile}


def _matches_filters(
    profile: dict[str, Any],
    *,
    role: str | None,
    account_status: str | None,
    active: bool | None,
    blocked: bool | None,
    is_admin: bool | None,
) -> bool:
    return (
        (role is None or profile.get("role") == role)
        and (account_status is None or profile.get("statut") == account_status)
        and (active is None or profile.get("actif") is active)
        and (blocked is None or profile.get("bloque") is blocked)
        and (is_admin is None or profile.get("isAdmin") is is_admin)
    )


def _profile_or_404(uid: str) -> dict[str, Any]:
    profile = get_user_profile(uid)
    if profile is None:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return profile


def _auth_user_view(uid: str, profile: dict[str, Any]) -> dict[str, Any]:
    try:
        auth_user = firebase_auth.get_user(uid)
    except firebase_auth.UserNotFoundError:
        return {
            **_profile_view(profile),
            "email": None,
            "displayName": profile.get("displayName"),
            "photoURL": profile.get("photoURL"),
            "firebaseAuthExists": False,
            "firebaseDisabled": None,
        }
    except Exception as exc:
        logger.exception("Impossible de lire le compte Firebase Auth pour un profil utilisateur")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Les informations du compte sont temporairement indisponibles",
        ) from exc

    result = _profile_view(profile)
    result.update({
        "email": auth_user.email,
        "displayName": auth_user.display_name,
        "photoURL": auth_user.photo_url,
        "firebaseAuthExists": True,
        "firebaseDisabled": auth_user.disabled,
    })
    return result


def _get_search_match(
    search: str,
    *,
    search_by: Literal["uid", "email"],
    filters: dict[str, Any],
) -> dict[str, Any] | None:
    if search_by == "uid":
        profile = get_user_profile(search)
    else:
        try:
            auth_user = firebase_auth.get_user_by_email(search)
        except firebase_auth.UserNotFoundError:
            return None
        except Exception as exc:
            logger.exception("La recherche exacte par email Firebase a échoué")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="La recherche est temporairement indisponible",
            ) from exc
        profile = get_user_profile(auth_user.uid)

    if profile is None or not _matches_filters(profile, **filters):
        return None
    return profile


def list_admin_users(
    *,
    limit: int,
    cursor: str | None,
    search: str | None,
    search_by: Literal["uid", "email"],
    role: str | None,
    account_status: str | None,
    active: bool | None,
    blocked: bool | None,
    is_admin: bool | None,
) -> dict[str, Any]:
    filters = {
        "role": role,
        "account_status": account_status,
        "active": active,
        "blocked": blocked,
        "is_admin": is_admin,
    }
    try:
        if search:
            profile = _get_search_match(
                search.strip(),
                search_by=search_by,
                filters=filters,
            )
            profiles = [profile] if profile is not None else []
            return {
                "users": [_auth_user_view(profile["uid"], profile) for profile in profiles],
                "nextCursor": None,
                "hasMore": False,
            }

        query = db.collection("users")
        for field, value in (
            ("role", role),
            ("statut", account_status),
            ("actif", active),
            ("bloque", blocked),
            ("isAdmin", is_admin),
        ):
            if value is not None:
                query = query.where(field, "==", value)

        query = query.order_by(FieldPath.document_id()).limit(limit + 1)
        if cursor:
            if "/" in cursor:
                raise HTTPException(status_code=400, detail="Curseur de pagination invalide")
            cursor_snapshot = db.collection("users").document(cursor).get()
            if not cursor_snapshot.exists:
                raise HTTPException(status_code=400, detail="Curseur de pagination invalide")
            cursor_profile = cursor_snapshot.to_dict() or {}
            if not _matches_filters(cursor_profile, **filters):
                raise HTTPException(status_code=400, detail="Curseur de pagination invalide")
            query = query.start_after(cursor_snapshot)

        documents = list(query.stream())
        has_more = len(documents) > limit
        page_documents = documents[:limit]
        profiles = []
        for document in page_documents:
            profile = document.to_dict() or {}
            if profile.get("uid") != document.id:
                logger.error("Profil utilisateur ignoré : UID et ID de document différents")
                continue
            profiles.append(profile)

        auth_records = firebase_auth.get_users([
            firebase_auth.UidIdentifier(profile["uid"])
            for profile in profiles
        ]) if profiles else None
        records_by_uid = {
            record.uid: record
            for record in (auth_records.users if auth_records else [])
        }
        users = []
        for profile in profiles:
            auth_user = records_by_uid.get(profile["uid"])
            result = _profile_view(profile)
            result.update({
                "email": auth_user.email if auth_user else None,
                "displayName": auth_user.display_name if auth_user else profile.get("displayName"),
                "photoURL": auth_user.photo_url if auth_user else profile.get("photoURL"),
                "firebaseAuthExists": auth_user is not None,
                "firebaseDisabled": auth_user.disabled if auth_user else None,
            })
            users.append(result)

        return {
            "users": users,
            "nextCursor": page_documents[-1].id if has_more and page_documents else None,
            "hasMore": has_more,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible de lister les profils utilisateurs")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La liste des utilisateurs est temporairement indisponible",
        ) from exc


def _write_admin_action(
    transaction: Any,
    *,
    action_ref: Any,
    admin_uid: str,
    target_uid: str,
    action: str,
    changed_fields: list[str],
) -> None:
    transaction.create(
        action_ref,
        {
            "adminUid": admin_uid,
            "targetUid": target_uid,
            "action": action,
            "timestamp": firestore.SERVER_TIMESTAMP,
            "details": {"changedFields": changed_fields},
        },
    )


def _apply_admin_update(
    transaction: Any,
    *,
    admin_ref: Any,
    user_ref: Any,
    state_ref: Any,
    action_ref: Any,
    admin_uid: str,
    target_uid: str,
    changes: dict[str, Any],
    action: str,
) -> dict[str, Any]:
    user_snapshot = user_ref.get(transaction=transaction)
    if not user_snapshot.exists:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    profile = user_snapshot.to_dict() or {}
    if profile.get("uid") != target_uid:
        raise HTTPException(status_code=409, detail="Profil utilisateur incohérent")

    if admin_uid == target_uid:
        admin_profile = profile
    else:
        admin_snapshot = admin_ref.get(transaction=transaction)
        admin_profile = admin_snapshot.to_dict() if admin_snapshot.exists else {}
    if admin_profile.get("uid") != admin_uid or not _is_active_admin(admin_profile):
        raise HTTPException(status_code=403, detail="Accès administrateur révoqué")

    effective_changes = dict(changes)
    if action == "USER_UNBLOCKED":
        effective_changes["statut"] = (
            "actif" if profile.get("actif", True) is True else "inactif"
        )
    elif action == "USER_ACTIVATED":
        effective_changes["statut"] = (
            "bloque" if profile.get("bloque", False) is True else "actif"
        )
    elif action == "USER_DEACTIVATED":
        effective_changes["statut"] = (
            "bloque" if profile.get("bloque", False) is True else "inactif"
        )
    updated_profile = {**profile, **effective_changes}
    before_active_admin = _is_active_admin(profile)
    after_active_admin = _is_active_admin(updated_profile)
    changed_fields = sorted(effective_changes)
    admin_delta = int(after_active_admin) - int(before_active_admin)

    if admin_delta:
        state_snapshot = state_ref.get(transaction=transaction)
        state = state_snapshot.to_dict() if state_snapshot.exists else {}
        active_admin_count = state.get("activeAdminCount")
        if (
            not state_snapshot.exists
            or isinstance(active_admin_count, bool)
            or not isinstance(active_admin_count, int)
        ):
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="La configuration administrateur nécessite une intervention opérateur",
            )
        if admin_delta < 0 and active_admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Impossible de retirer le dernier administrateur actif",
            )
        transaction.update(
            state_ref,
            {
                "activeAdminCount": active_admin_count + admin_delta,
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
        )

    transaction.update(
        user_ref,
        {**effective_changes, "updatedAt": firestore.SERVER_TIMESTAMP},
    )
    _write_admin_action(
        transaction,
        action_ref=action_ref,
        admin_uid=admin_uid,
        target_uid=target_uid,
        action=action,
        changed_fields=changed_fields,
    )
    return {"uid": target_uid, "action": action, "updatedFields": changed_fields}


def update_admin_user(
    *,
    admin_uid: str,
    target_uid: str,
    changes: dict[str, Any],
    action: str,
) -> dict[str, Any]:
    admin_ref = db.collection("users").document(admin_uid)
    user_ref = db.collection("users").document(target_uid)
    state_ref = db.collection(USER_ADMIN_STATE_COLLECTION).document(ADMIN_STATE_DOCUMENT)
    action_ref = db.collection(ADMIN_ACTIONS_COLLECTION).document()

    try:
        operation = firestore.transactional(_apply_admin_update)
        return operation(
            db.transaction(),
            admin_ref=admin_ref,
            user_ref=user_ref,
            state_ref=state_ref,
            action_ref=action_ref,
            admin_uid=admin_uid,
            target_uid=target_uid,
            changes=changes,
            action=action,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("La modification administrative du profil utilisateur a échoué")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="La modification est temporairement indisponible",
        ) from exc


@router.get("", dependencies=[Depends(require_admin)])
def get_admin_users(
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    cursor: Annotated[str | None, Query(min_length=1, max_length=128)] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=320)] = None,
    search_by: Literal["uid", "email"] = Query("uid", alias="searchBy"),
    role: Annotated[str | None, Query(min_length=1, max_length=50)] = None,
    account_status: str | None = Query(
        None,
        min_length=1,
        max_length=50,
        alias="statut",
    ),
    active: bool | None = Query(None, alias="actif"),
    blocked: bool | None = Query(None, alias="bloque"),
    is_admin: bool | None = Query(None, alias="isAdmin"),
):
    if search is not None and search_by == "email" and "@" not in search:
        raise HTTPException(
            status_code=422,
            detail="La recherche par email doit contenir une adresse complète",
        )
    return list_admin_users(
        limit=limit,
        cursor=cursor,
        search=search,
        search_by=search_by,
        role=role,
        account_status=account_status,
        active=active,
        blocked=blocked,
        is_admin=is_admin,
    )


@router.get("/{uid}", dependencies=[Depends(require_admin)])
def get_admin_user(uid: str):
    try:
        return _auth_user_view(uid, _profile_or_404(uid))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Impossible de lire le profil utilisateur demandé")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le profil est temporairement indisponible",
        ) from exc


@router.patch("/{uid}")
def patch_admin_user(
    uid: str,
    patch: AdminUserPatch,
    admin: dict = Depends(require_admin),
):
    changes = patch.model_dump(exclude_unset=True)
    if uid == admin["uid"] and changes.get("isAdmin") is True:
        raise HTTPException(status_code=409, detail="L'auto-élévation est interdite")
    action = "USER_ROLE_CHANGED" if "role" in changes else "USER_PROFILE_UPDATED"
    if "isAdmin" in changes:
        action = "USER_ADMIN_PRIVILEGE_CHANGED"
    return update_admin_user(
        admin_uid=admin["uid"],
        target_uid=uid,
        changes=changes,
        action=action,
    )


def _admin_status_action(uid: str, admin: dict, changes: dict[str, Any], action: str):
    return update_admin_user(
        admin_uid=admin["uid"],
        target_uid=uid,
        changes=changes,
        action=action,
    )


@router.post("/{uid}/block")
def block_admin_user(uid: str, admin: dict = Depends(require_admin)):
    return _admin_status_action(
        uid,
        admin,
        {"bloque": True, "statut": "bloque"},
        "USER_BLOCKED",
    )


@router.post("/{uid}/unblock")
def unblock_admin_user(uid: str, admin: dict = Depends(require_admin)):
    if uid == admin["uid"]:
        raise HTTPException(status_code=409, detail="L'auto-déblocage est interdit")
    return _admin_status_action(
        uid,
        admin,
        {"bloque": False},
        "USER_UNBLOCKED",
    )


@router.post("/{uid}/activate")
def activate_admin_user(uid: str, admin: dict = Depends(require_admin)):
    return _admin_status_action(uid, admin, {"actif": True}, "USER_ACTIVATED")


@router.post("/{uid}/deactivate")
def deactivate_admin_user(uid: str, admin: dict = Depends(require_admin)):
    return _admin_status_action(
        uid,
        admin,
        {"actif": False},
        "USER_DEACTIVATED",
    )
