import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from dependencies import require_admin
from services.admin_users import (
    AdminUserPatch,
    _apply_admin_update,
    router,
)


class AdminUserTests(unittest.TestCase):
    def setUp(self):
        self.admin = {
            "uid": "global-admin",
            "isAdmin": True,
            "role": None,
            "statut": "actif",
            "actif": True,
            "bloque": False,
        }
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[require_admin] = lambda: self.admin
        self.client = TestClient(self.app)

    def tearDown(self):
        self.client.close()

    def test_admin_dependency_rejects_business_role_without_global_permission(self):
        with self.assertRaises(HTTPException) as raised:
            require_admin({
                "uid": "business-manager",
                "role": "maisons",
                "actif": True,
                "bloque": False,
                "statut": "actif",
            })
        self.assertEqual(raised.exception.status_code, 403)

    def test_patch_schema_rejects_admin_role_and_sensitive_fields(self):
        with self.assertRaises(ValueError):
            AdminUserPatch(role="admin")
        with self.assertRaises(ValueError):
            AdminUserPatch.model_validate({"bloque": False})

    @patch("services.admin_users.firebase_auth.get_user")
    @patch("services.admin_users.get_user_profile")
    def test_get_user_returns_canonical_firebase_email(self, get_profile, get_auth_user):
        get_profile.return_value = {
            "uid": "target",
            "email": "stale@example.test",
            "role": "client",
            "statut": "actif",
            "actif": True,
            "bloque": False,
        }
        get_auth_user.return_value = MagicMock(
            email="canonical@example.test",
            display_name="Canonical",
            photo_url=None,
            disabled=False,
        )

        response = self.client.get("/api/admin/users/target")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], "canonical@example.test")
        self.assertTrue(response.json()["firebaseAuthExists"])

    @patch("services.admin_users.firebase_auth.get_users")
    @patch("services.admin_users.db")
    def test_list_uses_cursor_and_fetches_auth_users_in_a_batch(self, database, get_users):
        first = MagicMock(id="uid-1")
        first.to_dict.return_value = {
            "uid": "uid-1",
            "role": "client",
            "actif": True,
            "bloque": False,
            "statut": "actif",
        }
        second = MagicMock(id="uid-2")
        second.to_dict.return_value = {"uid": "uid-2"}
        query = database.collection.return_value
        query.where.return_value = query
        query.order_by.return_value = query
        query.limit.return_value = query
        query.stream.return_value = [first, second]
        get_users.return_value.users = [
            MagicMock(
                uid="uid-1",
                email="one@example.test",
                display_name="One",
                photo_url=None,
                disabled=False,
            )
        ]
        get_users.return_value.not_found = []

        response = self.client.get("/api/admin/users?limit=1&role=client")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body["users"]), 1)
        self.assertEqual(body["nextCursor"], "uid-1")
        self.assertTrue(body["hasMore"])
        query.order_by.assert_called_once()
        query.limit.assert_called_once_with(2)
        get_users.assert_called_once()

    @patch("services.admin_users.firebase_auth.get_user_by_email")
    @patch("services.admin_users.get_user_profile")
    def test_email_search_uses_exact_auth_lookup_and_uid_profile_read(
        self,
        get_profile,
        get_user_by_email,
    ):
        get_user_by_email.return_value.uid = "email-uid"
        get_profile.return_value = {
            "uid": "email-uid",
            "role": "client",
            "statut": "actif",
            "actif": True,
            "bloque": False,
        }
        with patch("services.admin_users.firebase_auth.get_user") as get_auth_user:
            get_auth_user.return_value = MagicMock(
                email="person@example.test",
                display_name="Person",
                photo_url=None,
                disabled=False,
            )
            response = self.client.get(
                "/api/admin/users?search=person%40example.test&searchBy=email"
            )

        self.assertEqual(response.status_code, 200)
        get_user_by_email.assert_called_once_with("person@example.test")
        get_profile.assert_called_once_with("email-uid")

    def test_non_admin_dependency_cannot_reach_admin_routes(self):
        self.app.dependency_overrides.pop(require_admin)
        self.app.dependency_overrides.clear()

        response = self.client.get("/api/admin/users")

        self.assertEqual(response.status_code, 401)

    def test_admin_cannot_self_unblock_or_self_elevate(self):
        unblock_response = self.client.post("/api/admin/users/global-admin/unblock")
        elevation_response = self.client.patch(
            "/api/admin/users/global-admin",
            json={"isAdmin": True},
        )
        self.assertEqual(unblock_response.status_code, 409)
        self.assertEqual(elevation_response.status_code, 409)

    @patch("services.admin_users.update_admin_user", return_value={"updated": True})
    def test_status_routes_delegate_audited_transitions(self, update_user):
        for operation in ("block", "unblock", "activate", "deactivate"):
            response = self.client.post(f"/api/admin/users/target/{operation}")
            self.assertEqual(response.status_code, 200)

        self.assertEqual(
            [call.kwargs["action"] for call in update_user.call_args_list],
            [
                "USER_BLOCKED",
                "USER_UNBLOCKED",
                "USER_ACTIVATED",
                "USER_DEACTIVATED",
            ],
        )

    def test_last_active_admin_cannot_be_deactivated(self):
        admin_ref = MagicMock()
        admin_ref.get.return_value.exists = True
        admin_ref.get.return_value.to_dict.return_value = self.admin
        user_ref = MagicMock()
        user_ref.get.return_value.exists = True
        user_ref.get.return_value.to_dict.return_value = {
            "uid": "target",
            "isAdmin": True,
            "actif": True,
            "bloque": False,
            "statut": "actif",
        }
        state_ref = MagicMock()
        state_ref.get.return_value.exists = True
        state_ref.get.return_value.to_dict.return_value = {"activeAdminCount": 1}
        transaction = MagicMock()

        with self.assertRaises(HTTPException) as raised:
            _apply_admin_update(
                transaction,
                admin_ref=admin_ref,
                user_ref=user_ref,
                state_ref=state_ref,
                action_ref=MagicMock(),
                admin_uid="global-admin",
                target_uid="target",
                changes={"actif": False},
                action="USER_DEACTIVATED",
            )

        self.assertEqual(raised.exception.status_code, 409)
        transaction.update.assert_not_called()
        transaction.create.assert_not_called()

    def test_admin_update_changes_counter_and_writes_audit_atomically(self):
        admin_ref = MagicMock()
        admin_ref.get.return_value.exists = True
        admin_ref.get.return_value.to_dict.return_value = self.admin
        user_ref = MagicMock()
        user_ref.get.return_value.exists = True
        user_ref.get.return_value.to_dict.return_value = {
            "uid": "target",
            "isAdmin": True,
            "actif": True,
            "bloque": False,
            "statut": "actif",
        }
        state_ref = MagicMock()
        state_ref.get.return_value.exists = True
        state_ref.get.return_value.to_dict.return_value = {"activeAdminCount": 2}
        transaction = MagicMock()

        result = _apply_admin_update(
            transaction,
            admin_ref=admin_ref,
            user_ref=user_ref,
            state_ref=state_ref,
            action_ref=MagicMock(),
            admin_uid="global-admin",
            target_uid="target",
            changes={"actif": False},
            action="USER_DEACTIVATED",
        )

        self.assertEqual(result["action"], "USER_DEACTIVATED")
        self.assertEqual(result["updatedFields"], ["actif", "statut"])
        self.assertEqual(transaction.update.call_count, 2)
        transaction.create.assert_called_once()

    def test_admin_update_rejects_inconsistent_state_counter(self):
        admin_ref = MagicMock()
        admin_ref.get.return_value.exists = True
        admin_ref.get.return_value.to_dict.return_value = self.admin
        user_ref = MagicMock()
        user_ref.get.return_value.exists = True
        user_ref.get.return_value.to_dict.return_value = {
            "uid": "target",
            "isAdmin": False,
            "actif": True,
            "bloque": False,
            "statut": "actif",
        }
        state_ref = MagicMock()
        state_ref.get.return_value.exists = False

        with self.assertRaises(HTTPException) as raised:
            _apply_admin_update(
                MagicMock(),
                admin_ref=admin_ref,
                user_ref=user_ref,
                state_ref=state_ref,
                action_ref=MagicMock(),
                admin_uid="global-admin",
                target_uid="target",
                changes={"isAdmin": True},
                action="USER_ADMIN_PRIVILEGE_CHANGED",
            )
        self.assertEqual(raised.exception.status_code, 503)

    def test_admin_update_rejects_admin_revoked_after_dependency_check(self):
        admin_ref = MagicMock()
        admin_ref.get.return_value.exists = True
        revoked_admin = {**self.admin, "isAdmin": False}
        admin_ref.get.return_value.to_dict.return_value = revoked_admin
        user_ref = MagicMock()
        user_ref.get.return_value.exists = True
        user_ref.get.return_value.to_dict.return_value = {
            "uid": "target",
            "isAdmin": False,
            "actif": True,
            "bloque": False,
            "statut": "actif",
        }

        with self.assertRaises(HTTPException) as raised:
            _apply_admin_update(
                MagicMock(),
                admin_ref=admin_ref,
                user_ref=user_ref,
                state_ref=MagicMock(),
                action_ref=MagicMock(),
                admin_uid="global-admin",
                target_uid="target",
                changes={"role": "client"},
                action="USER_ROLE_CHANGED",
            )

        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
