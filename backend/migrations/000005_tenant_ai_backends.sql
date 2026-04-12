CREATE TABLE IF NOT EXISTS public."TenantAiBackend" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    "encryptedApiKey" text,
    "apiKeyIV" text,
    "apiKeyTag" text,
    "baseUrl" text,
    "defaultModel" text,
    "createdAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    CONSTRAINT "TenantAiBackend_pkey" PRIMARY KEY (id),
    CONSTRAINT "TenantAiBackend_tenantId_name_key" UNIQUE ("tenantId", name),
    CONSTRAINT "TenantAiBackend_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "TenantAiBackend_tenantId_idx"
    ON public."TenantAiBackend" USING btree ("tenantId");

ALTER TABLE public."TenantAiConfig"
    ADD COLUMN IF NOT EXISTS "queryGenerationBackend" text,
    ADD COLUMN IF NOT EXISTS "queryGenerationModel" text,
    ADD COLUMN IF NOT EXISTS "queryOptimizerEnabled" boolean DEFAULT false NOT NULL,
    ADD COLUMN IF NOT EXISTS "queryOptimizerBackend" text,
    ADD COLUMN IF NOT EXISTS "queryOptimizerModel" text,
    ADD COLUMN IF NOT EXISTS temperature double precision DEFAULT 0.2 NOT NULL,
    ADD COLUMN IF NOT EXISTS "timeoutMs" integer DEFAULT 60000 NOT NULL;
