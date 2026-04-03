#!/usr/bin/env python3
"""Normalize podman compose ps output into a stable JSON array."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def detect_compose_cmd(runtime: str) -> list[str]:
    if runtime != "podman":
        raise ValueError(f"unsupported runtime: {runtime}")
    return ["podman-compose"]


def load_compose_status(raw: str) -> list[dict]:
    payload = raw.strip()
    if not payload:
        return []
    if payload.startswith("["):
        data = json.loads(payload)
        return data if isinstance(data, list) else [data]
    return [json.loads(line) for line in payload.splitlines() if line.strip()]


def normalize_item(item: dict) -> dict:
    names = item.get("Names") or item.get("Name") or ""
    if isinstance(names, list):
        name = names[0] if names else ""
    else:
        name = names

    state = str(item.get("State") or "").lower()
    status = str(item.get("Status") or "")
    health = str(item.get("Health") or "")
    if not health and "(healthy)" in status:
        health = "healthy"
    elif not health and "(unhealthy)" in status:
        health = "unhealthy"

    exit_code = item.get("ExitCode")
    try:
        exit_code_value = int(exit_code)
    except (TypeError, ValueError):
        exit_code_value = 0

    return {
        "name": name,
        "state": state,
        "status": status,
        "health": health,
        "exitCode": exit_code_value,
        "raw": item,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", choices=["podman"], required=True)
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--env-file", default="")
    args = parser.parse_args()

    compose_file = Path(args.compose_file)
    if not compose_file.exists():
        raise SystemExit(f"Compose file not found: {compose_file}")

    cmd = detect_compose_cmd(args.runtime)
    if args.env_file:
        cmd.extend(["--env-file", args.env_file])
    cmd.extend(["-f", str(compose_file), "ps", "--format", "json"])

    result = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        sys.stderr.write(result.stderr or result.stdout)
        return result.returncode

    normalized = [normalize_item(item) for item in load_compose_status(result.stdout)]
    json.dump(normalized, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
