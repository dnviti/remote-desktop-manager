#!/usr/bin/env python3
"""Run a rendered compose service via Podman without relying on podman-compose run."""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml


def load_compose(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def split_mount(entry: Any) -> tuple[str | None, str, str | None]:
    if isinstance(entry, dict):
        source = entry.get("source")
        target = entry.get("target")
        if not target:
            raise ValueError("volume entry missing target")
        mode = "ro" if entry.get("read_only") else None
        return (str(source) if source is not None else None, str(target), mode)
    if not isinstance(entry, str):
        raise ValueError("unsupported volume entry")
    parts = entry.split(":")
    if len(parts) == 1:
        return (None, parts[0], None)
    if len(parts) == 2:
        return (parts[0], parts[1], None)
    return (parts[0], parts[1], parts[2])


def normalize_project_name(path: Path) -> str:
    return re.sub(r"[^a-z0-9]+", "", path.parent.name.lower()) or "compose"


def resolve_podman_image(compose_file: Path, service_name: str, service: dict[str, Any]) -> str:
    image = service.get("image")
    if image:
        return str(image)
    project_name = normalize_project_name(compose_file)
    return f"localhost/{project_name}_{service_name}:latest"


def resolve_secret_name(entry: Any) -> str:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        if entry.get("source"):
            return str(entry["source"])
        if entry.get("target"):
            return str(entry["target"])
    raise ValueError(f"unsupported secret entry: {entry!r}")


def database_url_override() -> str:
    return os.environ.get("ARSENALE_DATABASE_URL_OVERRIDE", "")


def runtime_env() -> dict[str, str] | None:
    override = database_url_override()
    if not override:
        return None
    env = os.environ.copy()
    env["DATABASE_URL"] = override
    return env


def service_networks(service: dict[str, Any]) -> list[str]:
    networks = service.get("networks") or []
    if isinstance(networks, dict):
        return [str(name) for name in networks.keys()]
    return [str(name) for name in networks]


def resolve_podman_network_name(compose_file: Path, network_name: str) -> str:
    compose = load_compose(compose_file)
    network_definition = (compose.get("networks") or {}).get(network_name) or {}
    explicit_name = network_definition.get("name")
    if explicit_name:
        return str(explicit_name)
    project_name = normalize_project_name(compose_file)
    return f"{project_name}-{network_name}"


def service_command_args(service: dict[str, Any], override_args: list[str]) -> list[str]:
    if override_args:
        if override_args[0] == "--":
            override_args = override_args[1:]
        return override_args
    command = service.get("command")
    if command is None:
        return []
    if isinstance(command, list):
        return [str(item) for item in command]
    return [str(command)]


def build_podman_create_command(
    runtime: str,
    compose_file: Path,
    service_name: str,
    service: dict[str, Any],
    command_args: list[str],
) -> tuple[list[str], list[str], str]:
    container_name = str(service.get("container_name") or service_name)
    image = resolve_podman_image(compose_file, service_name, service)
    command = [runtime, "create", "--name", container_name]

    if service.get("read_only"):
        command.append("--read-only")
    if service.get("user"):
        command.extend(["--user", str(service["user"])])
    if service.get("cpus"):
        command.extend(["--cpus", str(service["cpus"])])
    if service.get("mem_limit"):
        command.extend(["--memory", str(service["mem_limit"])])
    if service.get("pids_limit") is not None:
        command.extend(["--pids-limit", str(service["pids_limit"])])

    for entry in service.get("tmpfs", []) or []:
        command.extend(["--tmpfs", str(entry)])
    for cap in service.get("cap_drop", []) or []:
        command.extend(["--cap-drop", str(cap)])
    for cap in service.get("cap_add", []) or []:
        command.extend(["--cap-add", str(cap)])
    for security_opt in service.get("security_opt", []) or []:
        command.extend(["--security-opt", str(security_opt)])

    entrypoint = service.get("entrypoint")
    if entrypoint:
        if isinstance(entrypoint, list):
            if len(entrypoint) == 1:
                command.extend(["--entrypoint", str(entrypoint[0])])
            else:
                command.extend(["--entrypoint", yaml.safe_dump(entrypoint, default_flow_style=True).strip()])
        else:
            command.extend(["--entrypoint", str(entrypoint)])

    environment = service.get("environment") or {}
    for key in sorted(environment):
        if key == "DATABASE_URL_FILE" and database_url_override():
            command.extend(["--env", "DATABASE_URL"])
            continue
        value = environment[key]
        command.extend(["--env", f"{key}={'' if value is None else value}"])

    for raw_mount in service.get("volumes", []) or []:
        source, target, mode = split_mount(raw_mount)
        mount_spec = target if source is None else f"{source}:{target}"
        if mode:
            mount_spec = f"{mount_spec}:{mode}"
        command.extend(["--volume", mount_spec])

    for secret in service.get("secrets", []) or []:
        secret_name = resolve_secret_name(secret)
        if secret_name == "database_url" and database_url_override():
            continue
        command.extend(["--secret", secret_name])

    networks = [resolve_podman_network_name(compose_file, network) for network in service_networks(service)]
    extra_networks: list[str] = []
    if networks:
        command.extend(["--network", networks[0]])
        extra_networks = networks[1:]

    command.append(image)
    command.extend(command_args)
    return command, extra_networks, container_name


def run_command(command: list[str]) -> None:
    completed = subprocess.run(command, text=True, capture_output=True, env=runtime_env())
    if completed.stdout:
        print(completed.stdout, end="")
    if completed.returncode != 0:
        if completed.stderr:
            print(completed.stderr, end="", file=sys.stderr)
        raise SystemExit(completed.returncode)


def start_service(runtime: str, container_name: str) -> int:
    completed = subprocess.run([runtime, "start", container_name], text=True, capture_output=True, env=runtime_env())
    if completed.stdout:
        print(completed.stdout, end="")
    if completed.returncode != 0:
        if completed.stderr:
            print(completed.stderr, end="", file=sys.stderr)
        return completed.returncode

    wait_result = subprocess.run([runtime, "wait", container_name], text=True, capture_output=True, env=runtime_env())
    logs_result = subprocess.run([runtime, "logs", container_name], text=True, capture_output=True, env=runtime_env())

    if logs_result.stdout:
        print(logs_result.stdout, end="")
    if logs_result.stderr:
        print(logs_result.stderr, end="", file=sys.stderr)

    if wait_result.returncode != 0:
        if wait_result.stderr:
            print(wait_result.stderr, end="", file=sys.stderr)
        return wait_result.returncode

    try:
        return int((wait_result.stdout or "1").strip().splitlines()[-1])
    except (ValueError, IndexError):
        return 1


def container_exists(runtime: str, container_name: str) -> bool:
    return subprocess.run([runtime, "container", "exists", container_name], capture_output=True, env=runtime_env()).returncode == 0


def remove_container(runtime: str, container_name: str) -> None:
    if not container_exists(runtime, container_name):
        return
    subprocess.run([runtime, "rm", "-f", container_name], capture_output=True, text=True, check=True, env=runtime_env())


def connect_networks(runtime: str, container_name: str, networks: list[str]) -> None:
    for network in networks:
        subprocess.run([runtime, "network", "connect", network, container_name], capture_output=True, text=True, check=True, env=runtime_env())


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Create and run a compose service via Podman.")
    parser.add_argument("--runtime", choices=["podman"], default="podman")
    parser.add_argument("--compose-file", required=True)
    parser.add_argument("--service", required=True)
    parser.add_argument("--recreate", action="store_true")
    parser.add_argument("service_args", nargs=argparse.REMAINDER)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    compose_file = Path(args.compose_file).resolve()
    compose = load_compose(compose_file)
    service = (compose.get("services") or {}).get(args.service)
    if service is None:
        raise SystemExit(f"Service not found in compose file: {args.service}")

    command_args = service_command_args(service, args.service_args)
    create_command, extra_networks, container_name = build_podman_create_command(
        runtime=args.runtime,
        compose_file=compose_file,
        service_name=args.service,
        service=service,
        command_args=command_args,
    )

    if args.recreate:
        remove_container(args.runtime, container_name)

    if not container_exists(args.runtime, container_name):
        run_command(create_command)
        connect_networks(args.runtime, container_name, extra_networks)

    return start_service(args.runtime, container_name)


if __name__ == "__main__":
    raise SystemExit(main())
