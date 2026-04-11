from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

import jsonschema
import yaml

from deployment.ansible.scripts import compose_to_k8s, install_crypto, install_model, run_compose_service


ROOT = Path(__file__).resolve().parents[3]
INSTALL_DIR = ROOT / "deployment" / "ansible" / "install"


class InstallCryptoTest(unittest.TestCase):
    def test_encrypt_decrypt_round_trip(self) -> None:
        payload = b'{"hello":"world"}'
        encrypted = install_crypto.encrypt_payload(payload, "secret")
        decrypted = install_crypto.decrypt_payload(encrypted, "secret")
        self.assertEqual(decrypted, payload)

    def test_wrong_password_fails(self) -> None:
        payload = install_crypto.encrypt_payload(b"secret", "correct")
        with self.assertRaises(Exception):
            install_crypto.decrypt_payload(payload, "wrong")

    def test_tamper_detection_fails(self) -> None:
        payload = install_crypto.encrypt_payload(b"secret", "correct")
        tampered = json.loads(json.dumps(payload))
        tampered["cipher"]["ciphertext"] = tampered["cipher"]["ciphertext"][:-4] + "AAAA"
        with self.assertRaises(Exception):
            install_crypto.decrypt_payload(tampered, "correct")


class InstallModelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.catalog = install_model.load_catalog(INSTALL_DIR / "capabilities.yml")
        self.profile_schema = install_model.load_schema(INSTALL_DIR / "profile.schema.json")
        self.state_schema = install_model.load_schema(INSTALL_DIR / "state.schema.json")
        self.status_schema = install_model.load_schema(INSTALL_DIR / "status.schema.json")

    def test_profile_schema_validation(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "productVersion": "dev",
            "mode": "production",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": True,
                "connections": True,
                "ip_geolocation": True,
                "databases": True,
                "recordings": True,
                "zero_trust": False,
                "agentic_ai": True,
                "enterprise_auth": True,
                "sharing_approvals": True,
                "cli": True,
            },
            "routing": {
                "directGateway": True,
                "zeroTrust": False,
            },
        }
        install_model.validate(profile, self.profile_schema, schema_root=INSTALL_DIR)

    def test_resolve_dev_respects_selected_capabilities_and_routing(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "development",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": False,
                "multi_tenancy": False,
                "connections": False,
                "ip_geolocation": False,
                "databases": False,
                "recordings": False,
                "zero_trust": False,
                "agentic_ai": False,
                "enterprise_auth": False,
                "sharing_approvals": False,
                "cli": True,
            },
            "routing": {"directGateway": False, "zeroTrust": False},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)
        self.assertEqual(
            {name for name, enabled in resolved["capabilities"].items() if enabled},
            {"core", "keychain", "cli"},
        )
        self.assertEqual(
            resolved["services"],
            ["authz-pdp", "client", "control-plane-api", "migrate", "postgres", "redis"],
        )
        self.assertEqual(resolved["environment"]["FEATURE_IP_GEOLOCATION_ENABLED"], "false")
        self.assertEqual(resolved["environment"]["FEATURE_KEYCHAIN_ENABLED"], "true")
        self.assertEqual(resolved["environment"]["FEATURE_MULTI_TENANCY_ENABLED"], "false")
        self.assertFalse(resolved["routing"]["zeroTrust"])
        self.assertFalse(resolved["routing"]["directGateway"])
        self.assertFalse(resolved["devFullStack"])

    def test_resolve_dev_includes_demo_services_for_enabled_capabilities(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "development",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": True,
                "connections": True,
                "ip_geolocation": True,
                "databases": True,
                "recordings": True,
                "zero_trust": False,
                "agentic_ai": True,
                "enterprise_auth": True,
                "sharing_approvals": True,
                "cli": True,
            },
            "routing": {"directGateway": True, "zeroTrust": False},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)

        self.assertIn("shared-files-s3", resolved["services"])
        self.assertIn("terminal-target", resolved["services"])
        self.assertIn("dev-debian-ssh-target", resolved["services"])
        self.assertIn("dev-demo-postgres", resolved["services"])
        self.assertIn("dev-demo-mysql", resolved["services"])
        self.assertIn("dev-demo-mongodb", resolved["services"])
        self.assertIn("dev-demo-oracle", resolved["services"])
        self.assertIn("dev-demo-mssql", resolved["services"])
        self.assertNotIn("dev-tunnel-ssh-gateway", resolved["services"])
        self.assertNotIn("dev-tunnel-guacd", resolved["services"])
        self.assertNotIn("dev-tunnel-db-proxy", resolved["services"])

    def test_resolve_dev_includes_zero_trust_fixtures_when_enabled(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "development",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": True,
                "connections": True,
                "ip_geolocation": True,
                "databases": True,
                "recordings": True,
                "zero_trust": False,
                "agentic_ai": True,
                "enterprise_auth": True,
                "sharing_approvals": True,
                "cli": True,
            },
            "routing": {"directGateway": True, "zeroTrust": True},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)

        self.assertTrue(resolved["capabilities"]["zero_trust"])
        self.assertIn("dev-tunnel-ssh-gateway", resolved["services"])
        self.assertIn("dev-tunnel-guacd", resolved["services"])
        self.assertIn("dev-tunnel-db-proxy", resolved["services"])

    def test_core_always_resolves_keychain(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "production",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": False,
                "multi_tenancy": False,
                "connections": False,
                "ip_geolocation": False,
                "databases": False,
                "recordings": False,
                "zero_trust": False,
                "agentic_ai": False,
                "enterprise_auth": False,
                "sharing_approvals": False,
                "cli": False,
            },
            "routing": {"directGateway": True, "zeroTrust": False},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)
        self.assertTrue(resolved["capabilities"]["keychain"])
        self.assertEqual(resolved["environment"]["FEATURE_KEYCHAIN_ENABLED"], "true")

    def test_capability_dependency_resolution(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "production",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "recordings": True,
                "multi_tenancy": True,
                "connections": False,
                "ip_geolocation": False,
                "databases": False,
                "zero_trust": False,
                "agentic_ai": False,
                "enterprise_auth": False,
                "sharing_approvals": False,
                "cli": False,
                "keychain": False,
            },
            "routing": {"directGateway": True, "zeroTrust": False},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)
        self.assertTrue(resolved["capabilities"]["recordings"])
        self.assertTrue(resolved["capabilities"]["connections"])

    def test_profile_schema_rejects_docker_backend(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "production",
            "backend": "docker",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": True,
                "connections": True,
                "ip_geolocation": True,
                "databases": False,
                "recordings": False,
                "zero_trust": False,
                "agentic_ai": False,
                "enterprise_auth": False,
                "sharing_approvals": False,
                "cli": True,
            },
            "routing": {
                "directGateway": True,
                "zeroTrust": False,
            },
        }
        with self.assertRaises(jsonschema.ValidationError):
            install_model.validate(profile, self.profile_schema, schema_root=INSTALL_DIR)

    def test_diff_classification(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "productVersion": "1.2.3",
            "mode": "production",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": True,
                "connections": True,
                "databases": False,
                "recordings": False,
                "zero_trust": False,
                "agentic_ai": False,
                "enterprise_auth": True,
                "sharing_approvals": True,
                "cli": True,
            },
            "routing": {"directGateway": True, "zeroTrust": False},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)
        state = {
            "schemaVersion": "1.0.0",
            "desiredProfile": profile,
            "desiredProfileHash": install_model.sha256_json(profile),
            "lastAppliedVersion": "1.2.3",
            "lastAppliedHashes": {},
            "resources": {},
            "lastKnownGoodRun": {"timestamp": install_model.now_utc(), "result": "success"},
            "backendState": {"backend": "podman"},
        }
        status = install_model.build_status(profile, resolved, {"runType": "no_op", "generatedAt": install_model.now_utc()}, result="success")
        install_model.validate(state, self.state_schema, schema_root=INSTALL_DIR)
        install_model.validate(status, self.status_schema, schema_root=INSTALL_DIR)
        diff = install_model.classify_run(profile, resolved, state, status)
        self.assertEqual(diff["runType"], "no_op")

    def test_failed_status_without_state_classifies_as_recovery(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "productVersion": "1.2.3",
            "mode": "production",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": True,
                "connections": True,
                "ip_geolocation": True,
                "databases": True,
                "recordings": True,
                "zero_trust": False,
                "agentic_ai": True,
                "enterprise_auth": True,
                "sharing_approvals": True,
                "cli": True,
            },
            "routing": {"directGateway": True, "zeroTrust": False},
        }
        resolved = install_model.resolve_profile(profile, self.catalog)
        status = install_model.build_status(
            profile,
            resolved,
            {"runType": "fresh_install", "generatedAt": install_model.now_utc()},
            result="failure",
        )
        diff = install_model.classify_run(profile, resolved, None, status)
        self.assertEqual(diff["runType"], "recovery")

    def test_cli_scripts_round_trip(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "production",
            "backend": "kubernetes",
            "capabilities": {"core": True},
            "routing": {"directGateway": False, "zeroTrust": True},
            "kubernetes": {"namespace": "arsenale-k8s"},
        }
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "profile.yml"
            output_path = Path(tmp) / "resolved.json"
            profile_path.write_text(yaml.safe_dump(profile), encoding="utf-8")
            rc = install_model.main(
                [
                    "resolve",
                    "--catalog",
                    str(INSTALL_DIR / "capabilities.yml"),
                    "--profile",
                    str(profile_path),
                    "--output",
                    str(output_path),
                ]
            )
            self.assertEqual(rc, 0)
            resolved = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(resolved["backend"], "kubernetes")
            self.assertEqual(
                resolved["environment"]["API_UPSTREAM_HOST"],
                "control-plane-api.arsenale-k8s.svc.cluster.local",
            )
            self.assertEqual(
                resolved["environment"]["MAP_ASSETS_UPSTREAM_HOST"],
                "map-assets.arsenale-k8s.svc.cluster.local",
            )

    def test_resolve_dev_refresh_targets_expands_aliases_and_migrations(self) -> None:
        resolved = install_model.resolve_dev_refresh_targets(
            ["control-plane", "client"],
            [
                "client",
                "control-plane-api",
                "query-runner",
                "map-assets",
                "migrate",
                "postgres",
            ],
        )

        self.assertEqual(
            resolved["buildServices"],
            ["control-plane-api", "query-runner", "map-assets", "client", "migrate"],
        )
        self.assertEqual(
            resolved["restartServices"],
            ["control-plane-api", "query-runner", "map-assets", "client"],
        )
        self.assertTrue(resolved["runMigrations"])

    def test_resolve_dev_refresh_targets_rejects_unknown_target(self) -> None:
        with self.assertRaisesRegex(ValueError, "unknown dev refresh target"):
            install_model.resolve_dev_refresh_targets(["not-a-service"], ["client", "migrate"])

    def test_resolve_dev_refresh_targets_rejects_empty_alias_resolution(self) -> None:
        with self.assertRaisesRegex(ValueError, "not active in the current installer profile"):
            install_model.resolve_dev_refresh_targets(["gateways"], ["client", "migrate"])

    def test_cli_resolve_dev_refresh_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            output_path = Path(tmp) / "dev-refresh.json"
            rc = install_model.main(
                [
                    "resolve-dev-refresh",
                    "--targets",
                    "client,control-plane",
                    "--active-services",
                    "client,control-plane-api,query-runner,migrate",
                    "--output",
                    str(output_path),
                ]
            )
            self.assertEqual(rc, 0)
            resolved = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(resolved["restartServices"], ["client", "control-plane-api", "query-runner"])
            self.assertEqual(resolved["buildServices"], ["client", "control-plane-api", "query-runner", "migrate"])
            self.assertTrue(resolved["runMigrations"])

    def test_ip_geolocation_capability_adds_map_assets_service(self) -> None:
        profile = {
            "schemaVersion": "1.0.0",
            "mode": "production",
            "backend": "podman",
            "capabilities": {
                "core": True,
                "keychain": True,
                "multi_tenancy": False,
                "connections": False,
                "ip_geolocation": True,
                "databases": False,
                "recordings": False,
                "zero_trust": False,
                "agentic_ai": False,
                "enterprise_auth": False,
                "sharing_approvals": False,
                "cli": False,
            },
            "routing": {"directGateway": False, "zeroTrust": False},
        }

        resolved = install_model.resolve_profile(profile, self.catalog)

        self.assertTrue(resolved["capabilities"]["ip_geolocation"])
        self.assertIn("map-assets", resolved["services"])
        self.assertEqual(resolved["environment"]["FEATURE_IP_GEOLOCATION_ENABLED"], "true")

    def test_prune_compose_removes_disabled_services_and_unused_top_level_objects(self) -> None:
        compose = {
            "services": {
                "postgres": {
                    "image": "postgres",
                    "volumes": ["pgdata:/var/lib/postgresql/data"],
                    "networks": ["db"],
                },
                "guacd": {
                    "image": "guacd",
                    "volumes": ["recordings:/recordings"],
                    "networks": ["guacd"],
                },
            },
            "volumes": {
                "pgdata": {},
                "recordings": {},
            },
            "networks": {
                "db": {},
                "guacd": {},
            },
        }
        pruned = install_model.prune_compose(compose, {"postgres"})
        self.assertEqual(set(pruned["services"].keys()), {"postgres"})
        self.assertEqual(set(pruned["volumes"].keys()), {"pgdata"})
        self.assertEqual(set(pruned["networks"].keys()), {"db"})

    def test_prune_compose_removes_disabled_depends_on_entries(self) -> None:
        compose = {
            "services": {
                "client": {
                    "depends_on": {
                        "control-plane-api": {"condition": "service_healthy"},
                        "desktop-broker": {"condition": "service_healthy"},
                        "terminal-broker": {"condition": "service_healthy"},
                    },
                    "networks": ["net-edge"],
                },
                "control-plane-api": {
                    "networks": ["net-edge"],
                },
            },
            "networks": {
                "net-edge": {},
                "net-db": {},
            },
        }

        pruned = install_model.prune_compose(compose, {"client", "control-plane-api"})

        self.assertEqual(
            pruned["services"]["client"]["depends_on"],
            {"control-plane-api": {"condition": "service_healthy"}},
        )
        self.assertEqual(set(pruned["networks"].keys()), {"net-edge"})

    def test_compose_to_k8s_generates_expected_manifests(self) -> None:
        compose = {
            "services": {
                "postgres": {
                    "image": "postgres:16",
                    "environment": {"POSTGRES_DB": "arsenale"},
                    "volumes": ["pgdata:/var/lib/postgresql/data"],
                    "healthcheck": {"test": ["CMD-SHELL", "pg_isready"], "interval": "10s", "timeout": "5s", "retries": 3},
                },
                "client": {
                    "image": "arsenale_client",
                    "ports": ["3000:8080"],
                    "environment": {"PORT": "8080"},
                },
                "migrate": {
                    "image": "arsenale_migrate",
                    "depends_on": ["postgres"],
                    "environment": {"DATABASE_URL_FILE": "/run/secrets/database_url"},
                    "secrets": ["database_url"],
                },
            },
            "secrets": {"database_url": {"external": True}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            compose_path = tmp_path / "compose.yaml"
            output_path = tmp_path / "manifests.yaml"
            metadata_path = tmp_path / "metadata.json"
            secrets_path = tmp_path / "secrets.json"
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")
            secrets_path.write_text(json.dumps({"database_url": "postgres://example"}), encoding="utf-8")
            compose_to_k8s.convert(
                compose_file=compose_path,
                output_file=output_path,
                metadata_file=metadata_path,
                namespace="arsenale-test",
                ingress_host="arsenale.test",
                ingress_class="nginx",
                tls_enabled=False,
                secret_file=secrets_path,
                env_file=None,
                local_image_prefix="",
            )
            manifests = list(yaml.safe_load_all(output_path.read_text(encoding="utf-8")))
            kinds = {(doc["kind"], doc["metadata"]["name"]) for doc in manifests}
            self.assertIn(("Secret", "arsenale-runtime-secrets"), kinds)
            self.assertIn(("Deployment", "postgres"), kinds)
            self.assertIn(("Deployment", "client"), kinds)
            self.assertIn(("Service", "client"), kinds)
            self.assertIn(("PersistentVolumeClaim", "pgdata"), kinds)
            self.assertIn(("Job", "migrate"), kinds)
            kind_order = [(doc["kind"], doc["metadata"]["name"]) for doc in manifests]
            self.assertLess(kind_order.index(("PersistentVolumeClaim", "pgdata")), kind_order.index(("Deployment", "postgres")))
            self.assertLess(kind_order.index(("Service", "postgres")), kind_order.index(("Job", "migrate")))
            migrate_job = next(doc for doc in manifests if doc["kind"] == "Job" and doc["metadata"]["name"] == "migrate")
            runtime_secret_volume = next(item["secret"] for item in migrate_job["spec"]["template"]["spec"]["volumes"] if item["name"] == "runtime-secrets")
            self.assertEqual(runtime_secret_volume["defaultMode"], 0o444)
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertIn("arsenale_client", metadata["images"])
            self.assertIn("client", metadata["deployments"])

    def test_compose_to_k8s_resolves_env_file_and_local_podman_images(self) -> None:
        compose = {
            "services": {
                "control-plane-api": {
                    "build": {"context": ".", "dockerfile": "backend/Dockerfile"},
                    "environment": {
                        "FEATURE_CONNECTIONS_ENABLED": "${FEATURE_CONNECTIONS_ENABLED:-true}",
                        "CLI_ENABLED": "${CLI_ENABLED:-true}",
                    },
                    "secrets": ["database_url"],
                }
            },
            "secrets": {"database_url": {"external": True}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            compose_path = tmp_path / "compose.yaml"
            output_path = tmp_path / "manifests.yaml"
            metadata_path = tmp_path / "metadata.json"
            secrets_path = tmp_path / "secrets.json"
            env_path = tmp_path / "runtime.env"
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")
            secrets_path.write_text(json.dumps({"database_url": "postgres://example"}), encoding="utf-8")
            env_path.write_text("FEATURE_CONNECTIONS_ENABLED=false\nCLI_ENABLED=true\n", encoding="utf-8")

            compose_to_k8s.convert(
                compose_file=compose_path,
                output_file=output_path,
                metadata_file=metadata_path,
                namespace="arsenale-test",
                ingress_host=None,
                ingress_class=None,
                tls_enabled=False,
                secret_file=secrets_path,
                env_file=env_path,
                local_image_prefix="localhost/",
            )

            manifests = list(yaml.safe_load_all(output_path.read_text(encoding="utf-8")))
            deployment = next(doc for doc in manifests if doc["kind"] == "Deployment" and doc["metadata"]["name"] == "control-plane-api")
            container = deployment["spec"]["template"]["spec"]["containers"][0]
            env = {entry["name"]: entry["value"] for entry in container["env"]}
            self.assertEqual(container["image"], "localhost/arsenale_control-plane-api:latest")
            self.assertEqual(env["FEATURE_CONNECTIONS_ENABLED"], "false")
            self.assertEqual(env["CLI_ENABLED"], "true")
            self.assertFalse(deployment["spec"]["template"]["spec"]["automountServiceAccountToken"])

            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            self.assertIn("localhost/arsenale_control-plane-api:latest", metadata["images"])

    def test_compose_to_k8s_writes_autonomous_helm_values(self) -> None:
        compose = {
            "services": {
                "postgres": {
                    "image": "postgres:16",
                    "volumes": ["pgdata:/var/lib/postgresql/data"],
                },
                "client": {
                    "image": "arsenale_client",
                    "ports": ["3000:8080"],
                    "environment": {"PORT": "8080"},
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            compose_path = tmp_path / "compose.yaml"
            output_path = tmp_path / "manifests.yaml"
            values_path = tmp_path / "values.generated.yaml"
            metadata_path = tmp_path / "metadata.json"
            kube_options_path = tmp_path / "kube-options.yaml"
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")
            kube_options_path.write_text(
                yaml.safe_dump(
                    {
                        "replicas": 2,
                        "storageClass": "fast",
                        "imagePullSecrets": ["registry-creds"],
                        "nodeSelector": {"kubernetes.io/os": "linux"},
                        "tolerations": [{"key": "dedicated", "operator": "Exists"}],
                        "resources": {"limits": {"cpu": "500m"}},
                    }
                ),
                encoding="utf-8",
            )

            compose_to_k8s.convert(
                compose_file=compose_path,
                output_file=output_path,
                values_output_file=values_path,
                metadata_file=metadata_path,
                namespace="arsenale-test",
                ingress_host="arsenale.test",
                ingress_class="nginx",
                tls_enabled=False,
                secret_file=None,
                env_file=None,
                local_image_prefix="localhost/",
                kubernetes_config=yaml.safe_load(kube_options_path.read_text(encoding="utf-8")),
            )

            values = yaml.safe_load(values_path.read_text(encoding="utf-8"))
            self.assertEqual(values["namespace"], "arsenale-test")
            self.assertEqual(values["ingress"]["host"], "arsenale.test")
            self.assertEqual(values["kubernetes"]["replicas"], 2)
            self.assertEqual(values["kubernetes"]["storageClass"], "fast")
            self.assertEqual(values["kubernetes"]["imagePullSecrets"], ["registry-creds"])
            resources = values["rendered"]["resources"]
            self.assertTrue(resources)
            client_deployment = next(
                item for item in resources if item["kind"] == "Deployment" and item["metadata"]["name"] == "client"
            )
            self.assertEqual(client_deployment["spec"]["replicas"], 2)
            self.assertEqual(
                client_deployment["spec"]["template"]["spec"]["imagePullSecrets"],
                [{"name": "registry-creds"}],
            )
            postgres_pvc = next(
                item for item in resources if item["kind"] == "PersistentVolumeClaim" and item["metadata"]["name"] == "pgdata"
            )
            self.assertEqual(postgres_pvc["spec"]["storageClassName"], "fast")

            if shutil.which("helm"):
                rendered = subprocess.run(
                    [
                        "helm",
                        "template",
                        "arsenale-test",
                        str(ROOT / "deployment" / "helm" / "arsenale"),
                        "-f",
                        str(values_path),
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )
                self.assertIn("kind: Deployment", rendered.stdout)
                self.assertIn("name: client", rendered.stdout)
                self.assertIn("kind: Ingress", rendered.stdout)

    def test_compose_to_k8s_marks_executable_file_mounts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            script_path = tmp_path / "entrypoint.sh"
            compose_path = tmp_path / "compose.yaml"
            output_path = tmp_path / "manifests.yaml"

            script_path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            script_path.chmod(0o755)
            compose = {
                "services": {
                    "postgres": {
                        "image": "postgres:16",
                        "volumes": [f"{script_path}:/usr/local/bin/arsenale-postgres-entrypoint.sh:ro"],
                    }
                }
            }
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")

            compose_to_k8s.convert(
                compose_file=compose_path,
                output_file=output_path,
                metadata_file=None,
                namespace="arsenale-test",
                ingress_host=None,
                ingress_class=None,
                tls_enabled=False,
                secret_file=None,
                env_file=None,
                local_image_prefix="",
            )

            manifests = list(yaml.safe_load_all(output_path.read_text(encoding="utf-8")))
            deployment = next(doc for doc in manifests if doc["kind"] == "Deployment" and doc["metadata"]["name"] == "postgres")
            volumes = deployment["spec"]["template"]["spec"]["volumes"]
            config_map_volume = next(item["configMap"] for item in volumes if "configMap" in item)
            self.assertEqual(config_map_volume["defaultMode"], 0o555)

    def test_compose_to_k8s_preserves_numeric_user_as_security_context(self) -> None:
        compose = {
            "services": {
                "control-plane-api": {
                    "image": "arsenale_control-plane-api",
                    "user": "0:0",
                }
            }
        }
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            compose_path = tmp_path / "compose.yaml"
            output_path = tmp_path / "manifests.yaml"
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")

            compose_to_k8s.convert(
                compose_file=compose_path,
                output_file=output_path,
                metadata_file=None,
                namespace="arsenale-test",
                ingress_host=None,
                ingress_class=None,
                tls_enabled=False,
                secret_file=None,
                env_file=None,
                local_image_prefix="",
            )

            manifests = list(yaml.safe_load_all(output_path.read_text(encoding="utf-8")))
            deployment = next(doc for doc in manifests if doc["kind"] == "Deployment" and doc["metadata"]["name"] == "control-plane-api")
            container = deployment["spec"]["template"]["spec"]["containers"][0]
            self.assertEqual(container["securityContext"]["runAsUser"], 0)
            self.assertEqual(container["securityContext"]["runAsGroup"], 0)


class RunComposeServiceTest(unittest.TestCase):
    def test_build_podman_create_command_for_migrate_service(self) -> None:
        compose = {
            "services": {
                "migrate": {
                    "container_name": "arsenale-migrate",
                    "entrypoint": ["/usr/local/bin/migrate"],
                    "command": ["up"],
                    "read_only": True,
                    "tmpfs": ["/tmp"],
                    "cap_drop": ["ALL"],
                    "security_opt": ["no-new-privileges:true"],
                    "environment": {
                        "DATABASE_URL_FILE": "/run/secrets/database_url",
                        "DATABASE_SSL_ROOT_CERT": "/certs/postgres/ca.pem",
                    },
                    "secrets": ["database_url"],
                    "volumes": ["/work/dev-certs/postgres:/certs/postgres:ro"],
                    "networks": ["net-db"],
                }
            }
        }
        with tempfile.TemporaryDirectory() as tmp:
            compose_path = Path(tmp) / "docker-compose.yml"
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")
            service = compose["services"]["migrate"]
            command, extra_networks, container_name = run_compose_service.build_podman_create_command(
                runtime="podman",
                compose_file=compose_path,
                service_name="migrate",
                service=service,
                command_args=["up"],
                project_name="arsenale",
            )
            self.assertEqual(container_name, "arsenale-migrate")
            self.assertEqual(extra_networks, [])
            self.assertIn("--read-only", command)
            self.assertIn("--secret", command)
            self.assertIn("database_url", command)
            self.assertIn("--network", command)
            self.assertTrue(any(item.endswith("-net-db") for item in command))
            self.assertIn("localhost", "".join(command))
            self.assertEqual(command[-1], "up")

    def test_build_podman_create_command_honors_explicit_network_names(self) -> None:
        compose = {
            "services": {
                "migrate": {
                    "container_name": "arsenale-migrate",
                    "image": "localhost/arsenale_migrate:latest",
                    "networks": ["net-db"],
                }
            },
            "networks": {
                "net-db": {
                    "name": "arsenale-net-db",
                }
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            compose_path = Path(tmp) / "docker-compose.yml"
            compose_path.write_text(yaml.safe_dump(compose), encoding="utf-8")
            service = compose["services"]["migrate"]
            command, _, _ = run_compose_service.build_podman_create_command(
                runtime="podman",
                compose_file=compose_path,
                service_name="migrate",
                service=service,
                command_args=["up"],
                project_name="arsenale",
            )
            network_index = command.index("--network") + 1
            self.assertEqual(command[network_index], "arsenale-net-db")


if __name__ == "__main__":
    unittest.main()
