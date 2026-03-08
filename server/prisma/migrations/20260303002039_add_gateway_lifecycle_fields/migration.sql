-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_DEPLOY';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_UNDEPLOY';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_SCALE';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_RESTART';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_HEALTH_CHECK';

-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "desiredReplicas" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "isManaged" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ManagedGatewayInstance" ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0;
