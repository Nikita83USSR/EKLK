"""
Encrypt sensitive session fields at rest (Redis / memory dump).

Stage D: password (and ecom_token) are stored as Fernet ciphertext.
Runtime code still receives plaintext via SessionStore.get().

Key: derived from SECRET_KEY (PBKDF2-HMAC-SHA256 → 32 bytes → urlsafe Fernet key).
Changing SECRET_KEY invalidates existing sessions (users re-login).
"""

from __future__ import annotations

import base64
import hashlib
import logging
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from app.core.config import settings

logger = logging.getLogger("eklk.session")

# Prefix so we never treat plaintext as ciphertext by accident
_PREFIX = "eklk1:"
# Fixed salt scoped to this app (not a password hash; SECRET_KEY is the secret)
_SALT = b"eklk-session-v1"


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    secret = (settings.secret_key or "").encode("utf-8")
    if len(secret) < 16:
        logger.warning("SECRET_KEY is short; session encryption strength is reduced")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=120_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret))
    return Fernet(key)


def encrypt_secret(plain: str | None) -> str | None:
    if plain is None:
        return None
    if plain.startswith(_PREFIX):
        return plain  # already encrypted
    token = _fernet().encrypt(plain.encode("utf-8")).decode("ascii")
    return _PREFIX + token


def decrypt_secret(value: str | None) -> str | None:
    if value is None:
        return None
    if not value.startswith(_PREFIX):
        # Legacy plaintext session (pre-D) — allow until re-login
        return value
    raw = value[len(_PREFIX) :]
    try:
        return _fernet().decrypt(raw.encode("ascii")).decode("utf-8")
    except InvalidToken:
        logger.warning("Session secret decrypt failed (SECRET_KEY changed or corrupt data)")
        return None


def seal_session_for_storage(data: dict[str, Any]) -> dict[str, Any]:
    """Copy session dict with password / ecom_token encrypted."""
    out = dict(data)
    if "password" in out and out["password"] is not None:
        out["password"] = encrypt_secret(str(out["password"]))
    if out.get("ecom_token"):
        out["ecom_token"] = encrypt_secret(str(out["ecom_token"]))
    return out


def open_session_for_use(data: dict[str, Any]) -> dict[str, Any] | None:
    """
    Copy session dict with password / ecom_token decrypted.
    Returns None if password cannot be recovered (force re-login).
    """
    out = dict(data)
    if "password" in out:
        plain = decrypt_secret(out.get("password"))
        if plain is None:
            return None
        out["password"] = plain
    if out.get("ecom_token"):
        tok = decrypt_secret(out.get("ecom_token"))
        if tok is not None:
            out["ecom_token"] = tok
        else:
            out.pop("ecom_token", None)
    return out


def secrets_look_encrypted(data: dict[str, Any]) -> bool:
    pw = data.get("password")
    return isinstance(pw, str) and pw.startswith(_PREFIX)
