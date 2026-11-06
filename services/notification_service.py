"""Central email notifications, sent through Resend's HTTP API."""

import html
import json
import logging
import os
import re
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)
RESEND_API_URL = "https://api.resend.com/emails"
_EMAIL_PATTERN = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE_PATTERN = re.compile(r"(?<!\w)\+?\d[\d\s().-]{6,}\d(?!\w)")
_BEARER_PATTERN = re.compile(r"\bBearer\s+\S+", re.IGNORECASE)
_TOKEN_PATTERN = re.compile(r"\bre_[A-Za-z0-9_-]{8,}\b")
_JWT_PATTERN = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|authorization)"
    r"\s*[:=]\s*[\"']?[^\s,}\"']+",
    re.IGNORECASE,
)


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


def _safe_http_error_body(error: HTTPError, sensitive_values: list[str]) -> str:
    """Read and redact Resend's response body before writing it to application logs."""
    try:
        body = error.read().decode("utf-8", errors="replace")
    except Exception:
        return "<response body unavailable>"

    try:
        parsed_body = json.loads(body)

        def is_sensitive_field(key: str) -> bool:
            normalized_key = re.sub(r"[^a-z0-9]", "", key.lower())
            sensitive_names = {"apikey", "authorization", "email", "from", "phone", "recipient", "to", "uid"}
            sensitive_fragments = ("token", "secret", "password")
            return normalized_key in sensitive_names or any(
                fragment in normalized_key for fragment in sensitive_fragments
            )

        def redact_fields(value):
            if isinstance(value, dict):
                return {
                    key: "[REDACTED]" if is_sensitive_field(key) else redact_fields(item)
                    for key, item in value.items()
                }
            if isinstance(value, list):
                return [redact_fields(item) for item in value]
            return value

        body = json.dumps(redact_fields(parsed_body), ensure_ascii=False)
    except (TypeError, ValueError):
        pass

    for value in sorted((item for item in sensitive_values if item), key=len, reverse=True):
        body = body.replace(value, "[REDACTED]")
    body = _EMAIL_PATTERN.sub("[EMAIL REDACTED]", body)
    body = _PHONE_PATTERN.sub("[PHONE REDACTED]", body)
    body = _BEARER_PATTERN.sub("Bearer [REDACTED]", body)
    body = _TOKEN_PATTERN.sub("[TOKEN REDACTED]", body)
    body = _JWT_PATTERN.sub("[TOKEN REDACTED]", body)
    body = _SECRET_ASSIGNMENT_PATTERN.sub("[SECRET REDACTED]", body)
    return repr(body[:2000])


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
    except (HTTPError, URLError, TimeoutError, OSError, RuntimeError, ValueError) as exc:
        response_body = ""
        if isinstance(exc, HTTPError):
            sensitive_values = [api_key, recipient, sender, title, message]
            sensitive_values.extend(str(value) for value in (details or {}).values() if value is not None)
            response_body = _safe_http_error_body(exc, sensitive_values)
        logger.exception(
            "Échec d'envoi de la notification email (event=%s, http_status=%s, response_body=%s)",
            event_type,
            exc.code if isinstance(exc, HTTPError) else None,
            response_body or None,
        )
    except Exception:
        # A mail provider failure must never affect the operation that scheduled it.
        logger.exception("Erreur inattendue lors de l'envoi de la notification (event=%s)", event_type)
