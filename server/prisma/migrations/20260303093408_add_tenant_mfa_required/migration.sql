-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_MFA_POLICY_UPDATE';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "mfaRequired" BOOLEAN NOT NULL DEFAULT false;
