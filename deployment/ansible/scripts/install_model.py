#!/usr/bin/env python3
"""Installer schema validation, resolution, and diff helpers."""

from __future__ import annotations

import argparse
import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import jsonschema
import yaml


SCHEMA_VERSION = "1.0.0"


def load_data(path: str | Path) -> Any:
    raw = Path(path).read_text(encoding="utf-8")
    if str(path).endswith(".json"):
        return json.loads(raw)
    return yaml.safe_load(raw)


def load_schema(path: str | Path) -> dict[str, Any]:
    schema = load_data(path)
    if not isinstance(schema, dict):
        raise ValueError(f"{path} must contain an object schema")
    return schema


def validate(data: Any, schema: dict[str, Any], *, schema_root: str | Path | None = None) -> None:
    store: dict[str, Any] = {}
    if schema_root is not None:
        root = Path(schema_root)
        for candidate in root.glob("*.json"):
            loaded = json.loads(candidate.read_text(encoding="utf-8"))
            store[candidate.name] = loaded
            if "$id" in loaded:
                store[str(loaded["$id"])] = loaded
        base_uri = root.resolve().as_uri() + "/"
    else:
        base_uri = Path(".").resolve().as_uri() + "/"
    resolver = jsonschema.RefResolver(
        base_uri=base_uri,
        referrer=schema,
        store=store,
    )
    jsonschema.Draft202012Validator(schema, resolver=resolver).validate(data)


def sha256_json(data: Any) -> str:
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_catalog(path: str | Path) -> dict[str, Any]:
    catalog = load_data(path)
    if not isinstance(catalog, dict) or "capabilities" not in catalog:
        raise ValueError("capability catalog is invalid")
    return catalog


def normalize_capabilities(profile: dict[str, Any], catalog: dict[str, Any]) -> dict[str, bool]:
    selected = {name: bool(value) for name, value in profile.get("capabilities", {}).items()}
    normalized: dict[str, bool] = {}
    for name, config in catalog["capabilities"].items():
        enabled = selected.get(name, bool(config.get("enabledByDefault", False)))
        if config.get("required"):
            enabled = True
        normalized[name] = enabled

    for name, config in catalog["capabilities"].items():
        if not normalized.get(name):
            continue
        for dependency in config.get("dependsOn", []):
            normalized[dependency] = True

    if not normalized.get("connections", False):
        normalized["recordings"] = False
    if not normalized.get("databases", False):
        # AI database tooling and DB audit surfaces cannot stay active without DB support.
        normalized["agentic_ai"] = bool(normalized.get("agentic_ai", False))
    return normalized


