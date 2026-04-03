-- name: UpsertNamespace :one
INSERT INTO memory_namespaces (
  id,
  namespace_key,
  tenant_id,
  scope,
  principal_id,
  agent_id,
  run_id,
  workflow_id,
  memory_type,
  name
) VALUES (
  sqlc.arg(id),
  sqlc.arg(namespace_key),
  sqlc.arg(tenant_id),
  sqlc.arg(scope),
  sqlc.arg(principal_id),
  sqlc.arg(agent_id),
  sqlc.arg(run_id),
  sqlc.arg(workflow_id),
  sqlc.arg(memory_type),
  sqlc.arg(name)
)
ON CONFLICT (namespace_key) DO UPDATE SET
  updated_at = now()
RETURNING id, namespace_key, tenant_id, scope, principal_id, agent_id, run_id, workflow_id, memory_type, name, created_at, updated_at;

-- name: ListNamespaces :many
SELECT id, namespace_key, tenant_id, scope, principal_id, agent_id, run_id, workflow_id, memory_type, name, created_at, updated_at
FROM memory_namespaces
WHERE tenant_id = sqlc.arg(tenant_id)
ORDER BY scope ASC, memory_type ASC, name ASC;

-- name: CreateItem :one
INSERT INTO memory_items (
  id,
  namespace_key,
  content,
  summary,
  metadata
) VALUES (
  sqlc.arg(id),
  sqlc.arg(namespace_key),
  sqlc.arg(content),
  sqlc.arg(summary),
  sqlc.arg(metadata)
)
RETURNING id, namespace_key, content, summary, metadata, created_at;

-- name: ListItems :many
SELECT id, namespace_key, content, summary, metadata, created_at
FROM memory_items
WHERE namespace_key = sqlc.arg(namespace_key)
ORDER BY created_at ASC;
