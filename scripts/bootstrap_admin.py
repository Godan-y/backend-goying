import argparse
import sys
from typing import Callable, TypeVar

from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from google.api_core.exceptions import GoogleAPICallError, PermissionDenied
from google.cloud.firestore_v1 import FieldFilter

from firebase import db
from services.admin_users import (
    ADMIN_ACTIONS_COLLECTION,
    ADMIN_STATE_DOCUMENT,
    USER_ADMIN_STATE_COLLECTION,
)

CONFIRMATION_PHRASE = "I_CONFIRM_FIRST_ADMIN"
T = TypeVar("T")


class BootstrapStageError(RuntimeError):
    def __init__(self, stage: str, cause: Exception):
        super().__init__(stage)
        self.stage = stage
        self.cause = cause


def _run_stage(stage: str, operation: Callable[[], T]) -> T:
    try:
        return operation()
    except BootstrapStageError:
        raise
    except Exception as exc:
        raise BootstrapStageError(stage, exc) from exc


def bootstrap_first_admin(uid: str) -> None:
    auth_user = _run_stage(
        "lecture du compte Firebase Authentication",
        lambda: firebase_auth.get_user(uid),
    )
    if auth_user.disabled:
        raise RuntimeError("Le compte Firebase doit être actif pour le bootstrap")

    users = db.collection("users")
    user_ref = users.document(uid)
    state_ref = db.collection(USER_ADMIN_STATE_COLLECTION).document(ADMIN_STATE_DOCUMENT)
    action_ref = db.collection(ADMIN_ACTIONS_COLLECTION).document()

    # The counter document is the one-time bootstrap lock and remains authoritative.
    existing_admins = _run_stage(
        "vérification des administrateurs existants dans Firestore",
        lambda: list(
            users.where(
                filter=FieldFilter(field_path="isAdmin", op_string="==", value=True)
            ).limit(1).stream()
        ),
    )
    if existing_admins:
        raise RuntimeError("Un administrateur global existe déjà")
    if _run_stage(
        "vérification du verrou de bootstrap Firestore",
        lambda: state_ref.get().exists,
    ):
        raise RuntimeError("Le bootstrap a déjà été exécuté; aucune modification appliquée")

    @firestore.transactional
    def apply_bootstrap(transaction):
        state_snapshot = state_ref.get(transaction=transaction)
        if state_snapshot.exists:
            raise RuntimeError("Le bootstrap a déjà été exécuté")
        profile_snapshot = user_ref.get(transaction=transaction)
        profile = profile_snapshot.to_dict() if profile_snapshot.exists else {}
        if profile_snapshot.exists and profile.get("uid") != uid:
            raise RuntimeError("Le profil ne correspond pas au compte Firebase")
        if profile_snapshot.exists and (
            profile.get("actif", True) is not True
            or profile.get("bloque", False) is not False
            or (
                profile.get("statut") is not None
                and str(profile["statut"]).strip().lower() not in {"actif", "active"}
            )
        ):
            raise RuntimeError("Le profil doit être actif et non bloqué")

        timestamp = firestore.SERVER_TIMESTAMP
        profile_values = {
            "uid": uid,
            "isAdmin": True,
            "updatedAt": timestamp,
        }
        if not profile_snapshot.exists:
            profile_values.update({
                "email": auth_user.email,
                "displayName": auth_user.display_name,
                "photoURL": auth_user.photo_url,
                "role": None,
                "statut": "actif",
                "actif": True,
                "bloque": False,
                "createdAt": timestamp,
            })
            transaction.create(user_ref, profile_values)
        else:
            transaction.update(user_ref, profile_values)

        transaction.create(state_ref, {
            "activeAdminCount": 1,
            "createdAt": timestamp,
            "updatedAt": timestamp,
        })
        transaction.create(action_ref, {
            "adminUid": uid,
            "targetUid": uid,
            "action": "FIRST_ADMIN_BOOTSTRAPPED",
            "timestamp": timestamp,
            "details": {"source": "operator_cli"},
        })

    _run_stage(
        "création transactionnelle du profil administrateur dans Firestore",
        lambda: apply_bootstrap(db.transaction()),
    )


def _safe_failure_message(exc: Exception) -> str:
    if isinstance(exc, firebase_auth.UserNotFoundError):
        return "Compte Firebase introuvable; vérifiez l'UID."
    if isinstance(exc, PermissionDenied):
        return "Permission Firestore refusée; vérifiez les droits IAM du compte de service."
    if isinstance(exc, GoogleAPICallError):
        code = getattr(exc, "code", None)
        return f"Erreur d'accès à Firebase/Google Cloud{f' (code HTTP {code})' if code else ''}."
    if isinstance(exc, RuntimeError):
        return str(exc)
    return f"Erreur technique de type {type(exc).__name__}; consultez les journaux Firebase/Firestore."


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Bootstrap one global Goying administrator through Firebase Admin."
    )
    parser.add_argument("uid", help="UID of the existing Firebase Authentication account")
    parser.add_argument(
        "--confirm",
        required=True,
        help=f"Explicit confirmation phrase: {CONFIRMATION_PHRASE}",
    )
    args = parser.parse_args()
    if args.confirm != CONFIRMATION_PHRASE:
        parser.error(f"confirmation phrase must be {CONFIRMATION_PHRASE}")

    try:
        bootstrap_first_admin(args.uid)
    except BootstrapStageError as exc:
        print(f"Bootstrap échoué pendant : {exc.stage}.", file=sys.stderr)
        print(_safe_failure_message(exc.cause), file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Bootstrap impossible ({type(exc).__name__}).", file=sys.stderr)
        print(_safe_failure_message(exc), file=sys.stderr)
        return 1
    print("Premier administrateur global configuré.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