def resolve_profile(profile: dict[str, Any], catalog: dict[str, Any]) -> dict[str, Any]:
    capabilities = normalize_capabilities(profile, catalog)
    routing = deepcopy(profile.get("routing", {}))

    direct_enabled = bool(routing.get("directGateway", False))
    zero_trust_enabled = bool(routing.get("zeroTrust", False)) and capabilities.get("zero_trust", False)
    service_names = ["postgres", "migrate", "redis", "control-plane-api", "client"]
    if capabilities.get("connections"):
        service_names.extend(["guacd", "desktop-broker", "terminal-broker", "ssh-gateway"])
    if capabilities.get("ip_geolocation"):
        service_names.append("map-assets")
    if capabilities.get("recordings"):
        service_names.append("guacenc")
    if capabilities.get("databases"):
        service_names.extend(["query-runner"])
    if capabilities.get("agentic_ai"):
        service_names.extend(["model-gateway", "tool-gateway", "memory-service"])
    if zero_trust_enabled:
        service_names.extend(["tunnel-broker", "control-plane-controller", "runtime-agent", "agent-orchestrator"])

    env = {
        "ARSENALE_INSTALLER_ENABLED": "true",
        "ARSENALE_INSTALL_MODE": profile["mode"],
        "ARSENALE_INSTALL_BACKEND": profile["backend"],
        "ARSENALE_INSTALL_CAPABILITIES": ",".join(sorted(name for name, enabled in capabilities.items() if enabled)),
        "ARSENALE_DIRECT_ROUTING_ENABLED": str(direct_enabled).lower(),
        "ARSENALE_ZERO_TRUST_ENABLED": str(zero_trust_enabled).lower(),
        "FEATURE_CONNECTIONS_ENABLED": str(capabilities.get("connections", False)).lower(),
        "FEATURE_IP_GEOLOCATION_ENABLED": str(capabilities.get("ip_geolocation", False)).lower(),
        "FEATURE_DATABASE_PROXY_ENABLED": str(capabilities.get("databases", False)).lower(),
        "FEATURE_KEYCHAIN_ENABLED": str(capabilities.get("keychain", False)).lower(),
        "FEATURE_MULTI_TENANCY_ENABLED": str(capabilities.get("multi_tenancy", False)).lower(),
        "FEATURE_RECORDINGS_ENABLED": str(capabilities.get("recordings", False)).lower(),
        "FEATURE_ZERO_TRUST_ENABLED": str(capabilities.get("zero_trust", False)).lower(),
        "FEATURE_AGENTIC_AI_ENABLED": str(capabilities.get("agentic_ai", False)).lower(),
        "FEATURE_ENTERPRISE_AUTH_ENABLED": str(capabilities.get("enterprise_auth", False)).lower(),
        "FEATURE_SHARING_APPROVALS_ENABLED": str(capabilities.get("sharing_approvals", False)).lower(),
        "CLI_ENABLED": str(capabilities.get("cli", False)).lower(),
        "RECORDING_ENABLED": str(capabilities.get("recordings", False)).lower(),
        "ALLOW_EXTERNAL_SHARING": str(capabilities.get("sharing_approvals", False)).lower(),
        "GATEWAY_ROUTING_MODE": "gateway-mandatory" if zero_trust_enabled and not direct_enabled else "direct-allowed",
    }

    if profile["backend"] == "kubernetes":
        namespace = str((profile.get("kubernetes") or {}).get("namespace") or "arsenale").strip() or "arsenale"
        dns_suffix = f".{namespace}.svc.cluster.local"
        env.update(
            {
                "API_UPSTREAM_HOST": f"control-plane-api{dns_suffix}",
                "DESKTOP_UPSTREAM_HOST": f"desktop-broker{dns_suffix}",
                "MAP_ASSETS_UPSTREAM_HOST": f"map-assets{dns_suffix}",
                "TERMINAL_UPSTREAM_HOST": f"terminal-broker{dns_suffix}",
            }
        )

    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": profile["mode"],
        "backend": profile["backend"],
        "capabilities": capabilities,
        "routing": {
            "directGateway": direct_enabled,
            "zeroTrust": zero_trust_enabled,
        },
        "services": sorted(dict.fromkeys(service_names)),
        "environment": env,
        "devFullStack": profile["mode"] == "development" and all(capabilities.values()) and direct_enabled and zero_trust_enabled,
    }


def classify_run(profile: dict[str, Any], resolved: dict[str, Any], state: dict[str, Any] | None, status: dict[str, Any] | None) -> dict[str, Any]:
    desired_hash = sha256_json(profile)
    previous_hash = state.get("desiredProfileHash") if state else None
    previous_version = state.get("lastAppliedVersion") if state else None
    last_result = (status or {}).get("lastResult")
    state_backend = ((state or {}).get("backendState") or {}).get("backend")
    current_backend = profile["backend"]

    if last_result and last_result != "success":
        run_type = "recovery"
    elif not state:
        run_type = "fresh_install"
    elif previous_version and profile.get("productVersion") and previous_version != profile["productVersion"]:
        run_type = "upgrade"
    elif state_backend and state_backend != current_backend:
        run_type = "reconfigure"
    elif previous_hash == desired_hash:
        drift = ((status or {}).get("driftSummary") or {}).get("status")
        run_type = "drift_reconcile" if drift == "drifted" else "no_op"
    else:
        run_type = "reconfigure"

    previous_caps = set(
        name
        for name, enabled in (((state or {}).get("desiredProfile") or {}).get("capabilities") or {}).items()
        if enabled
    )
    current_caps = set(name for name, enabled in resolved["capabilities"].items() if enabled)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "runType": run_type,
        "desiredProfileHash": desired_hash,
        "changes": {
            "backendChanged": state_backend is not None and state_backend != current_backend,
            "capabilitiesAdded": sorted(current_caps - previous_caps),
            "capabilitiesRemoved": sorted(previous_caps - current_caps),
        },
        "generatedAt": now_utc(),
    }


def build_status(profile: dict[str, Any], resolved: dict[str, Any], diff: dict[str, Any], result: str = "pending") -> dict[str, Any]:
    return {
        "schemaVersion": SCHEMA_VERSION,
        "productVersion": profile.get("productVersion", "dev"),
        "mode": profile["mode"],
        "backend": profile["backend"],
        "enabledCapabilities": sorted(name for name, enabled in resolved["capabilities"].items() if enabled),
        "lastAction": diff["runType"],
        "lastResult": result,
        "timestamps": {
            "startedAt": diff["generatedAt"],
            "finishedAt": diff["generatedAt"],
        },
        "healthSummary": {
            "status": "pending",
            "services": resolved["services"],
        },
        "driftSummary": {
            "status": "clean" if diff["runType"] != "drift_reconcile" else "drifted",
        },
    }


