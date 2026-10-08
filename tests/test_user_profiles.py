import unittest
import inspect
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from fastapi.security import HTTPAuthorizationCredentials
from google.api_core.exceptions import AlreadyExists

from auth import create_access_token
from dependencies import (
    get_current_firebase_user,
    get_current_gestionnaire,
    require_role,
    require_user_profile,
)
from services.users import (
    InvalidUserProfileUpdate,
    UserProfileIntegrityError,
    ensure_user_profile_active,
    get_or_create_user_profile,
    get_user_profile,
    update_current_user_profile,
)
from services.provider_portal import (
    list_provider_missions,
    request_provider_completion,
    update_provider_availability,
    router as provider_portal_router,
)
from services.reviews import create_booking_review
import services.provider_portal as provider_portal


class UserProfileTests(unittest.TestCase):
    def setUp(self):
        self.firebase_user = {
            "uid": "firebase-uid-123",
            "email": "person@example.test",
            "name": "Goying User",
            "picture": "https://example.test/photo.jpg",
        }
        self.profile = {
            "uid": self.firebase_user["uid"],
            "email": self.firebase_user["email"],
            "displayName": self.firebase_user["name"],
            "photoURL": self.firebase_user["picture"],
            "role": None,
            "statut": "actif",
            "actif": True,
            "bloque": False,
        }

    def _snapshot(self, exists, value=None):
        snapshot = MagicMock()
        snapshot.exists = exists
        snapshot.to_dict.return_value = value
        return snapshot

    @patch("services.users.db")
    def test_creates_minimal_profile_for_verified_uid(self, database):
        collection = database.collection.return_value
        reference = collection.document.return_value
        reference.get.side_effect = [
            self._snapshot(False),
            self._snapshot(True, self.profile),
        ]

        profile = get_or_create_user_profile(self.firebase_user)

        collection.document.assert_called_with(self.firebase_user["uid"])
        reference.create.assert_called_once()
        created = reference.create.call_args.args[0]
        self.assertEqual(created["uid"], self.firebase_user["uid"])
        self.assertEqual(created["role"], None)
        self.assertEqual(created["statut"], "actif")
        self.assertTrue(created["actif"])
        self.assertFalse(created["bloque"])
        self.assertNotIn("password", created)
        self.assertNotIn("mot_de_passe", created)
        self.assertEqual(profile["uid"], self.firebase_user["uid"])

    @patch("services.users.db")
    def test_existing_profile_is_read_without_rewriting_or_resyncing(self, database):
        reference = database.collection.return_value.document.return_value
        reference.get.return_value = self._snapshot(True, self.profile)

        profile = get_or_create_user_profile(self.firebase_user)

        self.assertEqual(profile, self.profile)
        reference.get.assert_called_once()
        reference.create.assert_not_called()
        reference.update.assert_not_called()

    @patch("services.users.db")
    def test_direct_lookup_uses_uid_document_and_rejects_mismatched_uid(self, database):
        collection = database.collection.return_value
        reference = collection.document.return_value
        collection.document.assert_not_called()
        reference.get.return_value = self._snapshot(
            True,
            {**self.profile, "uid": "another-user"},
        )

        with self.assertRaises(UserProfileIntegrityError):
            get_user_profile(self.firebase_user["uid"])

        collection.document.assert_called_with(self.firebase_user["uid"])

    @patch("services.users.db")
    def test_rejects_invalid_uid(self, database):
        with self.assertRaises(HTTPException) as context:
            get_or_create_user_profile({**self.firebase_user, "uid": "bad/uid"})

        self.assertEqual(context.exception.status_code, 401)
        database.collection.assert_not_called()

    def test_blocks_and_disables_profiles(self):
        for profile in (
            {**self.profile, "bloque": True},
            {**self.profile, "statut": "bloqué"},
            {**self.profile, "actif": False},
            {**self.profile, "statut": "désactivé"},
        ):
            with self.subTest(profile=profile):
                with self.assertRaises(HTTPException) as context:
                    ensure_user_profile_active(profile)
                self.assertEqual(context.exception.status_code, 403)

    def test_unknown_explicit_status_and_malformed_flags_fail_closed(self):
        for profile in (
            {**self.profile, "statut": "en_attente"},
            {**self.profile, "actif": "false"},
            {**self.profile, "bloque": "false"},
        ):
            with self.subTest(profile=profile):
                with self.assertRaises(HTTPException) as context:
                    ensure_user_profile_active(profile)
                self.assertEqual(context.exception.status_code, 403)

    def test_allows_active_profile_and_legacy_profile_without_status(self):
        ensure_user_profile_active(self.profile)
        ensure_user_profile_active({"uid": self.firebase_user["uid"]})

    @patch("services.users.db")
    def test_profile_dependency_returns_active_profile(self, database):
        reference = database.collection.return_value.document.return_value
        reference.get.return_value = self._snapshot(True, self.profile)

        result = require_user_profile(firebase_user=self.firebase_user)

        self.assertEqual(result, self.profile)

    def test_profile_dependency_preserves_invalid_uid_authentication_error(self):
        with self.assertRaises(HTTPException) as context:
            require_user_profile(firebase_user={"sub": "missing-uid"})

        self.assertEqual(context.exception.status_code, 401)

    @patch("services.users.db")
    def test_profile_dependency_rejects_blocked_profile(self, database):
        reference = database.collection.return_value.document.return_value
        reference.get.return_value = self._snapshot(
            True,
            {**self.profile, "bloque": True, "statut": "bloque"},
        )

        with self.assertRaises(HTTPException) as context:
            require_user_profile(firebase_user=self.firebase_user)

        self.assertEqual(context.exception.status_code, 403)

    @patch("dependencies.get_or_create_user_profile", side_effect=RuntimeError("storage detail"))
    def test_profile_dependency_returns_generic_error_for_firestore_failure(self, _get_profile):
        with self.assertLogs("dependencies", level="ERROR"):
            with self.assertRaises(HTTPException) as context:
                require_user_profile(firebase_user=self.firebase_user)

        self.assertEqual(context.exception.status_code, 503)
        self.assertEqual(
            context.exception.detail,
            "Le profil utilisateur est temporairement indisponible",
        )

    @patch("services.users.db")
    def test_profile_dependency_creates_missing_profile(self, database):
        reference = database.collection.return_value.document.return_value
        reference.get.side_effect = [
            self._snapshot(False),
            self._snapshot(True, self.profile),
        ]

        result = require_user_profile(firebase_user=self.firebase_user)

        self.assertEqual(result["uid"], self.firebase_user["uid"])
        reference.create.assert_called_once()

    @patch("services.users.db")
    def test_current_user_cannot_update_role_or_administrative_fields(self, database):
        with self.assertRaises(InvalidUserProfileUpdate):
            update_current_user_profile(
                self.firebase_user,
                {"role": "admin"},
            )
        with self.assertRaises(InvalidUserProfileUpdate):
            update_current_user_profile(
                self.firebase_user,
                {"bloque": False},
            )
        database.collection.assert_not_called()

    @patch("services.users.db")
    def test_current_user_can_update_only_allowlisted_profile_fields(self, database):
        reference = database.collection.return_value.document.return_value
        updated = {**self.profile, "displayName": "Updated Name"}
        reference.get.side_effect = [
            self._snapshot(True, self.profile),
            self._snapshot(True, updated),
        ]

        result = update_current_user_profile(
            self.firebase_user,
            {"displayName": " Updated Name "},
        )

        update = reference.update.call_args.args[0]
        self.assertEqual(update["displayName"], "Updated Name")
        self.assertIn("updatedAt", update)
        self.assertNotIn("role", update)
        self.assertEqual(result["displayName"], "Updated Name")

    @patch("services.users.db")
    def test_concurrent_profile_creation_uses_profile_created_by_other_request(self, database):
        reference = database.collection.return_value.document.return_value
        reference.create.side_effect = AlreadyExists("already created")
        reference.get.side_effect = [
            self._snapshot(False),
            self._snapshot(True, self.profile),
        ]

        profile = get_or_create_user_profile(self.firebase_user)

        self.assertEqual(profile, self.profile)
        reference.create.assert_called_once()
        self.assertEqual(reference.get.call_count, 2)

    @patch("dependencies.firebase_auth.verify_id_token")
    def test_valid_firebase_token_is_verified_and_uid_is_preserved(self, verify):
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="firebase-test-token",
        )
        verify.return_value = self.firebase_user

        result = get_current_firebase_user(credentials)

        self.assertEqual(result["uid"], self.firebase_user["uid"])
        verify.assert_called_once_with("firebase-test-token")

    @patch("dependencies.firebase_auth.verify_id_token", side_effect=ValueError("invalid"))
    def test_invalid_firebase_token_is_rejected(self, _verify):
        credentials = HTTPAuthorizationCredentials(
            scheme="Bearer",
            credentials="invalid-token",
        )

        with self.assertRaises(HTTPException) as context:
            get_current_firebase_user(credentials)

        self.assertEqual(context.exception.status_code, 401)

    def test_missing_firebase_credentials_are_rejected(self):
        with self.assertRaises(HTTPException) as context:
            get_current_firebase_user(None)
        self.assertEqual(context.exception.status_code, 401)

    def test_legacy_manager_jwt_and_role_dependency_remain_unchanged(self):
        token = create_access_token({"sub": "admin_maisons", "role": "maisons"})

        manager = get_current_gestionnaire(token)

        self.assertEqual(
            manager,
            {"nom": "admin_maisons", "role": "maisons"},
        )
        self.assertEqual(require_role("maisons")(manager), manager)
        with self.assertRaises(HTTPException) as context:
            require_role("voitures")(manager)
        self.assertEqual(context.exception.status_code, 403)

    def test_existing_firebase_routes_require_a_goying_profile(self):
        firebase_routes = (
            list_provider_missions,
            request_provider_completion,
            update_provider_availability,
            create_booking_review,
        )

        for endpoint in firebase_routes:
            with self.subTest(endpoint=endpoint.__name__):
                parameter = inspect.signature(endpoint).parameters["_user_profile"]
                self.assertIs(parameter.default.dependency, require_user_profile)

    def test_blocked_profile_prevents_access_to_existing_firebase_route(self):
        from dependencies import get_current_firebase_user

        app = FastAPI()
        app.include_router(provider_portal_router)
        app.dependency_overrides[get_current_firebase_user] = lambda: self.firebase_user
        blocked_profile = {
            **self.profile,
            "bloque": True,
            "statut": "bloque",
        }

        with patch(
            "dependencies.get_or_create_user_profile",
            return_value=blocked_profile,
        ):
            with TestClient(app) as client:
                response = client.get("/api/provider-missions")

        self.assertEqual(response.status_code, 403)

    def test_active_profile_preserves_existing_provider_route_response(self):
        from dependencies import get_current_firebase_user

        app = FastAPI()
        app.include_router(provider_portal_router)
        authentication_calls = []

        def verified_firebase_user():
            authentication_calls.append(self.firebase_user)
            return self.firebase_user

        app.dependency_overrides[get_current_firebase_user] = verified_firebase_user
        database = MagicMock()
        database.collection.return_value.where.return_value.stream.return_value = []

        with (
            patch(
                "dependencies.get_or_create_user_profile",
                return_value=self.profile,
            ),
            patch(
                "services.provider_portal._verified_provider_or_error",
                return_value=MagicMock(id="provider-a"),
            ),
            patch("services.provider_portal.db", database),
        ):
            with TestClient(app) as client:
                response = client.get("/api/provider-missions")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"missions": []})
        self.assertEqual(len(authentication_calls), 1)

    def test_provider_cannot_complete_another_providers_booking(self):
        from dependencies import get_current_firebase_user

        app = FastAPI()
        app.include_router(provider_portal_router)
        app.dependency_overrides[get_current_firebase_user] = lambda: self.firebase_user
        other_provider_booking = MagicMock()
        snapshot = MagicMock()
        snapshot.exists = True
        snapshot.to_dict.return_value = {
            "providerId": "provider-b",
            "status": "Confirmé",
        }
        other_provider_booking.get.return_value = snapshot
        provider_bookings = MagicMock()
        provider_bookings.document.return_value = other_provider_booking
        database = MagicMock()
        database.collection.return_value = provider_bookings

        with (
            patch(
                "dependencies.get_or_create_user_profile",
                return_value=self.profile,
            ),
            patch(
                "services.provider_portal._verified_provider_or_error",
                return_value=MagicMock(id="provider-a"),
            ),
            patch("services.provider_portal.db", database),
            patch(
                "services.provider_portal.firestore.transactional",
                side_effect=lambda function: function,
            ),
        ):
            with TestClient(app) as client:
                response = client.post(
                    "/api/provider-missions/booking-other/complete"
                )

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
