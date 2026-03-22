-- AlterEnum: Add SESSION_TERMINATED_POLICY_VIOLATION, KEYSTROKE_POLICY_CREATE,
-- KEYSTROKE_POLICY_UPDATE, KEYSTROKE_POLICY_DELETE to AuditAction
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SESSION_TERMINATED_POLICY_VIOLATION'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'SESSION_TERMINATED_POLICY_VIOLATION';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'KEYSTROKE_POLICY_CREATE'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'KEYSTROKE_POLICY_CREATE';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'KEYSTROKE_POLICY_UPDATE'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'KEYSTROKE_POLICY_UPDATE';
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'KEYSTROKE_POLICY_DELETE'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'KEYSTROKE_POLICY_DELETE';
    END IF;
END
$$;

-- AlterEnum: Add SESSION_TERMINATED_POLICY_VIOLATION to NotificationType
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SESSION_TERMINATED_POLICY_VIOLATION'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'NotificationType')) THEN
        ALTER TYPE "NotificationType" ADD VALUE 'SESSION_TERMINATED_POLICY_VIOLATION';
    END IF;
END
$$;

-- CreateEnum: KeystrokePolicyAction
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KeystrokePolicyAction') THEN
        CREATE TYPE "KeystrokePolicyAction" AS ENUM ('BLOCK_AND_TERMINATE', 'ALERT_ONLY');
    END IF;
END
$$;

-- CreateTable: KeystrokePolicy
CREATE TABLE IF NOT EXISTS "KeystrokePolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "action" "KeystrokePolicyAction" NOT NULL,
    "regexPatterns" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeystrokePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeystrokePolicy_tenantId_idx" ON "KeystrokePolicy"("tenantId");
CREATE INDEX IF NOT EXISTS "KeystrokePolicy_tenantId_enabled_idx" ON "KeystrokePolicy"("tenantId", "enabled");
