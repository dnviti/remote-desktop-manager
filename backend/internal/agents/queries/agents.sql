-- name: CreateRun :one
INSERT INTO agent_runs (
  id,
  tenant_id,
  definition_id,
  trigger,
  goals,
  requested_capabilities,
  status,
  requires_approval
) VALUES (
  sqlc.arg(id),
  sqlc.arg(tenant_id),
  sqlc.arg(definition_id),
  sqlc.arg(trigger),
  sqlc.arg(goals),
  sqlc.arg(requested_capabilities),
  sqlc.arg(status),
  sqlc.arg(requires_approval)
)
RETURNING id, tenant_id, definition_id, trigger, goals, requested_capabilities, status, requires_approval, requested_at, last_transition_at;

-- name: GetRun :one
SELECT id, tenant_id, definition_id, trigger, goals, requested_capabilities, status, requires_approval, requested_at, last_transition_at
FROM agent_runs
WHERE id = sqlc.arg(id);

-- name: ListRuns :many
SELECT id, tenant_id, definition_id, trigger, goals, requested_capabilities, status, requires_approval, requested_at, last_transition_at
FROM agent_runs
WHERE tenant_id = sqlc.arg(tenant_id)
ORDER BY requested_at DESC;