def extract_named_mount(entry: Any) -> str | None:
    if isinstance(entry, dict):
        source = entry.get("source")
        if isinstance(source, str) and source and not source.startswith("/"):
            return source
        return None
    if not isinstance(entry, str):
        return None
    source = entry.split(":", 1)[0]
    if source.startswith("/") or source.startswith(".") or source.startswith("${"):
        return None
    return source or None


def prune_compose(compose_data: dict[str, Any], enabled_services: set[str]) -> dict[str, Any]:
    pruned = deepcopy(compose_data)
    services = pruned.get("services", {})
    if not isinstance(services, dict):
        raise ValueError("compose file does not contain a services map")
    pruned["services"] = {
        name: config
        for name, config in services.items()
        if name in enabled_services
    }

    used_networks: set[str] = set()
    used_volumes: set[str] = set()
    used_secrets: set[str] = set()

    for config in pruned["services"].values():
        depends_on = config.get("depends_on")
        if isinstance(depends_on, dict):
            config["depends_on"] = {
                name: value
                for name, value in depends_on.items()
                if name in enabled_services
            }
        elif isinstance(depends_on, list):
            config["depends_on"] = [name for name in depends_on if isinstance(name, str) and name in enabled_services]
        for network in config.get("networks", []):
            if isinstance(network, str):
                used_networks.add(network)
            elif isinstance(network, dict):
                used_networks.update(name for name in network.keys() if isinstance(name, str))
        for volume in config.get("volumes", []):
            named_mount = extract_named_mount(volume)
            if named_mount:
                used_volumes.add(named_mount)
        for secret in config.get("secrets", []):
            if isinstance(secret, str):
                used_secrets.add(secret)
            elif isinstance(secret, dict) and isinstance(secret.get("source"), str):
                used_secrets.add(secret["source"])

    for top_level, used in (("volumes", used_volumes), ("networks", used_networks), ("secrets", used_secrets)):
        existing = pruned.get(top_level)
        if isinstance(existing, dict):
            pruned[top_level] = {
                name: config
                for name, config in existing.items()
                if name in used
            }
    return pruned


def command_validate(args: argparse.Namespace) -> int:
    schema = load_schema(args.schema)
    data = load_data(args.input)
    validate(data, schema, schema_root=Path(args.schema).parent)
    return 0


def command_resolve(args: argparse.Namespace) -> int:
    catalog = load_catalog(args.catalog)
    profile = load_data(args.profile)
    resolved = resolve_profile(profile, catalog)
    output = json.dumps(resolved, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


def command_diff(args: argparse.Namespace) -> int:
    catalog = load_catalog(args.catalog)
    profile = load_data(args.profile)
    state = load_data(args.state) if args.state else None
    status = load_data(args.status) if args.status else None
    resolved = resolve_profile(profile, catalog)
    diff = classify_run(profile, resolved, state, status)
    payload = {
        "resolved": resolved,
        "diff": diff,
        "status": build_status(profile, resolved, diff),
    }
    output = json.dumps(payload, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


def command_prune_compose(args: argparse.Namespace) -> int:
    compose_data = load_data(args.input)
    if args.resolved:
        resolved = load_data(args.resolved)
        enabled_services = set(resolved.get("services", []))
    else:
        enabled_services = {name.strip() for name in args.services.split(",") if name.strip()}
    pruned = prune_compose(compose_data, enabled_services)
    output = yaml.safe_dump(pruned, sort_keys=False)
    if args.output:
        Path(args.output).write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Installer model helpers.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--schema", required=True)
    validate_parser.add_argument("--input", required=True)
    validate_parser.set_defaults(func=command_validate)

    resolve_parser = subparsers.add_parser("resolve")
    resolve_parser.add_argument("--catalog", required=True)
    resolve_parser.add_argument("--profile", required=True)
    resolve_parser.add_argument("--output")
    resolve_parser.set_defaults(func=command_resolve)

    diff_parser = subparsers.add_parser("diff")
    diff_parser.add_argument("--catalog", required=True)
    diff_parser.add_argument("--profile", required=True)
    diff_parser.add_argument("--state")
    diff_parser.add_argument("--status")
    diff_parser.add_argument("--output")
    diff_parser.set_defaults(func=command_diff)

    prune_compose_parser = subparsers.add_parser("prune-compose")
    prune_compose_parser.add_argument("--input", required=True)
    prune_compose_parser.add_argument("--resolved")
    prune_compose_parser.add_argument("--services", default="")
    prune_compose_parser.add_argument("--output")
    prune_compose_parser.set_defaults(func=command_prune_compose)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
