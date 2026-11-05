import unittest
from unittest.mock import ANY, MagicMock, patch

from tests.firebase_test_support import install_firebase_db_stub

install_firebase_db_stub()

from fastapi import HTTPException

from services.maisons import confirmer_visite_maison


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


class HouseBookingCompletionTests(unittest.TestCase):
    def setUp(self):
        self.booking = Reference({
            "serviceType": "Immobilier",
            "status": "Confirmé",
            "approved": True,
            "propertyId": "house-1",
        })
        self.house = Reference({
            "type": "a_louer",
            "reservedByBookingId": "booking-1",
        })
        self.transaction = MagicMock()
        collections = {
            "propertyBookings": {"booking-1": self.booking},
            "maisons": {"house-1": self.house},
        }

        def collection(name):
            return MagicMock(document=lambda document_id: collections.get(name, {}).get(document_id, Reference()))

        self.database = MagicMock()
        self.database.collection.side_effect = collection
        self.database.transaction.return_value = self.transaction

    def _complete(self):
        with (
            patch("services.maisons.db", self.database),
            patch("services.maisons.firestore.transactional", side_effect=lambda fn: fn),
        ):
            return confirmer_visite_maison("booking-1", {"nom": "gestionnaire-maisons"})

    def test_approved_visit_completes_and_releases_the_house(self):
        result = self._complete()

        self.assertEqual(result["status"], "Terminé")
        self.assertEqual(result["disponibilite"], "disponible")
        self.transaction.update.assert_any_call(self.booking, ANY)
        self.transaction.update.assert_any_call(self.house, ANY)

    def test_unapproved_booking_cannot_be_completed(self):
        self.booking.snapshot = Snapshot({
            "serviceType": "Immobilier", "status": "En attente", "propertyId": "house-1",
        })

        with self.assertRaises(HTTPException) as context:
            self._complete()

        self.assertEqual(context.exception.status_code, 409)
        self.transaction.update.assert_not_called()

    def test_visit_confirmation_requires_booking_to_own_the_house_reservation(self):
        self.house.snapshot = Snapshot({"type": "a_louer", "reservedByBookingId": "other-booking"})

        with self.assertRaises(HTTPException) as context:
            self._complete()

        self.assertEqual(context.exception.status_code, 409)
        self.transaction.update.assert_not_called()


if __name__ == "__main__":
    unittest.main()
