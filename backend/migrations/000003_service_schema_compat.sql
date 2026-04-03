CREATE TABLE IF NOT EXISTS public."TenantAiConfig" (
  id text NOT NULL,
  "tenantId" text NOT NULL,
  provider text DEFAULT 'none'::text NOT NULL,
  "encryptedApiKey" text,
  "apiKeyIV" text,
  "apiKeyTag" text,
  "modelId" text DEFAULT 'claude-sonnet-4-20250514'::text NOT NULL,
  "baseUrl" text,
  "maxTokensPerRequest" integer DEFAULT 4000 NOT NULL,
  "dailyRequestLimit" integer DEFAULT 100 NOT NULL,
  enabled boolean DEFAULT false NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  CONSTRAINT "TenantAiConfig_pkey" PRIMARY KEY (id),
  CONSTRAINT "TenantAiConfig_tenantId_key" UNIQUE ("tenantId")
);

CREATE TABLE IF NOT EXISTS public."AiDailyUsage" (
  id text NOT NULL,
  "tenantId" text NOT NULL,
  date date NOT NULL,
  count integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp(3) without time zone NOT NULL,
  CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY (id),
  CONSTRAINT "AiDailyUsage_tenantId_date_key" UNIQUE ("tenantId", date)
);

CREATE TABLE IF NOT EXISTS public.agent_runs (
  id text NOT NULL,
  tenant_id text NOT NULL,
  definition_id text NOT NULL,
  trigger text DEFAULT ''::text NOT NULL,
  goals jsonb DEFAULT '[]'::jsonb NOT NULL,
  requested_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text NOT NULL,
  requires_approval boolean DEFAULT false NOT NULL,
  requested_at timestamp with time zone DEFAULT now() NOT NULL,
  last_transition_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agent_runs_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.memory_namespaces (
  id text NOT NULL,
  namespace_key text NOT NULL,
  tenant_id text NOT NULL,
  scope text NOT NULL,
  principal_id text DEFAULT ''::text NOT NULL,
  agent_id text DEFAULT ''::text NOT NULL,
  run_id text DEFAULT ''::text NOT NULL,
  workflow_id text DEFAULT ''::text NOT NULL,
  memory_type text NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT memory_namespaces_pkey PRIMARY KEY (id),
  CONSTRAINT memory_namespaces_namespace_key_key UNIQUE (namespace_key)
);

CREATE TABLE IF NOT EXISTS public.memory_items (
  id text NOT NULL,
  namespace_key text NOT NULL,
  content text NOT NULL,
  summary text DEFAULT ''::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT memory_items_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS public.orchestrator_connections (
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  scope text NOT NULL,
  endpoint text NOT NULL,
  namespace text DEFAULT ''::text NOT NULL,
  labels jsonb DEFAULT '{}'::jsonb NOT NULL,
  capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT orchestrator_connections_pkey PRIMARY KEY (id),
  CONSTRAINT orchestrator_connections_name_key UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS "AiDailyUsage_date_idx" ON public."AiDailyUsage" USING btree (date);
CREATE INDEX IF NOT EXISTS idx_agent_runs_tenant_requested_at ON public.agent_runs USING btree (tenant_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_namespaces_tenant_scope ON public.memory_namespaces USING btree (tenant_id, scope, memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_items_namespace_created_at ON public.memory_items USING btree (namespace_key, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TenantAiConfig_tenantId_fkey'
      AND conrelid = 'public."TenantAiConfig"'::regclass
  ) THEN
    ALTER TABLE ONLY public."TenantAiConfig"
      ADD CONSTRAINT "TenantAiConfig_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AiDailyUsage_tenantId_fkey'
      AND conrelid = 'public."AiDailyUsage"'::regclass
  ) THEN
    ALTER TABLE ONLY public."AiDailyUsage"
      ADD CONSTRAINT "AiDailyUsage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'memory_items_namespace_key_fkey'
      AND conrelid = 'public.memory_items'::regclass
  ) THEN
    ALTER TABLE ONLY public.memory_items
      ADD CONSTRAINT memory_items_namespace_key_fkey
      FOREIGN KEY (namespace_key) REFERENCES public.memory_namespaces(namespace_key)
      ON DELETE CASCADE;
  END IF;
END $$;
