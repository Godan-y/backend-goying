"""Prevent application imports in unit tests from initializing real Firebase."""

import sys
import types


def install_firebase_db_stub() -> None:
    """Provide the ``firebase.db`` module dependency without service credentials."""
    firebase_module = types.ModuleType("firebase")
    firebase_module.db = None
    sys.modules["firebase"] = firebase_module
