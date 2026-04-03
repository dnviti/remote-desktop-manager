#!/usr/bin/env python3
"""Installer artifact encryption helpers."""

from __future__ import annotations

import argparse
import base64
import getpass
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes


FORMAT_VERSION = 1
DEFAULT_ITERATIONS = 390000


def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64decode(data: str) -> bytes:
    return base64.b64decode(data.encode("ascii"))


def _derive_key(password: str, salt: bytes, iterations: int) -> bytes:
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=iterations,
    )
    return kdf.derive(password.encode("utf-8"))


def encrypt_payload(payload: bytes, password: str, *, aad: bytes = b"arsenale-installer") -> dict:
    salt = os.urandom(16)
    nonce = os.urandom(12)
    key = _derive_key(password, salt, DEFAULT_ITERATIONS)
    ciphertext = AESGCM(key).encrypt(nonce, payload, aad)
    return {
        "format": "arsenale-install-aesgcm",
        "version": FORMAT_VERSION,
        "kdf": {
            "name": "PBKDF2-HMAC-SHA256",
            "iterations": DEFAULT_ITERATIONS,
            "salt": _b64encode(salt),
        },
        "cipher": {
            "name": "AES-256-GCM",
            "nonce": _b64encode(nonce),
            "aad": _b64encode(aad),
            "ciphertext": _b64encode(ciphertext),
        },
    }


def decrypt_payload(payload: dict, password: str) -> bytes:
    if payload.get("format") != "arsenale-install-aesgcm":
        raise ValueError("unsupported payload format")
    if int(payload.get("version", 0)) > FORMAT_VERSION:
        raise ValueError("payload version is newer than this helper supports")
    kdf = payload.get("kdf", {})
    cipher = payload.get("cipher", {})
    salt = _b64decode(kdf["salt"])
    nonce = _b64decode(cipher["nonce"])
    aad = _b64decode(cipher["aad"])
    ciphertext = _b64decode(cipher["ciphertext"])
    key = _derive_key(password, salt, int(kdf["iterations"]))
    return AESGCM(key).decrypt(nonce, ciphertext, aad)


def resolve_password(args: argparse.Namespace) -> str:
    if args.password_file:
        return Path(args.password_file).read_text(encoding="utf-8").strip()
    if args.password_env and os.getenv(args.password_env):
        return os.environ[args.password_env].strip()
    if args.password_stdin:
        return sys.stdin.readline().rstrip("\n")
    return getpass.getpass("Installer password: ")


def command_encrypt(args: argparse.Namespace) -> int:
    password = resolve_password(args)
    plaintext = Path(args.input).read_bytes()
    encrypted = encrypt_payload(plaintext, password)
    Path(args.output).write_text(json.dumps(encrypted, indent=2) + "\n", encoding="utf-8")
    return 0


def command_decrypt(args: argparse.Namespace) -> int:
    password = resolve_password(args)
    encrypted = json.loads(Path(args.input).read_text(encoding="utf-8"))
    plaintext = decrypt_payload(encrypted, password)
    Path(args.output).write_bytes(plaintext)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Encrypt or decrypt installer artifacts.")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--password-file")
    common.add_argument("--password-env")
    common.add_argument("--password-stdin", action="store_true")

    subparsers = parser.add_subparsers(dest="command", required=True)

    encrypt_parser = subparsers.add_parser("encrypt", parents=[common])
    encrypt_parser.add_argument("--input", required=True)
    encrypt_parser.add_argument("--output", required=True)
    encrypt_parser.set_defaults(func=command_encrypt)

    decrypt_parser = subparsers.add_parser("decrypt", parents=[common])
    decrypt_parser.add_argument("--input", required=True)
    decrypt_parser.add_argument("--output", required=True)
    decrypt_parser.set_defaults(func=command_decrypt)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
