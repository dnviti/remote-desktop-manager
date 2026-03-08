-- CreateEnum
CREATE TYPE "ManagedInstanceStatus" AS ENUM ('PROVISIONING', 'RUNNING', 'STOPPED', 'ERROR', 'REMOVING');

-- CreateTable
CREATE TABLE "ManagedGatewayInstance" (
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "containerId" TEXT NOT NULL,
    "containerName" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "status" "ManagedInstanceStatus" NOT NULL DEFAULT 'PROVISIONING',
    "orchestratorType" TEXT NOT NULL,
    "healthStatus" TEXT,
    "lastHealthCheck" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedGatewayInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedGatewayInstance_containerId_key" ON "ManagedGatewayInstance"("containerId");

-- CreateIndex
CREATE INDEX "ManagedGatewayInstance_gatewayId_idx" ON "ManagedGatewayInstance"("gatewayId");

-- CreateIndex
CREATE INDEX "ManagedGatewayInstance_status_idx" ON "ManagedGatewayInstance"("status");

-- AddForeignKey
ALTER TABLE "ManagedGatewayInstance" ADD CONSTRAINT "ManagedGatewayInstance_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE CASCADE ON UPDATE CASCADE;
