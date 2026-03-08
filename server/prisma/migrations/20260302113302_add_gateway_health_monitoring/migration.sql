-- CreateEnum
CREATE TYPE "GatewayHealthStatus" AS ENUM ('UNKNOWN', 'REACHABLE', 'UNREACHABLE');

-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastHealthStatus" "GatewayHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "lastLatencyMs" INTEGER,
ADD COLUMN     "monitorIntervalMs" INTEGER NOT NULL DEFAULT 5000,
ADD COLUMN     "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true;
