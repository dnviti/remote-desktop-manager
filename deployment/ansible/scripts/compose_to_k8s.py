#!/usr/bin/env python3
"""Convert a rendered compose definition into Kubernetes manifests and Helm values."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import yaml


DEFAULT_PORTS = {
    "postgres": [5432],
    "redis": [6379],
    "guacd": [4822],
    "guacenc": [3003],
    "control-plane-api": [8080],
    "control-plane-controller": [8081],
    "authz-pdp": [8082],
    "model-gateway": [8083],
    "tool-gateway": [8084],
    "agent-orchestrator": [8085],
    "memory-service": [8086],
    "terminal-broker": [8090],
    "desktop-broker": [8091],
    "tunnel-broker": [8092],
    "query-runner": [8093],
    "runtime-agent": [8095],
    "client": [8080],
    "ssh-gateway": [2222],
    "dev-tunnel-ssh-gateway": [2222],
    "dev-tunnel-guacd": [4822],
    "dev-tunnel-db-proxy": [15432],
    "dev-demo-postgres": [5432],
    "dev-demo-mysql": [3306],
    "dev-demo-mongodb": [27017],
    "dev-demo-oracle": [1521],
    "dev-demo-mssql": [1433],
}

SKIP_BIND_PREFIXES = ("/run/user/", "/var/run/docker.sock", "/run/podman/", "/var/run/podman/")
SECRET_SUFFIXES = {".pem", ".key", ".crt", ".p12"}
PERSISTENT_VOLUME_KEYWORDS = ("data", "recordings", "drive", "redis", "pg")


class ManifestDumper(yaml.SafeDumper):
    """YAML dumper that uses literal blocks for multiline content."""


def _represent_str(dumper: yaml.SafeDumper, data: str) -> yaml.nodes.ScalarNode:
    style = "|" if "\n" in data else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


ManifestDumper.add_representer(str, _represent_str)

ENV_PATTERN = re.compile(r"\$\{([^}:]+)(?:(:?[-?])(.*?))?\}")


def load_yaml(path: Path) -> Any:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def dump_yaml_documents(documents: list[dict[str, Any]]) -> str:
    return yaml.dump_all(documents, Dumper=ManifestDumper, sort_keys=False)


def dump_yaml(data: Any) -> str:
    return yaml.dump(data, Dumper=ManifestDumper, sort_keys=False)


def sanitize_name(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    cleaned = "-".join(part for part in cleaned.split("-") if part)
    return cleaned[:63].rstrip("-") or "arsenale"


def digest_name(prefix: str, value: str) -> str:
    return sanitize_name(f"{prefix}-{hashlib.sha1(value.encode('utf-8')).hexdigest()[:12]}")


def parse_seconds(duration: str | None, default: int) -> int:
    if not duration:
        return default
    duration = str(duration).strip().lower()
    if duration.endswith("ms"):
        return max(1, int(float(duration[:-2]) / 1000))
    if duration.endswith("s"):
        return max(1, int(float(duration[:-1])))
    if duration.endswith("m"):
        return max(1, int(float(duration[:-1]) * 60))
    if duration.endswith("h"):
        return max(1, int(float(duration[:-1]) * 3600))
    return max(1, int(float(duration)))


def env_to_list(env_map: dict[str, Any]) -> list[dict[str, str]]:
    items = []
    for key in sorted(env_map):
        value = env_map[key]
        items.append({"name": key, "value": "" if value is None else str(value)})
    return items


def split_mount(entry: Any) -> tuple[str | None, str, bool] | None:
    if isinstance(entry, dict):
        source = entry.get("source")
        target = entry.get("target")
        if not target:
            return None
        read_only = bool(entry.get("read_only", False))
        return (str(source) if source is not None else None, str(target), read_only)
    if not isinstance(entry, str):
        return None
    parts = entry.split(":")
    if len(parts) == 1:
        return (None, parts[0], False)
    if len(parts) == 2:
        return (parts[0], parts[1], False)
    source = parts[0]
    target = parts[1]
    mode = parts[2]
    return (source, target, "ro" in mode)


def parse_service_ports(service_name: str, service: dict[str, Any]) -> list[int]:
    ports: list[int] = []
    for entry in service.get("ports", []) or []:
        if isinstance(entry, int):
            ports.append(entry)
            continue
        if isinstance(entry, dict):
            target = entry.get("target")
            if target:
                ports.append(int(target))
            continue
        if not isinstance(entry, str):
            continue
        port_spec = entry
        if "/" in port_spec:
            port_spec = port_spec.split("/", 1)[0]
        parts = port_spec.split(":")
        if parts:
            try:
                ports.append(int(parts[-1]))
            except ValueError:
                continue
    if not ports:
        env_port = (service.get("environment") or {}).get("PORT")
        if env_port:
            try:
                ports.append(int(env_port))
            except ValueError:
                pass
    if not ports:
        ports.extend(DEFAULT_PORTS.get(service_name, []))
    return sorted(dict.fromkeys(ports))


def health_probe(healthcheck: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(healthcheck, dict):
        return None
    test = healthcheck.get("test")
    if not test:
        return None
    if isinstance(test, str):
        command = ["/bin/sh", "-c", test]
    elif isinstance(test, list):
        if len(test) >= 2 and str(test[0]).upper() == "CMD-SHELL":
            command = ["/bin/sh", "-c", str(test[1])]
        else:
            command = [str(part) for part in test if str(part).upper() != "CMD"]
    else:
        return None
    return {
        "exec": {"command": command},
        "initialDelaySeconds": 10,
        "periodSeconds": parse_seconds(healthcheck.get("interval"), 10),
        "timeoutSeconds": parse_seconds(healthcheck.get("timeout"), 5),
        "failureThreshold": int(healthcheck.get("retries", 3)),
    }


def should_skip_bind(source: Path) -> bool:
    resolved = str(source)
    return any(resolved.startswith(prefix) for prefix in SKIP_BIND_PREFIXES) or resolved.endswith(".sock")


def is_secret_asset(source: Path, target: str) -> bool:
    return (
        target.startswith("/certs")
        or source.suffix.lower() in SECRET_SUFFIXES
        or "cert" in source.name.lower()
        or "key" in source.name.lower()
        or "secret" in source.name.lower()
    )


def load_text_file(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_env_file(path: Path | None) -> dict[str, str]:
    if path is None or not path.exists():
        return {}
    env_map: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key.strip()] = value.strip()
    return env_map


def resolve_placeholders(value: Any, env_map: dict[str, str]) -> Any:
    if isinstance(value, dict):
        return {key: resolve_placeholders(item, env_map) for key, item in value.items()}
    if isinstance(value, list):
        return [resolve_placeholders(item, env_map) for item in value]
    if not isinstance(value, str):
        return value

    def replace(match: re.Match[str]) -> str:
        key = match.group(1)
        operator = match.group(2) or ""
        fallback = match.group(3) or ""
        resolved = env_map.get(key)

        if operator in (":-", "-"):
            return resolved if resolved not in (None, "") else fallback
        if operator in (":?", "?"):
            if resolved in (None, ""):
                raise ValueError(f"Missing required environment variable: {key}")
            return resolved
        if operator == "":
            return "" if resolved is None else resolved
        return match.group(0)

    return ENV_PATTERN.sub(replace, value)


def should_mount_executable(source: Path, target: str) -> bool:
    try:
        is_executable = bool(source.stat().st_mode & 0o111)
    except FileNotFoundError:
        is_executable = False
    return is_executable or target.startswith("/usr/local/bin/") or target.endswith(".sh")


def parse_user_spec(user: Any) -> dict[str, int]:
    if user is None:
        return {}
    if isinstance(user, int):
        return {"runAsUser": int(user)}

    user_text = str(user).strip()
    if not user_text:
        return {}

    user_parts = user_text.split(":", 1)
    security_context: dict[str, int] = {}

    try:
        security_context["runAsUser"] = int(user_parts[0])
    except ValueError:
        return {}

    if len(user_parts) > 1 and user_parts[1]:
        try:
            security_context["runAsGroup"] = int(user_parts[1])
        except ValueError:
            pass

    return security_context


def register_bind_asset(
    source: Path,
    target: str,
    namespace: str,
    manifests: list[dict[str, Any]],
    registry: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    source = source.resolve()
    if should_skip_bind(source) or not source.exists():
        return None
    source_key = str(source)
    if source_key in registry:
        return registry[source_key]

    data: dict[str, str] = {}
    if source.is_file():
        data[source.name] = load_text_file(source)
    elif source.is_dir():
        for child in sorted(source.iterdir()):
            if child.is_file():
                data[child.name] = load_text_file(child)
    if not data:
        return None

    asset_kind = "Secret" if is_secret_asset(source, target) else "ConfigMap"
    asset_name = digest_name("asset", source_key)
    manifest: dict[str, Any] = {
        "apiVersion": "v1",
        "kind": asset_kind,
        "metadata": {"name": asset_name, "namespace": namespace},
    }
    if asset_kind == "Secret":
        manifest["type"] = "Opaque"
        manifest["stringData"] = data
    else:
        manifest["data"] = data
    manifests.append(manifest)
    registry[source_key] = {
        "name": asset_name,
        "kind": asset_kind,
        "keys": sorted(data.keys()),
        "source": source_key,
    }
    return registry[source_key]


def build_secret_volume(secret_names: list[str]) -> tuple[dict[str, Any], dict[str, Any]] | None:
    if not secret_names:
        return None
    return (
        {
            "name": "runtime-secrets",
            "secret": {
                "secretName": "arsenale-runtime-secrets",
                "items": [{"key": name, "path": name} for name in secret_names],
                "defaultMode": 0o444,
            },
        },
        {
            "name": "runtime-secrets",
            "mountPath": "/run/secrets",
            "readOnly": True,
        },
    )


def build_mounts(
    compose_dir: Path,
    service_name: str,
    service: dict[str, Any],
    namespace: str,
    manifests: list[dict[str, Any]],
    registry: dict[str, dict[str, Any]],
    persistent_volumes: dict[str, dict[str, Any]],
    storage_class: str | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    volumes: list[dict[str, Any]] = []
    mounts: list[dict[str, Any]] = []
    anonymous_index = 0

    for raw_mount in service.get("volumes", []) or []:
        parsed = split_mount(raw_mount)
        if parsed is None:
            continue
        source, target, read_only = parsed
        if not source:
            anonymous_index += 1
            volume_name = sanitize_name(f"{service_name}-anon-{anonymous_index}")
            volumes.append({"name": volume_name, "emptyDir": {}})
            mounts.append({"name": volume_name, "mountPath": target, "readOnly": read_only})
            continue

        source_path = Path(source)
        is_bind = source.startswith("/") or source.startswith(".")
        if is_bind:
            if not source_path.is_absolute():
                source_path = (compose_dir / source_path).resolve()
            asset = register_bind_asset(source_path, target, namespace, manifests, registry)
            if not asset:
                continue
            volume_name = sanitize_name(f"{service_name}-{asset['name']}")
            if source_path.is_file():
                key_name = source_path.name
                if asset["kind"] == "Secret":
                    secret_volume: dict[str, Any] = {
                        "secretName": asset["name"],
                        "items": [{"key": key_name, "path": key_name}],
                    }
                    if should_mount_executable(source_path, target):
                        secret_volume["defaultMode"] = 0o500
                    volumes.append({"name": volume_name, "secret": secret_volume})
                else:
                    config_map_volume: dict[str, Any] = {
                        "name": asset["name"],
                        "items": [{"key": key_name, "path": key_name}],
                    }
                    if should_mount_executable(source_path, target):
                        config_map_volume["defaultMode"] = 0o555
                    volumes.append({"name": volume_name, "configMap": config_map_volume})
                mounts.append(
                    {
                        "name": volume_name,
                        "mountPath": target,
                        "subPath": key_name,
                        "readOnly": True,
                    }
                )
            else:
                if asset["kind"] == "Secret":
                    volumes.append({"name": volume_name, "secret": {"secretName": asset["name"]}})
                else:
                    volumes.append({"name": volume_name, "configMap": {"name": asset["name"]}})
                mounts.append({"name": volume_name, "mountPath": target, "readOnly": True})
            continue

        claim_name = sanitize_name(source)
        if claim_name not in persistent_volumes:
            persistent_volumes[claim_name] = {
                "apiVersion": "v1",
                "kind": "PersistentVolumeClaim",
                "metadata": {"name": claim_name, "namespace": namespace},
                "spec": {
                    "accessModes": ["ReadWriteOnce"],
                    "resources": {"requests": {"storage": "5Gi" if any(keyword in claim_name for keyword in PERSISTENT_VOLUME_KEYWORDS) else "1Gi"}},
                },
            }
            if storage_class:
                persistent_volumes[claim_name]["spec"]["storageClassName"] = storage_class
        volumes.append({"name": claim_name, "persistentVolumeClaim": {"claimName": claim_name}})
        mounts.append({"name": claim_name, "mountPath": target, "readOnly": read_only})

    return volumes, mounts


def wait_init_containers(depends_on: Any, service_ports: dict[str, list[int]]) -> list[dict[str, Any]]:
    dependencies: list[str] = []
    if isinstance(depends_on, dict):
        dependencies = [name for name in depends_on.keys() if name in service_ports]
    elif isinstance(depends_on, list):
        dependencies = [name for name in depends_on if name in service_ports]
    containers: list[dict[str, Any]] = []
    for dependency in dependencies:
        ports = service_ports.get(dependency) or []
        if not ports:
            continue
        containers.append(
            {
                "name": sanitize_name(f"wait-{dependency}"),
                "image": "docker.io/library/busybox:1.36",
                "command": [
                    "/bin/sh",
                    "-c",
                    f"until nc -z {dependency} {ports[0]}; do echo waiting for {dependency}; sleep 2; done",
                ],
            }
        )
    return containers


def maybe_tls_secret(client_service: dict[str, Any], compose_dir: Path, namespace: str) -> dict[str, Any] | None:
    for raw_mount in client_service.get("volumes", []) or []:
        parsed = split_mount(raw_mount)
        if not parsed:
            continue
        source, target, _ = parsed
        if not source or target != "/certs":
            continue
        source_path = Path(source)
        if not source_path.is_absolute():
            source_path = (compose_dir / source_path).resolve()
        cert_path = source_path / "server-cert.pem"
        key_path = source_path / "server-key.pem"
        if cert_path.exists() and key_path.exists():
            return {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {"name": "arsenale-client-tls", "namespace": namespace},
                "type": "kubernetes.io/tls",
                "stringData": {
                    "tls.crt": load_text_file(cert_path),
                    "tls.key": load_text_file(key_path),
                },
            }
    return None


def load_optional_data(path: Path | None) -> dict[str, Any]:
    if path is None or not path.exists():
        return {}
    loaded = load_yaml(path)
    if isinstance(loaded, dict):
        return loaded
    raise ValueError(f"expected mapping in {path}")


def build_helm_values(
    manifests: list[dict[str, Any]],
    metadata: dict[str, Any],
    namespace: str,
    ingress_host: str | None,
    ingress_class: str | None,
    tls_enabled: bool,
    kubernetes_config: dict[str, Any],
) -> dict[str, Any]:
    return {
        "namespace": namespace,
        "ingress": {
            "host": ingress_host or "",
            "className": ingress_class or "",
            "tlsEnabled": bool(tls_enabled),
        },
        "kubernetes": {
            "replicas": int(kubernetes_config.get("replicas", 1) or 1),
            "autoscaling": kubernetes_config.get("autoscaling") or {"enabled": False},
            "storageClass": str(kubernetes_config.get("storageClass") or ""),
            "imagePullSecrets": list(kubernetes_config.get("imagePullSecrets") or []),
            "nodeSelector": dict(kubernetes_config.get("nodeSelector") or {}),
            "tolerations": list(kubernetes_config.get("tolerations") or []),
            "resources": dict(kubernetes_config.get("resources") or {}),
        },
        "rendered": {
            "resources": manifests,
            "metadata": metadata,
        },
    }


def convert(
    compose_file: Path,
    output_file: Path,
    metadata_file: Path | None,
    namespace: str,
    ingress_host: str | None,
    ingress_class: str | None,
    tls_enabled: bool,
    secret_file: Path | None,
    env_file: Path | None,
    local_image_prefix: str,
    values_output_file: Path | None = None,
    kubernetes_config: dict[str, Any] | None = None,
) -> None:
    compose = load_yaml(compose_file)
    compose = resolve_placeholders(compose, parse_env_file(env_file))
    compose_dir = compose_file.parent
    services: dict[str, Any] = compose.get("services", {})
    kubernetes_config = kubernetes_config or {}
    replica_count = int(kubernetes_config.get("replicas", 1) or 1)
    storage_class = str(kubernetes_config.get("storageClass") or "").strip() or None
    image_pull_secrets = list(kubernetes_config.get("imagePullSecrets") or [])
    node_selector = dict(kubernetes_config.get("nodeSelector") or {})
    tolerations = list(kubernetes_config.get("tolerations") or [])
    resource_requirements = dict(kubernetes_config.get("resources") or {})
    secret_values = {}
    if secret_file:
        secret_values = json.loads(secret_file.read_text(encoding="utf-8"))

    manifests: list[dict[str, Any]] = []
    asset_manifests: list[dict[str, Any]] = []
    service_manifests: list[dict[str, Any]] = []
    deployment_manifests: list[dict[str, Any]] = []
    job_manifests: list[dict[str, Any]] = []
    ingress_manifests: list[dict[str, Any]] = []
    registry: dict[str, dict[str, Any]] = {}
    persistent_volumes: dict[str, dict[str, Any]] = {}
    service_ports = {name: parse_service_ports(name, config) for name, config in services.items()}
    metadata: dict[str, Any] = {
        "namespace": namespace,
        "images": [],
        "deployments": [],
        "jobs": [],
        "services": [],
        "persistentVolumeClaims": [],
    }

    if secret_values:
        manifests.append(
            {
                "apiVersion": "v1",
                "kind": "Secret",
                "metadata": {"name": "arsenale-runtime-secrets", "namespace": namespace},
                "type": "Opaque",
                "stringData": {key: "" if value is None else str(value) for key, value in secret_values.items()},
            }
        )

    tls_secret_manifest = None
    if ingress_host and "client" in services and tls_enabled:
        tls_secret_manifest = maybe_tls_secret(services["client"], compose_dir, namespace)
        if tls_secret_manifest:
            manifests.append(tls_secret_manifest)

    for service_name, service in services.items():
        labels = {"app.kubernetes.io/name": "arsenale", "app.kubernetes.io/component": sanitize_name(service_name)}
        env = env_to_list(service.get("environment") or {})
        volumes, volume_mounts = build_mounts(
            compose_dir,
            service_name,
            service,
            namespace,
            asset_manifests,
            registry,
            persistent_volumes,
            storage_class,
        )
        secret_names = []
        for secret_entry in service.get("secrets", []) or []:
            if isinstance(secret_entry, str):
                secret_names.append(secret_entry)
            elif isinstance(secret_entry, dict) and secret_entry.get("source"):
                secret_names.append(str(secret_entry["source"]))
        secret_volume = build_secret_volume(secret_names)
        if secret_volume:
            volumes.append(secret_volume[0])
            volume_mounts.append(secret_volume[1])

        container_ports = [{"containerPort": port, "name": sanitize_name(f"tcp-{port}")} for port in service_ports.get(service_name, [])]
        image_name = service.get("image") or f"{local_image_prefix}arsenale_{service_name}:latest"
        metadata["images"].append(image_name)

        container: dict[str, Any] = {
            "name": sanitize_name(service_name),
            "image": image_name,
            "imagePullPolicy": "IfNotPresent",
            "env": env,
        }
        security_context = parse_user_spec(service.get("user"))
        if security_context:
            container["securityContext"] = security_context
        if resource_requirements:
            container["resources"] = resource_requirements
        if container_ports:
            container["ports"] = container_ports
        if volume_mounts:
            container["volumeMounts"] = volume_mounts
        probe = health_probe(service.get("healthcheck"))
        if probe:
            container["readinessProbe"] = probe
            container["livenessProbe"] = probe
        if service.get("entrypoint"):
            entrypoint = service["entrypoint"]
            container["command"] = entrypoint if isinstance(entrypoint, list) else ["/bin/sh", "-c", str(entrypoint)]
        if service.get("command"):
            command = service["command"]
            container["args"] = command if isinstance(command, list) else ["/bin/sh", "-c", str(command)]

        pod_spec: dict[str, Any] = {
            "containers": [container],
            "automountServiceAccountToken": False,
        }
        if image_pull_secrets:
            pod_spec["imagePullSecrets"] = [{"name": str(secret_name)} for secret_name in image_pull_secrets]
        if node_selector:
            pod_spec["nodeSelector"] = node_selector
        if tolerations:
            pod_spec["tolerations"] = tolerations
        if volumes:
            pod_spec["volumes"] = volumes
        init_containers = wait_init_containers(service.get("depends_on"), service_ports)
        if init_containers:
            pod_spec["initContainers"] = init_containers

        if service_name == "migrate":
            job_manifests.append(
                {
                    "apiVersion": "batch/v1",
                    "kind": "Job",
                    "metadata": {
                        "name": sanitize_name(service_name),
                        "namespace": namespace,
                        "labels": labels,
                    },
                    "spec": {
                        "template": {
                            "metadata": {"labels": labels},
                            "spec": {"restartPolicy": "OnFailure", **pod_spec},
                        }
                    },
                }
            )
            metadata["jobs"].append(service_name)
            continue

        deployment_manifests.append(
            {
                "apiVersion": "apps/v1",
                "kind": "Deployment",
                "metadata": {"name": sanitize_name(service_name), "namespace": namespace, "labels": labels},
                "spec": {
                    "replicas": replica_count,
                    "selector": {"matchLabels": labels},
                    "template": {
                        "metadata": {"labels": labels},
                        "spec": pod_spec,
                    },
                },
            }
        )
        metadata["deployments"].append(service_name)

        if service_ports.get(service_name):
            service_manifests.append(
                {
                    "apiVersion": "v1",
                    "kind": "Service",
                    "metadata": {"name": sanitize_name(service_name), "namespace": namespace, "labels": labels},
                    "spec": {
                        "selector": labels,
                        "ports": [
                            {
                                "name": sanitize_name(f"tcp-{port}"),
                                "port": port,
                                "targetPort": port,
                            }
                            for port in service_ports[service_name]
                        ],
                    },
                }
            )
            metadata["services"].append(service_name)

    if ingress_host and "client" in services:
        ingress_spec: dict[str, Any] = {
            "apiVersion": "networking.k8s.io/v1",
            "kind": "Ingress",
            "metadata": {
                "name": "arsenale-client",
                "namespace": namespace,
                "annotations": {},
            },
            "spec": {
                "rules": [
                    {
                        "host": ingress_host,
                        "http": {
                            "paths": [
                                {
                                    "path": "/",
                                    "pathType": "Prefix",
                                    "backend": {"service": {"name": "client", "port": {"number": service_ports.get("client", [8080])[0]}}},
                                }
                            ]
                        },
                    }
                ]
            },
        }
        if ingress_class:
            ingress_spec["spec"]["ingressClassName"] = ingress_class
        if tls_enabled and tls_secret_manifest:
            ingress_spec["spec"]["tls"] = [{"hosts": [ingress_host], "secretName": "arsenale-client-tls"}]
        ingress_manifests.append(ingress_spec)

    manifests.extend(asset_manifests)
    manifests.extend(persistent_volumes.values())
    metadata["persistentVolumeClaims"] = sorted(persistent_volumes.keys())
    manifests.extend(service_manifests)
    manifests.extend(deployment_manifests)
    manifests.extend(job_manifests)
    manifests.extend(ingress_manifests)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(dump_yaml_documents(manifests), encoding="utf-8")
    if values_output_file:
        values_output_file.parent.mkdir(parents=True, exist_ok=True)
        values_output_file.write_text(
            dump_yaml(
                build_helm_values(
                    manifests=manifests,
                    metadata=metadata,
                    namespace=namespace,
                    ingress_host=ingress_host,
                    ingress_class=ingress_class,
                    tls_enabled=tls_enabled,
                    kubernetes_config=kubernetes_config,
                )
            ),
            encoding="utf-8",
        )
    if metadata_file:
        metadata["images"] = sorted(dict.fromkeys(metadata["images"]))
        metadata_file.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Convert compose to Kubernetes manifests.")
    parser.add_argument("--compose", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--values-output")
    parser.add_argument("--metadata-output")
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--ingress-host")
    parser.add_argument("--ingress-class")
    parser.add_argument("--tls-enabled", action="store_true")
    parser.add_argument("--secret-file")
    parser.add_argument("--env-file")
    parser.add_argument("--local-image-prefix", default="")
    parser.add_argument("--kubernetes-config")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    convert(
        compose_file=Path(args.compose),
        output_file=Path(args.output),
        values_output_file=Path(args.values_output) if args.values_output else None,
        metadata_file=Path(args.metadata_output) if args.metadata_output else None,
        namespace=args.namespace,
        ingress_host=args.ingress_host,
        ingress_class=args.ingress_class,
        tls_enabled=bool(args.tls_enabled),
        secret_file=Path(args.secret_file) if args.secret_file else None,
        env_file=Path(args.env_file) if args.env_file else None,
        local_image_prefix=args.local_image_prefix,
        kubernetes_config=load_optional_data(Path(args.kubernetes_config)) if args.kubernetes_config else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
