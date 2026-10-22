import unittest
from unittest.mock import MagicMock, patch

from scripts.migrate_legacy_user_profiles import (
    LegacyProfileMigrationError,
    _safe_profile_data,
    migrate_legacy_user_profile,
)


class LegacyProfileMigrationTests(unittest.TestCase):
    def test_migration_maps_old_profile_fields_and_denies_privilege(self):
        auth_user = MagicMock(email="canonical@example.test", display_name="Canonical Name")
        profile = _safe_profile_data(
            {
                "uid": "firebase-uid",
                "email": "legacy@example.test",
                "fullName": "Legacy Name",
                "phone": "+10000000000",
                "role": "client",
                "specialty": "chauffeur",
                "isLoggedIn": True,
            },
            "firebase-uid",
            "legacy@example.test",
            auth_user,
        )

        self.assertEqual(profile["uid"], "firebase-uid")
        self.assertEqual(profile["email"], "canonical@example.test")
        self.assertEqual(profile["displayName"], "Legacy Name")
        self.assertEqual(profile["telephone"], "+10000000000")
        self.assertEqual(profile["role"], "client")
        self.assertEqual(profile["specialty"], "chauffeur")
        self.assertIs(profile["isAdmin"], False)
        self.assertNotIn("isLoggedIn", profile)

    def test_migration_refuses_sensitive_fields_without_copying_them(self):
        with self.assertRaises(LegacyProfileMigrationError):
            _safe_profile_data(
                {"uid": "firebase-uid", "passwordHash": "do-not-copy"},
                "firebase-uid",
                "person@example.test",
                MagicMock(email="person@example.test", display_name=None),
            )

    @patch("scripts.migrate_legacy_user_profiles.db")
    @patch("scripts.migrate_legacy_user_profiles.firebase_auth.get_user_by_email")
    @patch("scripts.migrate_legacy_user_profiles.firestore.transactional")
    def test_migration_writes_canonical_profile_and_keeps_source(
        self,
        transactional,
        get_user_by_email,
        database,
    ):
        auth_user = MagicMock(
            uid="firebase-uid",
            email="person@example.test",
            display_name=None,
        )
        get_user_by_email.return_value = auth_user
        users = database.collection.return_value
        source = MagicMock(id="legacy-doc")
        source.reference.get.return_value.exists = True
        source.reference.get.return_value.to_dict.return_value = {
            "uid": "firebase-uid",
            "email": "person@example.test",
            "fullName": "Legacy Name",
            "phone": "+10000000000",
            "role": "client",
            "specialty": "chauffeur",
        }
        source.to_dict.return_value = {
            "uid": "firebase-uid",
            "email": "person@example.test",
            "fullName": "Legacy Name",
            "phone": "+10000000000",
            "role": "client",
            "specialty": "chauffeur",
        }
        users.where.return_value.limit.return_value.stream.return_value = [source]
        target = users.document.return_value
        target.get.return_value.exists = False
        transaction = MagicMock()
        database.transaction.return_value = transaction
        transactional.side_effect = lambda callback: lambda tx: callback(tx)

        result = migrate_legacy_user_profile("person@example.test")

        self.assertEqual(result, "migrated")
        transaction.create.assert_called_once()
        created_ref, created_profile = transaction.create.call_args.args
        self.assertIs(created_ref, target)
        self.assertEqual(created_profile["displayName"], "Legacy Name")
        self.assertEqual(created_profile["telephone"], "+10000000000")
        self.assertFalse(created_profile["isAdmin"])
        transaction.update.assert_called_once()
        updated_ref, marker = transaction.update.call_args.args
        self.assertIs(updated_ref, source.reference)
        self.assertEqual(marker["migratedToUid"], "firebase-uid")
        source.reference.delete.assert_not_called()

    @patch("scripts.migrate_legacy_user_profiles.db")
    @patch("scripts.migrate_legacy_user_profiles.firebase_auth.get_user_by_email")
    def test_migration_refuses_to_overwrite_existing_canonical_profile(
        self,
        get_user_by_email,
        database,
    ):
        get_user_by_email.return_value.uid = "firebase-uid"
        users = database.collection.return_value
        source = MagicMock(id="legacy-doc")
        source.reference.get.return_value.exists = True
        source.reference.get.return_value.to_dict.return_value = {
            "uid": "firebase-uid",
            "email": "person@example.test",
        }
        users.where.return_value.limit.return_value.stream.return_value = [source]
        users.document.return_value.get.return_value.exists = True

        with self.assertRaises(LegacyProfileMigrationError):
            migrate_legacy_user_profile("person@example.test")

        database.transaction.assert_not_called()


if __name__ == "__main__":
    unittest.main()
