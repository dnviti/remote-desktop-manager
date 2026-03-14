-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "enforcedConnectionSettings" JSONB;

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_CONNECTION_POLICY_UPDATE';
