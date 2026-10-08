import unittest

from google.api_core.exceptions import PermissionDenied

from scripts.bootstrap_admin import (
    BootstrapStageError,
    _run_stage,
    _safe_failure_message,
)


class BootstrapAdminDiagnosticsTests(unittest.TestCase):
    def test_run_stage_reports_the_operation_without_exposing_exception_details(self):
        with self.assertRaises(BootstrapStageError) as raised:
            _run_stage("lecture Firestore", lambda: (_ for _ in ()).throw(
                ValueError("sensitive-value")
            ))

        self.assertEqual(raised.exception.stage, "lecture Firestore")
        self.assertNotIn("sensitive-value", str(raised.exception))
        self.assertNotIn("sensitive-value", _safe_failure_message(raised.exception.cause))

    def test_permission_error_has_actionable_safe_message(self):
        message = _safe_failure_message(PermissionDenied("private request content"))

        self.assertIn("Permission Firestore refusée", message)
        self.assertNotIn("private request content", message)

    def test_known_internal_bootstrap_error_keeps_its_safe_reason(self):
        message = _safe_failure_message(RuntimeError("Un administrateur global existe déjà"))

        self.assertEqual(message, "Un administrateur global existe déjà")


if __name__ == "__main__":
    unittest.main()
