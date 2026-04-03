-- name: ListConnections :many
SELECT id, name, kind, scope, endpoint, namespace, labels, capabilities
FROM orchestrator_connections
ORDER BY name ASC;

-- name: GetConnection :one
SELECT id, name, kind, scope, endpoint, namespace, labels, capabilities
FROM orchestrator_connections
WHERE name = sqlc.arg(name);

-- name: UpsertConnection :one
INSERT INTO orchestrator_connections (
  id,
  name,
  kind,
  scope,
  endpoint,
  namespace,
  labels,
  capabilities
) VALUES (
  sqlc.arg(id),
  sqlc.arg(name),
  sqlc.arg(kind),
  sqlc.arg(scope),
  sqlc.arg(endpoint),
  sqlc.arg(namespace),
  sqlc.arg(labels),
  sqlc.arg(capabilities)
)
ON CONFLICT (name) DO UPDATE SET
  kind = EXCLUDED.kind,
  scope = EXCLUDED.scope,
  endpoint = EXCLUDED.endpoint,
  namespace = EXCLUDED.namespace,
  labels = EXCLUDED.labels,
  capabilities = EXCLUDED.capabilities,
  updated_at = now()
RETURNING id, name, kind, scope, endpoint, namespace, labels, capabilities;
