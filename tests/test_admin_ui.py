import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from dependencies import require_admin
from services.admin_ui import (
    ADMIN_SESSION_COOKIE,
    ADMIN_SESSION_MAX_AGE,
    require_admin_session,
    router,
)


class AdminUiTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(router)
        self.client = TestClient(self.app)
        self.secure_client = TestClient(self.app, base_url="https://testserver")
        self.admin_profile = {
            "uid": "firebase-admin",
            "isAdmin": True,
            "statut": "actif",
            "actif": True,
            "bloque": False,
        }
        self.app.dependency_overrides[require_admin] = lambda: self.admin_profile

    def tearDown(self):
        self.client.close()
        self.secure_client.close()

    @patch.dict(
        "os.environ",
        {
            "FIREBASE_WEB_API_KEY": "public-web-key",
            "FIREBASE_WEB_AUTH_DOMAIN": "goying.firebaseapp.com",
            "FIREBASE_WEB_PROJECT_ID": "goying",
            "FIREBASE_WEB_APP_ID": "web-app-id",
        },
    )
    def test_admin_page_uses_existing_shell_styles_and_users_navigation(self):
        self.app.dependency_overrides[require_admin_session] = lambda: self.admin_profile

        response = self.client.get("/admin/users")

        self.assertEqual(response.status_code, 200)
        self.assertIn("Gestion des utilisateurs", response.text)
        self.assertIn("👥 Utilisateurs", response.text)
        self.assertIn("/static/style.css", response.text)
        self.assertIn("/static/admin-users.js", response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_admin_page_requires_server_verified_session_cookie(self):
        response = self.client.get("/admin/users")
        self.assertEqual(response.status_code, 401)

    @patch("services.admin_ui.get_user_profile")
    @patch("services.admin_ui.firebase_auth.verify_session_cookie")
    def test_non_admin_session_is_forbidden(self, verify_cookie, get_profile):
        verify_cookie.return_value = {"uid": "business-user"}
        get_profile.return_value = {
            "uid": "business-user",
            "role": "maisons",
            "isAdmin": False,
            "statut": "actif",
            "actif": True,
            "bloque": False,
        }

        response = self.client.get(
            "/admin/users",
            cookies={ADMIN_SESSION_COOKIE: "opaque-cookie"},
        )

        self.assertEqual(response.status_code, 403)
        verify_cookie.assert_called_once_with("opaque-cookie", check_revoked=True)

    @patch("services.admin_ui.get_user_profile")
    @patch("services.admin_ui.firebase_auth.verify_session_cookie")
    def test_admin_session_requires_active_unblocked_profile(self, verify_cookie, get_profile):
        verify_cookie.return_value = {"uid": "firebase-admin"}
        get_profile.return_value = {
            **self.admin_profile,
            "bloque": True,
        }

        with self.assertRaises(HTTPException) as raised:
            require_admin_session("opaque-cookie")

        self.assertEqual(raised.exception.status_code, 403)
        verify_cookie.assert_called_once_with("opaque-cookie", check_revoked=True)

    def test_login_page_does_not_fail_when_web_config_is_missing(self):
        with patch("services.admin_ui._firebase_web_config", return_value={
            "apiKey": "",
            "authDomain": "",
            "projectId": "",
            "appId": "",
        }):
            response = self.client.get("/admin/login")

        self.assertEqual(response.status_code, 200)
        self.assertIn("configuration Firebase Web est incomplète", response.text)
        self.assertNotIn("/static/admin-login.js", response.text)

    @patch("services.admin_ui.firebase_auth.create_session_cookie", return_value="opaque-session-cookie")
    def test_firebase_admin_id_token_becomes_httponly_server_session(
        self,
        create_session_cookie,
    ):
        response = self.secure_client.post(
            "/api/admin/session",
            headers={"Authorization": "Bearer firebase-id-token"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        create_session_cookie.assert_called_once()
        cookie = response.headers["set-cookie"]
        self.assertIn(f"{ADMIN_SESSION_COOKIE}=opaque-session-cookie", cookie)
        self.assertIn("httponly", cookie.lower())
        self.assertIn("secure", cookie.lower())
        self.assertIn("samesite=strict", cookie.lower())
        self.assertEqual(ADMIN_SESSION_MAX_AGE, 8 * 60 * 60)

    def test_session_exchange_without_firebase_bearer_is_rejected(self):
        self.app.dependency_overrides.pop(require_admin)

        response = self.client.post("/api/admin/session")

        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
