-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_SCALE_UP';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_SCALE_DOWN';

-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "autoScale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastScaleAction" TIMESTAMP(3),
ADD COLUMN     "maxReplicas" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "minReplicas" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "scaleDownCooldownSeconds" INTEGER NOT NULL DEFAULT 300,
ADD COLUMN     "sessionsPerInstance" INTEGER NOT NULL DEFAULT 10;
