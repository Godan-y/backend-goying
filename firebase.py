import os
import json

import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv


def _initialize_firebase() -> None:
    if firebase_admin._apps:
        return

    # Ensure .env is loaded (harmless if already loaded)
    load_dotenv()

    credentials_value = os.getenv("FIREBASE_CREDENTIALS", "firebase-key.json")

    # If the env var contains a JSON object (starts with '{'), parse it
    # and pass the dict to Certificate. Otherwise treat it as a file path.
    try:
        if isinstance(credentials_value, str) and credentials_value.strip().startswith('{'):
            cred_dict = json.loads(credentials_value)
            cred = credentials.Certificate(cred_dict)
        else:
            cred = credentials.Certificate(credentials_value)

        firebase_admin.initialize_app(cred)
    except FileNotFoundError:
        raise
    except Exception as e:
        # Re-raise with a clearer message
        raise RuntimeError(f"Impossible d'initialiser Firebase: {e}") from e


_initialize_firebase()

db = firestore.client()
