ALTER TABLE public."Gateway"
ADD COLUMN IF NOT EXISTS "egressPolicy" jsonb NOT NULL DEFAULT '{"rules":[]}'::jsonb;

ALTER TYPE public."AuditAction"
ADD VALUE IF NOT EXISTS 'TUNNEL_EGRESS_DENIED';
