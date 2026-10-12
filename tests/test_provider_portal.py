import unittest
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from dependencies import require_firebase_user
import services.provider_portal as provider_portal


class FakePaginator:
    def __init__(self, keys):
        self.keys = keys

    def paginate(self, **_kwargs):
        return [{"Contents": [{"Key": key} for key in self.keys]}]


class FakeS3Client:
    def __init__(self, keys=()):
        self.keys = list(keys)
        self.presign_calls = []

    def get_paginator(self, _operation):
        return FakePaginator(self.keys)

    def generate_presigned_url(self, operation, **kwargs):
        self.presign_calls.append((operation, kwargs))
        return "https://s3.example/upload"


class FakeProvider:
    id = "provider-123"


class FakeSnapshot:
    def __init__(self, value=None):
        self.exists = value is not None
        self.value = value

    def to_dict(self):
        return self.value


class FakeDocumentReference:
    def __init__(self, collection, document_id):
        self.collection = collection
        self.id = document_id

    def get(self, transaction=None):
        return FakeSnapshot(self.collection.documents.get(self.id))


class FakeQuery:
    def __init__(self, collection, field, value):
        self.collection = collection
        self.field = field
        self.value = value
        self.limit_value = None

    def limit(self, value):
        self.limit_value = value
        return self

    def stream(self):
        matches = [
            FakeSnapshot(document)
            for document in self.collection.documents.values()
            if document.get(self.field) == self.value
        ]
        return matches[:self.limit_value]


class FakeCollection:
    def __init__(self, name):
        self.name = name
        self.documents = {}
        self.next_id = 0

    def document(self, document_id=None):
        if document_id is None:
            self.next_id += 1
            document_id = f"application-{self.next_id}"
        return FakeDocumentReference(self, document_id)

    def where(self, field, _operator, value):
        return FakeQuery(self, field, value)


class FakeTransaction:
    def create(self, reference, value):
        if reference.id in reference.collection.documents:
            raise RuntimeError("Document already exists")
        reference.collection.documents[reference.id] = value


class FakeDatabase:
    def __init__(self):
        self.collections = {}

    def collection(self, name):
        if name not in self.collections:
            self.collections[name] = FakeCollection(name)
        return self.collections[name]

    def transaction(self):
        return FakeTransaction()


class ProviderApplicationTests(unittest.TestCase):
    def setUp(self):
        self.firebase_user = {
            "uid": "firebase-provider-123",
            "email": "provider@example.test",
        }
        self.request = {
            "fullName": "Prestataire Test",
            "phone": "+243812345678",
            "specialty": "chauffeur",
            "listing": {
                "name": "Prestataire Test",
                "phone": "+243812345678",
                "country": "RDC",
                "city": "Kinshasa",
                "commune": "Gombe",
                "skills": ["Conduite"],
                "experienceYears": 3,
            },
        }
        self.app = FastAPI()
        self.app.include_router(provider_portal.router)
        self.app.dependency_overrides[require_firebase_user] = lambda: self.firebase_user
        self.database = FakeDatabase()

    def test_creates_pending_application_and_linked_account(self):
        with (
            patch.object(provider_portal, "db", self.database),
            patch(
                "services.provider_portal.firestore.transactional",
                side_effect=lambda function: function,
            ),
            TestClient(self.app) as client,
        ):
            response = client.post("/api/professional-applications", json=self.request)

        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["status"], "En attente")
        self.assertEqual(payload["paymentStatus"], "À vérifier manuellement")

        applications = self.database.collection("professionalApplications").documents
        accounts = self.database.collection("professionalAccounts").documents
        self.assertEqual(len(applications), 1)
        application_id, application = next(iter(applications.items()))
        self.assertEqual(application["uid"], self.firebase_user["uid"])
        self.assertEqual(application["status"], "En attente")
        self.assertEqual(application["paymentStatus"], "À vérifier manuellement")
        self.assertEqual(application["listing"]["phone"], self.request["phone"])
        self.assertEqual(accounts[self.firebase_user["uid"]]["applicationId"], application_id)
        self.assertEqual(accounts[self.firebase_user["uid"]]["status"], "En attente")

    def test_rejects_a_second_application_for_the_same_uid(self):
        with (
            patch.object(provider_portal, "db", self.database),
            patch(
                "services.provider_portal.firestore.transactional",
                side_effect=lambda function: function,
            ),
            TestClient(self.app) as client,
        ):
            first_response = client.post("/api/professional-applications", json=self.request)
            second_response = client.post("/api/professional-applications", json=self.request)

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 409)
        self.assertEqual(
            len(self.database.collection("professionalApplications").documents),
            1,
        )

    def test_requires_a_verified_firebase_user(self):
        self.app.dependency_overrides.clear()
        with TestClient(self.app) as client:
            response = client.post("/api/professional-applications", json=self.request)

        self.assertEqual(response.status_code, 401)

    def test_rejects_unsupported_specialty(self):
        invalid_request = {
            **self.request,
            "specialty": "service",
        }
        with TestClient(self.app) as client:
            response = client.post("/api/professional-applications", json=invalid_request)

        self.assertEqual(response.status_code, 422)

    def test_accepts_each_specialty_offered_by_the_onboarding_form(self):
        supported_specialties = [
            "chauffeur",
            "menagere",
            "coiffeur",
            "maquilleuse",
            "professeur",
        ]
        for specialty in supported_specialties:
            with self.subTest(specialty=specialty):
                request = {**self.request, "specialty": specialty}
                self.assertEqual(
                    provider_portal.ProfessionalApplicationRequest.model_validate(
                        request
                    ).specialty,
                    specialty,
                )

    def test_uses_the_top_level_phone_when_listing_phone_is_omitted(self):
        request = {
            **self.request,
            "listing": {
                key: value
                for key, value in self.request["listing"].items()
                if key != "phone"
            },
        }

        validated = provider_portal.ProfessionalApplicationRequest.model_validate(request)

        self.assertEqual(validated.phone, self.request["phone"])
        self.assertEqual(validated.listing.phone, "")

    def test_rejects_a_provider_application_outside_an_open_area(self):
        request = {
            **self.request,
            "listing": {
                **self.request["listing"],
                "country": "France",
                "city": "Paris",
                "commune": "",
            },
        }

        with TestClient(self.app) as client:
            response = client.post("/api/professional-applications", json=request)

        self.assertEqual(response.status_code, 422)
        self.assertEqual(
            response.json()["detail"],
            "Vous n'êtes pas encore éligible pour le moment dans cette zone.",
        )


