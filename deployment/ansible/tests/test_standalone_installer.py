from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml
from jinja2 import Environment, FileSystemLoader


ROOT = Path(__file__).resolve().parents[3]
COMPOSE_TEMPLATE = ROOT / "deployment" / "ansible" / "roles" / "deploy" / "templates" / "compose.yml.j2"
INSTALL_PLAYBOOK = ROOT / "deployment" / "ansible" / "playbooks" / "install.yml"
DEPLOY_PLAYBOOK = ROOT / "deployment" / "ansible" / "playbooks" / "deploy.yml"
DOCKER_BUILD_WORKFLOW = ROOT / ".github" / "workflows" / "docker-build.yml"
GATEWAYS_BUILD_WORKFLOW = ROOT / ".github" / "workflows" / "gateways-build.yml"


def _bool_filter(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _regex_replace(value: object, pattern: str, replacement: str = "") -> str:
    return re.sub(pattern, replacement, str(value))


def _basename(value: object) -> str:
    return Path(str(value)).name


def _render_compose(**overrides: object) -> dict[str, object]:
    env = Environment(
        loader=FileSystemLoader(str(COMPOSE_TEMPLATE.parent)),
        keep_trailing_newline=True,
        trim_blocks=False,
        lstrip_blocks=False,
    )
    env.filters["bool"] = _bool_filter
    env.filters["regex_replace"] = _regex_replace
    env.filters["basename"] = _basename

    component_images = {
        "migrate": "ghcr.io/dnviti/arsenale/control-plane-api:latest",
        "control-plane-api": "ghcr.io/dnviti/arsenale/control-plane-api:latest",
        "control-plane-controller": "ghcr.io/dnviti/arsenale/control-plane-controller:latest",
        "authz-pdp": "ghcr.io/dnviti/arsenale/authz-pdp:latest",
        "model-gateway": "ghcr.io/dnviti/arsenale/model-gateway:latest",
        "tool-gateway": "ghcr.io/dnviti/arsenale/tool-gateway:latest",
        "terminal-broker": "ghcr.io/dnviti/arsenale/terminal-broker:latest",
        "desktop-broker": "ghcr.io/dnviti/arsenale/desktop-broker:latest",
        "tunnel-broker": "ghcr.io/dnviti/arsenale/tunnel-broker-go:latest",
        "query-runner": "ghcr.io/dnviti/arsenale/query-runner:latest",
        "memory-service": "ghcr.io/dnviti/arsenale/memory-service:latest",
        "agent-orchestrator": "ghcr.io/dnviti/arsenale/agent-orchestrator:latest",
        "runtime-agent": "ghcr.io/dnviti/arsenale/runtime-agent:latest",
        "client": "ghcr.io/dnviti/arsenale/client:latest",
        "guacd": "ghcr.io/dnviti/arsenale/guacd:latest",
        "guacenc": "ghcr.io/dnviti/arsenale/guacenc:latest",
        "ssh-gateway": "ghcr.io/dnviti/arsenale/ssh-gateway:latest",
        "db-proxy": "ghcr.io/dnviti/arsenale/db-proxy:latest",
    }

    context: dict[str, object] = {
        "arsenale_env": "production",
        "_home": "/opt/arsenale",
        "_is_dev": False,
        "_build": False,
        "_client_bind_host": "0.0.0.0",
        "_public_url": "https://arsenale.example.com",
        "installer_runtime_assets_dir": "/opt/arsenale/config/installer-assets",
        "arsenale_registry": "ghcr.io/dnviti/arsenale",
        "arsenale_image_tag": "latest",
        "arsenale_postgres_image": "quay.io/sclorg/postgresql-16-c10s",
        "arsenale_postgres_data_dir": "/var/lib/pgsql/data",
        "arsenale_db_user": "arsenale",
        "arsenale_db_name": "arsenale",
        "arsenale_domain": "arsenale.example.com",
        "arsenale_cert_dir": "/opt/arsenale/certs",
        "arsenale_component_images": component_images,
        "arsenale_recording_enabled": True,
        "arsenale_service_bind_host": "0.0.0.0",
        "arsenale_client_port": 3000,
        "arsenale_ssh_port": 2222,
        "arsenale_control_plane_api_port": 18080,
        "arsenale_control_plane_controller_port": 18081,
        "arsenale_authz_pdp_port": 18082,
        "arsenale_model_gateway_port": 18083,
        "arsenale_tool_gateway_port": 18084,
        "arsenale_agent_orchestrator_port": 18085,
        "arsenale_memory_service_port": 18086,
        "arsenale_terminal_broker_port": 18090,
        "arsenale_desktop_broker_port": 18091,
        "arsenale_tunnel_broker_port": 18092,
        "arsenale_query_runner_port": 18093,
        "arsenale_runtime_agent_port": 18095,
        "arsenale_dev_bootstrap_admin_email": "admin@example.com",
        "arsenale_dev_bootstrap_admin_username": "admin",
        "arsenale_dev_bootstrap_admin_password": "DevAdmin123!",
        "arsenale_dev_bootstrap_tenant_name": "Development Environment",
        "arsenale_uid": "1000",
        "arsenale_container_dns_servers": [],
        "dev_sample_postgres_host": "dev-demo-postgres",
        "dev_sample_postgres_port": 5432,
        "dev_sample_postgres_database": "arsenale_demo",
        "dev_sample_postgres_user": "demo_pg_user",
        "dev_sample_postgres_password": "DemoPgPass123!",
        "dev_sample_postgres_ssl_mode": "disable",
        "dev_sample_mysql_host": "dev-demo-mysql",
        "dev_sample_mysql_port": 3306,
        "dev_sample_mysql_database": "arsenale_demo",
        "dev_sample_mysql_user": "demo_mysql_user",
        "dev_sample_mysql_password": "DemoMySqlPass123!",
        "dev_sample_mysql_root_password": "DemoMySqlRoot123!",
        "dev_sample_mongodb_host": "dev-demo-mongodb",
        "dev_sample_mongodb_port": 27017,
        "dev_sample_mongodb_database": "arsenale_demo",
        "dev_sample_mongodb_root_user": "demo_mongo_root",
        "dev_sample_mongodb_root_password": "DemoMongoRoot123!",
        "dev_sample_mongodb_user": "demo_mongo_user",
        "dev_sample_mongodb_password": "DemoMongoPass123!",
        "dev_sample_oracle_host": "dev-demo-oracle",
        "dev_sample_oracle_port": 1521,
        "dev_sample_oracle_service_name": "FREEPDB1",
        "dev_sample_oracle_user": "demo_oracle_user",
        "dev_sample_oracle_password": "DemoOraclePass123!",
        "dev_sample_oracle_system_password": "DemoOracleSys123!",
        "dev_sample_mssql_host": "dev-demo-mssql",
        "dev_sample_mssql_port": 1433,
        "dev_sample_mssql_database": "ArsenaleDemo",
        "dev_sample_mssql_user": "demo_mssql_user",
        "dev_sample_mssql_password": "DemoMssqlPass123!",
        "dev_sample_mssql_sa_password": "DemoMssqlSa123!",
        "arsenale_resource_limits": {
            "postgres": {"cpus": "1.0", "memory": "1g", "pids": 256},
            "guacd": {"cpus": "1.0", "memory": "512m", "pids": 256},
            "guacenc": {"cpus": "1.0", "memory": "768m", "pids": 256},
            "client": {"cpus": "0.75", "memory": "256m", "pids": 256},
            "go_service": {"cpus": "0.5", "memory": "512m", "pids": 128},
            "ssh_gateway": {"cpus": "0.5", "memory": "256m", "pids": 128},
            "db_proxy": {"cpus": "0.5", "memory": "256m", "pids": 128},
        },
    }
    context.update(overrides)

    rendered = env.get_template(COMPOSE_TEMPLATE.name).render(**context)
    return yaml.safe_load(rendered)


class StandaloneInstallerTemplateTest(unittest.TestCase):
    def test_production_compose_uses_registry_images_and_installer_assets(self) -> None:
        compose = _render_compose()
        services = compose["services"]

        self.assertEqual(services["control-plane-api"]["image"], "ghcr.io/dnviti/arsenale/control-plane-api:latest")
        self.assertEqual(services["tunnel-broker"]["image"], "ghcr.io/dnviti/arsenale/tunnel-broker-go:latest")
        self.assertEqual(services["client"]["image"], "ghcr.io/dnviti/arsenale/client:latest")
        self.assertNotIn("build", services["control-plane-api"])
        self.assertNotIn("build", services["migrate"])

        postgres_volumes = services["postgres"]["volumes"]
        self.assertIn(
            "/opt/arsenale/config/installer-assets/postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro",
            postgres_volumes,
        )
        self.assertIn(
            "/opt/arsenale/config/installer-assets/postgres/entrypoint.sh:/usr/local/bin/arsenale-postgres-entrypoint.sh:ro",
            postgres_volumes,
        )
        self.assertTrue(all("/opt/arsenale/arsenale/" not in entry for entry in postgres_volumes))

    def test_development_compose_keeps_local_builds(self) -> None:
        compose = _render_compose(
            arsenale_env="development",
            _home="/workspace/arsenale",
            _is_dev=True,
            _build=True,
            installer_runtime_assets_dir="/workspace/arsenale/config/installer-assets",
            arsenale_cert_dir="/workspace/arsenale/dev-certs",
        )
        services = compose["services"]

        self.assertEqual(services["control-plane-api"]["build"]["context"], "/workspace/arsenale")
        self.assertEqual(services["client"]["build"]["dockerfile"], "client/Dockerfile")
        self.assertEqual(
            services["postgres"]["volumes"][1],
            "/workspace/arsenale/config/installer-assets/postgres/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro",
        )


class StandaloneInstallerConfigTest(unittest.TestCase):
    def test_non_dev_playbooks_default_to_prebuilt_images(self) -> None:
        install_text = INSTALL_PLAYBOOK.read_text(encoding="utf-8")
        deploy_text = DEPLOY_PLAYBOOK.read_text(encoding="utf-8")

        self.assertIn('_build: "{{ arsenale_build_images | default(false) }}"', install_text)
        self.assertIn('_build: "{{ true if _is_dev | bool else (arsenale_build_images | default(false)) }}"', deploy_text)

    def test_ci_publishes_required_installer_images(self) -> None:
        docker_build = yaml.safe_load(DOCKER_BUILD_WORKFLOW.read_text(encoding="utf-8"))
        docker_services = {
            entry["name"]
            for entry in docker_build["jobs"]["build-and-scan"]["strategy"]["matrix"]["service"]
        }
        self.assertTrue(
            {
                "control-plane-api",
                "control-plane-controller",
                "authz-pdp",
                "model-gateway",
                "tool-gateway",
                "agent-orchestrator",
                "memory-service",
                "terminal-broker",
                "desktop-broker",
                "tunnel-broker-go",
                "query-runner",
                "runtime-agent",
                "client",
            }.issubset(docker_services)
        )

        gateways_build = yaml.safe_load(GATEWAYS_BUILD_WORKFLOW.read_text(encoding="utf-8"))
        gateway_services = {
            entry["name"]
            for entry in gateways_build["jobs"]["build-and-scan"]["strategy"]["matrix"]["gateway"]
        }
        self.assertTrue({"guacd", "guacenc", "ssh-gateway", "db-proxy"}.issubset(gateway_services))


if __name__ == "__main__":
    unittest.main()
