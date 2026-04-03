#!/usr/bin/env python3
"""Read encrypted installer status artifacts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from cryptography.exceptions import InvalidTag

sys.path.insert(0, str(Path(__file__).resolve().parent))

import install_crypto


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read an encrypted installer status artifact.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--password-file")
    parser.add_argument("--password-env")
    parser.add_argument("--password-stdin", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        password = install_crypto.resolve_password(args)
        encrypted = json.loads(Path(args.input).read_text(encoding="utf-8"))
        decrypted = install_crypto.decrypt_payload(encrypted, password)
    except FileNotFoundError:
        print(f"Installer artifact not found: {args.input}", file=sys.stderr)
        return 1
    except PermissionError:
        print(f"Permission denied reading installer artifact: {args.input}", file=sys.stderr)
        return 1
    except InvalidTag:
        print(
            "Failed to decrypt installer status. The installer password is incorrect or the artifact was tampered with.",
            file=sys.stderr,
        )
        return 1
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(decrypted.decode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