class ProviderPortfolioUploadTests(unittest.TestCase):
    def test_single_upload_returns_signed_and_public_urls(self):
        s3_client = FakeS3Client()
        request = provider_portal.PortfolioUploadRequest.model_validate({
            "fileName": "1000661013.jpg",
            "contentType": "image/jpeg",
            "fileSize": 2048,
        })
        with (
            patch.object(provider_portal, "s3_client", s3_client),
            patch.object(
                provider_portal,
                "_verified_provider_or_error",
                return_value=FakeProvider(),
            ),
        ):
            response = provider_portal.create_portfolio_upload_urls(
                request,
                {"uid": "client-uid"},
                {},
            )

        self.assertEqual(response["uploadUrl"], "https://s3.example/upload")
        self.assertEqual(response["expiresIn"], 300)
        self.assertIn(
            "goying/prestataires/provider-123/portfolio/",
            response["publicUrl"],
        )
        self.assertEqual(
            s3_client.presign_calls[0][1]["Params"]["ContentLength"],
            2048,
        )

    def test_rejects_unsupported_and_oversized_images(self):
        unsupported = provider_portal.PortfolioUploadFile(
            filename="document.svg",
            content_type="image/svg+xml",
            file_size=100,
        )
        oversized = provider_portal.PortfolioUploadFile(
            filename="large.png",
            content_type="image/png",
            file_size=provider_portal.PORTFOLIO_MAX_FILE_SIZE + 1,
        )

        with self.assertRaises(HTTPException) as unsupported_error:
            provider_portal._validate_portfolio_upload(unsupported)
        self.assertEqual(unsupported_error.exception.status_code, 415)

        with self.assertRaises(HTTPException) as oversized_error:
            provider_portal._validate_portfolio_upload(oversized)
        self.assertEqual(oversized_error.exception.status_code, 413)

    def test_refuses_upload_when_portfolio_would_exceed_six_images(self):
        existing_keys = [
            f"goying/prestataires/provider-123/portfolio/{index}.jpg"
            for index in range(6)
        ]
        request = provider_portal.PortfolioUploadRequest.model_validate({
            "fileName": "new.png",
            "contentType": "image/png",
            "fileSize": 100,
        })
        with (
            patch.object(provider_portal, "s3_client", FakeS3Client(existing_keys)),
            patch.object(
                provider_portal,
                "_verified_provider_or_error",
                return_value=FakeProvider(),
            ),
        ):
            with self.assertRaises(HTTPException) as error:
                provider_portal.create_portfolio_upload_urls(
                    request,
                    {"uid": "client-uid"},
                    {},
                )

        self.assertEqual(error.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
