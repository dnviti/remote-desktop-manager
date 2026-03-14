-- AlterTable: Add concurrent session limit and absolute timeout to Tenant (SEC-117)
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "maxConcurrentSessions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "absoluteSessionTimeoutSeconds" INTEGER NOT NULL DEFAULT 43200;

-- AlterTable: Add family creation timestamp to RefreshToken for absolute timeout tracking
ALTER TABLE "RefreshToken" ADD COLUMN IF NOT EXISTS "familyCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill: set familyCreatedAt to the earliest createdAt per tokenFamily
UPDATE "RefreshToken" t
SET "familyCreatedAt" = sub."earliest"
FROM (
  SELECT "tokenFamily", MIN("createdAt") AS "earliest"
  FROM "RefreshToken"
  GROUP BY "tokenFamily"
) sub
WHERE t."tokenFamily" = sub."tokenFamily";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RefreshToken_userId_familyCreatedAt_idx" ON "RefreshToken"("userId", "familyCreatedAt");

-- AlterEnum: Add SESSION_LIMIT_EXCEEDED and SESSION_ABSOLUTE_TIMEOUT to AuditAction (idempotent)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SESSION_LIMIT_EXCEEDED'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'SESSION_LIMIT_EXCEEDED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SESSION_ABSOLUTE_TIMEOUT'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'SESSION_ABSOLUTE_TIMEOUT';
    END IF;
END
$$;
