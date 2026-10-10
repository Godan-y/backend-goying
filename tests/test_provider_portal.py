import unittest
from unittest.mock import patch

from fastapi import HTTPException

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
