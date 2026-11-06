import unittest
from unittest.mock import Mock, patch

from tests.firebase_test_support import install_firebase_db_stub

install_firebase_db_stub()

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import client_api


class Snapshot:
    def __init__(self, data=None):
        self.exists = data is not None
        self._data = data or {}

    def to_dict(self):
        return dict(self._data)


class Reference:
    def __init__(self, collection, document_id, data=None):
        self.collection = collection
        self.id = document_id
        self.data = data

    def get(self, transaction=None):
        return Snapshot(self.data)


class Collection:
    def __init__(self, documents=None):
        self.documents = documents or {}
        self.next_id = 0

    def document(self, document_id=None):
        if document_id is None:
            self.next_id += 1
            document_id = f"booking-{self.next_id}"
        if document_id not in self.documents:
            self.documents[document_id] = Reference(self, document_id)
        return self.documents[document_id]


class Transaction:
    def create(self, reference, value):
        reference.data = dict(value)

    def update(self, reference, value):
        reference.data.update(value)


class Database:
    def __init__(self, providers):
        self.collections = {
            "chauffeurs": Collection(),
            "providers": Collection(),
            "bookings": Collection(),
        }
        self.collections.update(providers)
        self.transaction_value = Transaction()

    def collection(self, name):
        return self.collections.setdefault(name, Collection())

    def transaction(self):
        return self.transaction_value


class ProviderBookingApiTests(unittest.TestCase):
    def setUp(self):
        self.user = {"uid": "client-1", "email": "client@example.test", "email_verified": True}
        self.app = FastAPI()
        self.app.include_router(client_api.router)
        self.app.dependency_overrides[client_api.require_verified_firebase_user] = lambda: self.user
        self.client = TestClient(self.app)

    def _payload(self, **overrides):
        payload = {
            "serviceType": "Chauffeur",
            "providerId": "provider-1",
            "providerCollection": "chauffeurs",
            "date": "2026-12-01 10:00",
            "details": "Transport vers l'aéroport",
            "costInfo": "50 USD",
            "clientName": "Client test",
            "clientWhatsApp": "+243812345678",
            "serviceAddress": "Gombe, Kinshasa",
            "serviceLocationType": "Maison",
        }
        payload.update(overrides)
        return payload

    def _post(self, database, payload=None, notification=None):
        notification = notification or Mock()
        with (
            patch.object(client_api, "db", database),
            patch("services.client_api.firestore.transactional", side_effect=lambda fn: fn),
            patch.object(client_api, "send_notification", notification),
        ):
            return self.client.post("/api/provider-bookings", json=payload or self._payload())

    def test_chauffeur_booking_is_created_and_availability_changes_atomically(self):
        provider = Reference(None, "provider-1", {
            "verified": True,
            "name": "Chauffeur test",
            "specialty": "chauffeur",
            "providerAvailability": "disponible",
            "availability": "disponible",
        })
        database = Database({"chauffeurs": Collection({"provider-1": provider})})

        response = self._post(database)

        self.assertEqual(response.status_code, 201)
        booking = database.collection("bookings").document("booking-1").data
        self.assertEqual(booking["providerId"], "provider-1")
        self.assertEqual(booking["clientUid"], "client-1")
        self.assertEqual(provider.data["availability"], "indisponible")
        self.assertEqual(provider.data["status"], "indisponible")
        self.assertEqual(provider.data["providerAvailability"], "indisponible")

    def test_successful_booking_sends_provider_booking_notification(self):
        provider = Reference(None, "provider-1", {
            "verified": True,
            "name": "Chauffeur test",
            "specialty": "chauffeur",
            "providerAvailability": "disponible",
        })
        database = Database({"chauffeurs": Collection({"provider-1": provider})})
        notification = Mock()

        response = self._post(database, notification=notification)

        self.assertEqual(response.status_code, 201)
        notification.assert_called_once()
        self.assertEqual(notification.call_args.args[0], "provider_booking")
        self.assertEqual(len(database.collection("bookings").documents), 1)

    def test_person_service_accepts_accented_specialty_without_changing_availability(self):
        provider = Reference(None, "provider-1", {
            "verified": True,
            "name": "Prestataire test",
            "specialty": "Ménagère",
            "availability": "disponible",
            "providerAvailability": "disponible",
        })
        database = Database({"providers": Collection({"provider-1": provider})})

        response = self._post(database, self._payload(
            serviceType="Service à la personne",
            providerCollection="providers",
        ))

        self.assertEqual(response.status_code, 201)
        self.assertEqual(provider.data["availability"], "disponible")
        self.assertEqual(provider.data["providerAvailability"], "disponible")
        self.assertEqual(len(database.collection("bookings").documents), 1)

    def test_unavailable_chauffeur_cannot_be_booked(self):
        provider = Reference(None, "provider-1", {
            "verified": True,
            "specialty": "chauffeur",
            "availability": "indisponible",
        })
        database = Database({"chauffeurs": Collection({"provider-1": provider})})

        response = self._post(database)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(len(database.collection("bookings").documents), 1)
        self.assertIsNone(database.collection("bookings").document("booking-1").data)

    def test_route_requires_verified_firebase_authentication(self):
        self.app.dependency_overrides.clear()
        response = self.client.post("/api/provider-bookings", json=self._payload())
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
