import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dependencies import get_current_firebase_user, require_user_profile
from services.reviews import router


class Snapshot:
    def __init__(self, data=None):
        self.exists = data is not None
        self._data = data or {}

    def to_dict(self):
        return dict(self._data)


class Reference:
    def __init__(self, data=None):
        self.snapshot = Snapshot(data)

    def get(self, transaction=None):
        return self.snapshot


class Collection:
    def __init__(self, documents=None):
        self.documents = documents or {}

    def document(self, document_id):
        return self.documents.setdefault(document_id, Reference())


class Database:
    def __init__(self, documents):
        self.collections = {
            name: Collection(records) for name, records in documents.items()
        }
        self.transaction_value = MagicMock()

    def collection(self, name):
        return self.collections.setdefault(name, Collection())

    def transaction(self):
        return self.transaction_value


class BookingReviewApiTests(unittest.TestCase):
    def setUp(self):
        self.user = {"uid": "client-1", "email": "client@example.test", "email_verified": True}
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.dependency_overrides[get_current_firebase_user] = lambda: self.user
        self.app.dependency_overrides[require_user_profile] = lambda: {"uid": "client-1"}
        self.client = TestClient(self.app)

    def _post_review(self, database, booking_id="booking-1"):
        with (
            patch("services.reviews.db", database),
            patch("services.reviews.firestore.transactional", side_effect=lambda fn: fn),
        ):
            return self.client.post(
                "/api/booking-reviews",
                json={"bookingId": booking_id, "rating": 5, "comment": "Très bien"},
            )

    def test_confirmed_house_visit_review_updates_house_aggregate(self):
        database = Database({
            "propertyBookings": {
                "booking-1": Reference({
                    "serviceType": "Immobilier",
                    "status": "Terminé",
                    "completedAt": datetime.now(timezone.utc),
                    "clientId": "client-1",
                    "propertyId": "house-1",
                    "itemName": "Maison test",
                }),
            },
            "maisons": {"house-1": Reference({"type": "a_vendre", "note": 4, "avis": 2})},
        })

        response = self._post_review(database)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"rating": 4.3, "reviewsCount": 3})
        database.transaction_value.create.assert_called_once()
        database.transaction_value.update.assert_any_call(
            database.collection("maisons").document("house-1"),
            {"note": 4.3, "avis": 3},
        )

    def test_completed_car_rental_can_be_reviewed(self):
        database = Database({
            "carBookings": {
                "booking-1": Reference({
                    "serviceType": "Automobile",
                    "status": "Terminé",
                    "completedAt": datetime.now(timezone.utc),
                    "clientId": "client-1",
                    "bien_id": "vehicle-1",
                    "itemName": "Voiture test",
                }),
            },
            "vehicles": {"vehicle-1": Reference({"rating": 3, "reviewsCount": 2})},
        })

        response = self._post_review(database)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"rating": 3.7, "reviewsCount": 3})
        database.transaction_value.create.assert_called_once()
        database.transaction_value.update.assert_any_call(
            database.collection("vehicles").document("vehicle-1"),
            {"rating": 3.7, "reviewsCount": 3},
        )

    def test_completed_provider_service_updates_provider_rating(self):
        database = Database({
            "bookings": {
                "booking-1": Reference({
                    "serviceType": "Chauffeur",
                    "status": "Terminé",
                    "adminCompletedAt": datetime.now(timezone.utc),
                    "clientId": "client-1",
                    "providerId": "provider-1",
                    "providerCollection": "chauffeurs",
                }),
            },
            "chauffeurs": {"provider-1": Reference({"rating": 4, "reviewsCount": 2})},
        })

        response = self._post_review(database)

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json(), {"rating": 4.3, "reviewsCount": 3})
        database.transaction_value.create.assert_called_once()

    def test_other_client_and_noncompleted_booking_are_rejected(self):
        other_client = Database({
            "carBookings": {
                "booking-1": Reference({
                    "serviceType": "Automobile", "status": "Terminé",
                    "completedAt": datetime.now(timezone.utc),
                    "clientId": "client-2",
                }),
            },
        })
        response = self._post_review(other_client)
        self.assertEqual(response.status_code, 403)

        pending = Database({
            "carBookings": {
                "booking-1": Reference({
                    "serviceType": "Automobile", "status": "Confirmé",
                    "clientId": "client-1",
                }),
            },
        })
        response = self._post_review(pending)
        self.assertEqual(response.status_code, 403)

    def test_client_claimed_completion_without_server_timestamp_is_rejected(self):
        database = Database({
            "carBookings": {
                "booking-1": Reference({
                    "serviceType": "Automobile",
                    "status": "Terminé",
                    "clientId": "client-1",
                }),
            },
        })

        response = self._post_review(database)

        self.assertEqual(response.status_code, 403)

    def test_duplicate_review_is_rejected(self):
        booking = Reference({
            "serviceType": "Automobile", "status": "Terminé", "clientId": "client-1",
            "completedAt": datetime.now(timezone.utc),
        })
        review = Reference({"rating": 4})
        database = Database({
            "carBookings": {"booking-1": booking},
            "reviews": {"carBookings_booking-1": review},
        })

        response = self._post_review(database)

        self.assertEqual(response.status_code, 409)

    def test_missing_authentication_is_rejected(self):
        app = FastAPI()
        app.include_router(router)
        with TestClient(app) as client:
            response = client.post(
                "/api/booking-reviews",
                json={"bookingId": "booking-1", "rating": 5, "comment": "Avis"},
            )
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
