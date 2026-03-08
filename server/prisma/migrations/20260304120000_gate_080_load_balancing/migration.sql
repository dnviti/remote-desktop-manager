-- CreateEnum
CREATE TYPE "LoadBalancingStrategy" AS ENUM ('ROUND_ROBIN', 'LEAST_CONNECTIONS');

-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "lbStrategy" "LoadBalancingStrategy" NOT NULL DEFAULT 'ROUND_ROBIN';

-- AlterTable
ALTER TABLE "GatewayTemplate" ADD COLUMN     "lbStrategy" "LoadBalancingStrategy" NOT NULL DEFAULT 'ROUND_ROBIN';

-- AlterTable
ALTER TABLE "ActiveSession" ADD COLUMN     "instanceId" TEXT;

-- CreateIndex
CREATE INDEX "ActiveSession_instanceId_status_idx" ON "ActiveSession"("instanceId", "status");

-- AddForeignKey
ALTER TABLE "ActiveSession" ADD CONSTRAINT "ActiveSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ManagedGatewayInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
