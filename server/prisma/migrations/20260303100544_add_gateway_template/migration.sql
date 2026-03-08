-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_TEMPLATE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_TEMPLATE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_TEMPLATE_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'GATEWAY_TEMPLATE_DEPLOY';

-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "GatewayTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GatewayType" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "description" TEXT,
    "apiPort" INTEGER,
    "autoScale" BOOLEAN NOT NULL DEFAULT false,
    "minReplicas" INTEGER NOT NULL DEFAULT 1,
    "maxReplicas" INTEGER NOT NULL DEFAULT 5,
    "sessionsPerInstance" INTEGER NOT NULL DEFAULT 10,
    "scaleDownCooldownSeconds" INTEGER NOT NULL DEFAULT 300,
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "monitorIntervalMs" INTEGER NOT NULL DEFAULT 5000,
    "inactivityTimeoutSeconds" INTEGER NOT NULL DEFAULT 3600,
    "tenantId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatewayTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GatewayTemplate_tenantId_idx" ON "GatewayTemplate"("tenantId");

-- AddForeignKey
ALTER TABLE "Gateway" ADD CONSTRAINT "Gateway_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "GatewayTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTemplate" ADD CONSTRAINT "GatewayTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatewayTemplate" ADD CONSTRAINT "GatewayTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
