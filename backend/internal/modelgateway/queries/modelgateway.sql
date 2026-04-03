-- name: GetConfig :one
SELECT "tenantId", provider, COALESCE("encryptedApiKey", '') AS encrypted_api_key, "modelId", COALESCE("baseUrl", '') AS base_url, "maxTokensPerRequest", "dailyRequestLimit", enabled
FROM "TenantAiConfig"
WHERE "tenantId" = sqlc.arg(tenant_id);

-- name: UpsertConfigPreserveKey :one
INSERT INTO "TenantAiConfig" (
  id,
  "tenantId",
  provider,
  "modelId",
  "baseUrl",
  "maxTokensPerRequest",
  "dailyRequestLimit",
  enabled,
  "createdAt",
  "updatedAt"
) VALUES (
  sqlc.arg(id),
  sqlc.arg(tenant_id),
  sqlc.arg(provider),
  sqlc.arg(model_id),
  NULLIF(sqlc.arg(base_url), ''),
  sqlc.arg(max_tokens_per_request),
  sqlc.arg(daily_request_limit),
  sqlc.arg(enabled),
  now(),
  now()
)
ON CONFLICT ("tenantId") DO UPDATE SET
  provider = EXCLUDED.provider,
  "modelId" = EXCLUDED."modelId",
  "baseUrl" = EXCLUDED."baseUrl",
  "maxTokensPerRequest" = EXCLUDED."maxTokensPerRequest",
  "dailyRequestLimit" = EXCLUDED."dailyRequestLimit",
  enabled = EXCLUDED.enabled,
  "updatedAt" = now()
RETURNING "tenantId", provider, COALESCE("encryptedApiKey", '') AS encrypted_api_key, "modelId", COALESCE("baseUrl", '') AS base_url, "maxTokensPerRequest", "dailyRequestLimit", enabled;

-- name: UpsertConfig :one
INSERT INTO "TenantAiConfig" (
  id,
  "tenantId",
  provider,
  "encryptedApiKey",
  "apiKeyIV",
  "apiKeyTag",
  "modelId",
  "baseUrl",
  "maxTokensPerRequest",
  "dailyRequestLimit",
  enabled,
  "createdAt",
  "updatedAt"
) VALUES (
  sqlc.arg(id),
  sqlc.arg(tenant_id),
  sqlc.arg(provider),
  NULLIF(sqlc.arg(encrypted_api_key), ''),
  NULLIF(sqlc.arg(api_key_iv), ''),
  NULLIF(sqlc.arg(api_key_tag), ''),
  sqlc.arg(model_id),
  NULLIF(sqlc.arg(base_url), ''),
  sqlc.arg(max_tokens_per_request),
  sqlc.arg(daily_request_limit),
  sqlc.arg(enabled),
  now(),
  now()
)
ON CONFLICT ("tenantId") DO UPDATE SET
  provider = EXCLUDED.provider,
  "encryptedApiKey" = EXCLUDED."encryptedApiKey",
  "apiKeyIV" = EXCLUDED."apiKeyIV",
  "apiKeyTag" = EXCLUDED."apiKeyTag",
  "modelId" = EXCLUDED."modelId",
  "baseUrl" = EXCLUDED."baseUrl",
  "maxTokensPerRequest" = EXCLUDED."maxTokensPerRequest",
  "dailyRequestLimit" = EXCLUDED."dailyRequestLimit",
  enabled = EXCLUDED.enabled,
  "updatedAt" = now()
RETURNING "tenantId", provider, COALESCE("encryptedApiKey", '') AS encrypted_api_key, "modelId", COALESCE("baseUrl", '') AS base_url, "maxTokensPerRequest", "dailyRequestLimit", enabled;
