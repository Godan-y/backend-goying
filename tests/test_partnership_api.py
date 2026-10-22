"""Isolated API tests for partnership retrieval; never connects to Firebase."""
import sys
import types
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


# Stub backend integrations before importing the router. The tests exercise its
# response shaping and authorization only, against an in-memory collection.
fake_firestore = types.SimpleNamespace(transactional=lambda fn: fn)
fake_firebase_admin = types.ModuleType("firebase_admin")
fake_firebase_admin.firestore = fake_firestore
fake_firebase = types.ModuleType("firebase")
fake_firebase.db = None
fake_dependencies = types.ModuleType("dependencies")


def require_firebase_user():
    raise HTTPException(status_code=401, detail="Authentication required")


fake_dependencies.get_current_firebase_user = require_firebase_user
_module_names = ("firebase_admin", "firebase", "dependencies")
_previous_modules = {name: sys.modules.get(name) for name in _module_names}
try:
    sys.modules["firebase_admin"] = fake_firebase_admin
    sys.modules["firebase"] = fake_firebase
    sys.modules["dependencies"] = fake_dependencies
    from services import client_api  # noqa: E402
finally:
    for _name, _module in _previous_modules.items():
        if _module is None:
            sys.modules.pop(_name, None)
        else:
            sys.modules[_name] = _module


class FakeDocument:
    def __init__(self, document_id, data):
        self.id = document_id
        self.data = data

    def to_dict(self):
        return dict(self.data)


class FakeCollection:
    def __init__(self, documents):
        self.documents = documents

    def stream(self):
        return iter(self.documents)

    def document(self, document_id):
        return next((doc for doc in self.documents if doc.id == document_id), None)


class FakeDB:
    def __init__(self, documents):
        self.collection_value = FakeCollection(documents)

    def collection(self, name):
        if name != "partnershipRequests":
            raise AssertionError(f"Unexpected collection: {name}")
        return self.collection_value


class PartnershipApiTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.include_router(client_api.router)
        self.client = TestClient(self.app)
        self.docs = [
            FakeDocument("older", {
                "organizationName": "Older Org",
                "createdAt": datetime(2024, 1, 1, tzinfo=timezone.utc),
                "internalNote": "must not leak",
            }),
            FakeDocument("undated", {"contactName": "Legacy Contact"}),
            FakeDocument("newer", {
                "organizationName": "New Org",
                "entityType": "Association",
                "contactName": "New Contact",
                "officialEmail": "new@example.test",
                "phone": "+33123456789",
                "collaborationArea": "Services",
                "status": "nouveau",
                "createdAt": datetime(2025, 1, 1, tzinfo=timezone.utc),
            }),
        ]
        self.db_patch = patch.object(client_api, "db", FakeDB(self.docs))
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)

    def authorize(self, claims):
        self.app.dependency_overrides[require_firebase_user] = lambda: claims

    def test_created_and_undated_legacy_documents_are_returned_safely(self):
        self.authorize({"uid": "admin-1", "admin": True})
        response = self.client.get("/api/partnership-requests")
        self.assertEqual(response.status_code, 200)
        rows = response.json()["requests"]
        self.assertEqual([row["id"] for row in rows], ["newer", "older", "undated"])
        self.assertIsNone(rows[-1]["createdAt"])
        self.assertIsNone(rows[-1]["officialEmail"])
        self.assertNotIn("internalNote", rows[0])

    def test_empty_collection_returns_empty_page(self):
        self.db_patch.stop()
        self.db_patch = patch.object(client_api, "db", FakeDB([]))
        self.db_patch.start()
        self.authorize({"uid": "admin-1", "admin": True})
        response = self.client.get("/api/partnership-requests")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"requests": [], "nextCursor": None})

    def test_mixed_timestamp_pagination_has_no_duplicate_or_missing_rows(self):
        self.authorize({"uid": "admin-1", "admin": True})
        seen = []
        cursor = None
        while True:
            params = {"limit": 2}
            if cursor:
                params["cursor"] = cursor
            page = self.client.get("/api/partnership-requests", params=params).json()
            seen.extend(row["id"] for row in page["requests"])
            cursor = page["nextCursor"]
            if not cursor:
                break
        self.assertEqual(seen, ["newer", "older", "undated"])
        self.assertEqual(len(seen), len(set(seen)))

    def test_missing_admin_claim_is_forbidden_and_missing_auth_is_unauthorized(self):
        self.authorize({"uid": "user-1"})
        self.assertEqual(self.client.get("/api/partnership-requests").status_code, 403)
        self.app.dependency_overrides.clear()
        self.assertEqual(self.client.get("/api/partnership-requests").status_code, 401)

    def test_admin_claim_can_read(self):
        self.authorize({"uid": "admin-1", "admin": True})
        response = self.client.get("/api/partnership-requests")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["requests"]), 3)


if __name__ == "__main__":
    unittest.main()
