-- AlterTable: Add tunnel configuration fields to Tenant
ALTER TABLE "Tenant"
    ADD COLUMN IF NOT EXISTS "tunnelDefaultEnabled"       BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "tunnelAutoTokenRotation"    BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "tunnelTokenRotationDays"    INTEGER   NOT NULL DEFAULT 90,
    ADD COLUMN IF NOT EXISTS "tunnelRequireForRemote"     BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "tunnelTokenMaxLifetimeDays" INTEGER,
    ADD COLUMN IF NOT EXISTS "tunnelAgentAllowedCidrs"    TEXT[]    DEFAULT ARRAY[]::TEXT[];
