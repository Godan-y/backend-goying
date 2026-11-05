import os
import unittest
from unittest.mock import patch

from services import notification_service


class NotificationServiceTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "NOTIFICATION_EMAIL": "admin@example.test",
            "EMAIL_PROVIDER_API_KEY": "test-key",
            "EMAIL_FROM": "Goying <alerts@example.test>",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_sends_resend_payload_through_provider_adapter(self):
        with patch.object(notification_service, "_send_with_resend") as send:
            notification_service.send_notification(
                "property_booking", "Nouvelle réservation", "Une demande est arrivée.",
                {"Identifiant": "booking-1", "Commentaire": "<script>"},
            )

        send.assert_called_once()
        kwargs = send.call_args.kwargs
        self.assertEqual(kwargs["api_key"], "test-key")
        self.assertEqual(kwargs["payload"]["to"], ["admin@example.test"])
        self.assertIn("&lt;script&gt;", kwargs["payload"]["html"])
        self.assertIn("booking-1", kwargs["payload"]["text"])

    def test_missing_configuration_skips_provider(self):
        with patch.dict(os.environ, {"NOTIFICATION_EMAIL": "", "EMAIL_PROVIDER_API_KEY": "", "EMAIL_FROM": ""}), \
             patch.object(notification_service, "_send_with_resend") as send:
            notification_service.send_notification("event", "Title", "Message")
        send.assert_not_called()

    def test_provider_failure_is_logged_and_does_not_escape(self):
        with patch.object(notification_service, "_send_with_resend", side_effect=OSError("offline")), \
             self.assertLogs(notification_service.logger, level="ERROR"):
            notification_service.send_notification("event", "Title", "Message")


if __name__ == "__main__":
    unittest.main()
