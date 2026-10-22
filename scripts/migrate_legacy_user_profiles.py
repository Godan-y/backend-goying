import argparse
import sys
from typing import Any

from firebase_admin import auth as firebase_auth
from firebase_admin import firestore
from google.cloud.firestore_v1 import FieldFilter

from firebase import db

SENSITIVE_FIELD_NAMES = {
    "password",
    "passwordhash",
    "mot_de_passe",
    "token",
    "idtoken",
    "refresh_token",
    "private_key",
    "secret",
}
PROFILE_FIELDS = {
    "uid",
    "email",
    "displayName",
    "fullName",
    "telephone",
    "phone",
    "photoURL",
    "role",
    "statut",
    "actif",
    "bloque",
    "createdAt",
    "updatedAt",
    "lastLoginAt",
    "preferences",
    "specialty",
}


class LegacyProfileMigrationError(RuntimeError):
    pass


def _safe_profile_data(source: dict[str, Any], uid: str, email: str, auth_user) -> dict[str, Any]:
    sensitive_fields = [
        key for key in source
        if key.lower().replace("-", "_") in SENSITIVE_FIELD_NAMES
    ]
    if sensitive_fields:
        raise LegacyProfileMigrationError(
            "Document legacy non migré : des champs sensibles doivent être examinés"
        )

    data = {key: value for key, value in source.items() if key in PROFILE_FIELDS}
    data["uid"] = uid
    data["email"] = auth_user.email or email
    data["displayName"] = (
        source.get("displayName")
        or source.get("fullName")
        or auth_user.display_name
    )
    data["telephone"] = source.get("telephone") or source.get("phone")
    data.setdefault("role", None)
    data.setdefault("statut", "actif")
    data.setdefault("actif", True)
    data.setdefault("bloque", False)
    data["isAdmin"] = False
    data.setdefault("createdAt", firestore.SERVER_TIMESTAMP)
    data["updatedAt"] = firestore.SERVER_TIMESTAMP
    return data


def migrate_legacy_user_profile(email: str) -> str:
    auth_user = firebase_auth.get_user_by_email(email)
    users = db.collection("users")
    matches = list(
        users.where(filter=FieldFilter(field_path="email", op_string="==", value=email))
        .limit(3)
        .stream()
    )
    if len(matches) != 1:
        raise LegacyProfileMigrationError(
            "Email Firestore ambigu ou document legacy introuvable"
        )

    source_ref = matches[0].reference
    target_ref = users.document(auth_user.uid)
    source_data = matches[0].to_dict() or {}
    if source_data.get("uid") != auth_user.uid:
        raise LegacyProfileMigrationError(
            "Le UID enregistré dans Firestore ne correspond pas au compte Firebase"
        )
    if source_ref.id == auth_user.uid:
        return "already_canonical"
    if source_data.get("migratedToUid") == auth_user.uid:
        if target_ref.get().exists:
            return "already_migrated"
        raise LegacyProfileMigrationError(
            "Marqueur de migration présent mais profil canonique introuvable"
        )

    target_data = _safe_profile_data(source_data, auth_user.uid, email, auth_user)

    @firestore.transactional
    def migrate(transaction):
        current_source = source_ref.get(transaction=transaction)
        current_target = target_ref.get(transaction=transaction)
        if not current_source.exists:
            raise LegacyProfileMigrationError("Le document source a disparu")
        latest_source = current_source.to_dict() or {}
        if latest_source.get("uid") != auth_user.uid:
            raise LegacyProfileMigrationError(
                "Le UID source a changé; migration interrompue"
            )
        if current_target.exists:
            current_target_data = current_target.to_dict() or {}
            if current_target_data.get("uid") != auth_user.uid:
                raise LegacyProfileMigrationError(
                    "Le document cible existe avec un UID différent; aucune donnée écrasée"
                )
            raise LegacyProfileMigrationError(
                "Le document canonique existe déjà; aucune donnée écrasée"
            )
        transaction.create(target_ref, target_data)
        transaction.update(
            source_ref,
            {
                "migratedToUid": auth_user.uid,
                "migratedAt": firestore.SERVER_TIMESTAMP,
            },
        )

    migrate(db.transaction())
    return "migrated"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Safely copy legacy users profiles to users/{Firebase UID}."
    )
    parser.add_argument(
        "emails",
        nargs="+",
        help="Exact Firebase Auth email addresses to migrate",
    )
    args = parser.parse_args()
    succeeded = 0
    for email in args.emails:
        try:
            migrate_legacy_user_profile(email)
            succeeded += 1
        except firebase_auth.UserNotFoundError:
            print(
                f"Migration refusée pour une adresse fournie : compte Firebase introuvable.",
                file=sys.stderr,
            )
            return 1
        except Exception as exc:
            print(
                f"Migration interrompue ({type(exc).__name__}) pour une adresse fournie; "
                "aucune suppression de document source n'est effectuée.",
                file=sys.stderr,
            )
            return 1
    print(f"Profils migrés ou déjà canoniques : {succeeded}. Documents source conservés.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
