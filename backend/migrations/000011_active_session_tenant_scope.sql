ALTER TABLE public."ActiveSession"
ADD COLUMN IF NOT EXISTS "tenantId" text;

CREATE INDEX IF NOT EXISTS "ActiveSession_tenantId_idx"
ON public."ActiveSession" ("tenantId");
