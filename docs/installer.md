# Installer Guide

Arsenale ships with an installer-first deployment flow driven by Ansible. The installer is CLI-only, interactive, idempotent, password-gated, and backend-aware.

## Entry Points

Preferred entrypoints from the repository root:

```bash
make install
make configure
make deploy
make recover
make status
make dev
```

Underlying playbooks:

- `deployment/ansible/playbooks/install.yml`
- `deployment/ansible/playbooks/status.yml`

## Modes

Development mode:

- Always deploys the full stack
- Enables the full capability set
- Includes demo targets, demo datasets, and deeper validation

Production mode:

- Deploys only the selected capabilities
- Uses the same profile model for Podman and Kubernetes

## Backends

Supported backends:

- Podman compose
- Kubernetes via Helm

Docker is not a supported installer backend.

The installer resolves one desired profile, then renders either compose artifacts or Helm manifests from that same model.

## Capabilities

Capability selection is installer-owned and defined under `deployment/ansible/install/capabilities.yml`.

Initial capabilities:

- `core`
- `keychain`
- `connections`
- `databases`
- `recordings`
- `zero_trust`
- `agentic_ai`
- `enterprise_auth`
- `sharing_approvals`
- `cli`

Disabled capabilities remove their services, backend routes, and frontend affordances from the rendered runtime.

## Technician Password

The installer prompts for the technician password before it reads installer state.

Rules:

- The password is entered on fresh install.
- The password is required again on every rerun.
- The password is not stored on disk.
- Automation can supply it through a password file, environment variable, or stdin where supported.

## Encrypted Installer Artifacts

On a target host the canonical installer artifact directory is:

```text
/opt/arsenale/install/
```

Artifacts:

- `install-profile.enc`
- `install-state.enc`
- `install-status.enc`
- `install-log.enc`
- `rendered-artifacts.enc`

These artifacts contain the canonical desired profile, last applied state, last run result, and rendered output metadata. Generated runtime config is derived from them and is overwritten on rerun if drift is detected.

## Fresh Install Flow

1. Prompt for the technician password.
2. Read and decrypt any existing installer artifacts.
3. Ask only the questions relevant to the chosen mode and backend.
4. Resolve capabilities, routing, storage, and runtime choices into one desired profile.
5. Show the classified plan.
6. Render compose or Helm artifacts.
7. Apply the backend-specific delta.
8. Encrypt and persist profile, state, status, log, and render metadata.

## Rerun, Recovery, and Drift Repair

On rerun the installer:

1. Prompts for the technician password again.
2. Decrypts installer state and status.
3. Recomputes the desired profile and render metadata.
4. Classifies the run as `no_op`, `reconfigure`, `upgrade`, `recovery`, or `drift_reconcile`.
5. Applies only the required delta.

Manual edits to generated runtime files are treated as drift and are overwritten from encrypted canonical state.

Persistent data is not deleted implicitly during capability removal or recovery.

## Status Reads

External tooling can inspect install state without querying a running Arsenale instance.

From the repository root:

```bash
make status
```

Direct helper usage:

```bash
INSTALLER_PASSWORD=...
python3 deployment/ansible/scripts/install_status.py \
  --input /opt/arsenale/install/install-status.enc \
  --password-env INSTALLER_PASSWORD
```

The status artifact exposes:

- installer schema version
- product version
- mode
- backend
- enabled capabilities
- last action
- last result
- timestamps
- health summary
- drift summary

## Kubernetes Notes

Kubernetes installs render a values-driven Helm chart from the resolved installer profile. Ansible can install that chart directly, and the chart can also be installed standalone with `helm install ... -f values.yaml` when you provide a complete values file. The client proxy uses cluster-qualified service DNS names so browser-side `/api`, `/guacamole`, and `/ws/terminal` traffic resolves correctly inside the cluster.

## Recommended Operator Flow

1. Run `make setup` once per workspace.
2. Use `make dev` for the full local development environment.
3. Use `make install` or `make deploy` for production installs.
4. Use `make configure` for intentional production changes.
5. Use `make status` for password-gated encrypted status reads.
6. Use `make recover` after interrupted or failed runs.
