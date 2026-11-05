"""Central email notifications, sent through Resend's HTTP API."""

import html
import json
import logging
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
RESEND_API_URL = "https://api.resend.com/emails"


def _send_with_resend(*, api_key: str, payload: dict) -> None:
    """Provider adapter. Replace this function to use another email provider."""
    request = Request(
        RESEND_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=10) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"Resend returned HTTP {response.status}")


def send_notification(event_type: str, title: str, message: str, details: dict | None = None) -> None:
    """Send one admin notification. Safe to call from a FastAPI background task."""
    recipient = os.getenv("NOTIFICATION_EMAIL", "").strip()
    api_key = os.getenv("EMAIL_PROVIDER_API_KEY", "").strip()
    sender = os.getenv("EMAIL_FROM", "").strip()
    if not recipient or not api_key or not sender:
        logger.warning("Notification email skipped: email environment is not fully configured (event=%s)", event_type)
        return

    rows = "".join(
        f"<tr><th align=\"left\">{html.escape(str(key))}</th>"
        f"<td>{html.escape(str(value))}</td></tr>"
        for key, value in (details or {}).items()
        if value is not None and str(value).strip()
    )
    safe_title = html.escape(title)
    safe_message = html.escape(message)
    payload = {
        "from": sender,
        "to": [recipient],
        "subject": f"[Goying] {title}",
        "html": (
            f"<h2>{safe_title}</h2><p>{safe_message}</p>"
            f"<p><strong>Événement :</strong> {html.escape(event_type)}</p>"
            f"<table>{rows}</table>"
        ),
        "text": "\n".join(
            [title, message, f"Événement : {event_type}"]
            + [f"{key} : {value}" for key, value in (details or {}).items() if value is not None]
        ),
    }
    try:
        _send_with_resend(api_key=api_key, payload=payload)
    except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError):
        logger.exception("Échec d'envoi de la notification email (event=%s)", event_type)
    except Exception:
        # A mail provider failure must never affect the operation that scheduled it.
        logger.exception("Erreur inattendue lors de l'envoi de la notification (event=%s)", event_type)
