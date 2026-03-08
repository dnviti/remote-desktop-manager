-- CreateEnum
CREATE TYPE "SessionProtocol" AS ENUM ('SSH', 'RDP');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'IDLE', 'CLOSED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SESSION_TIMEOUT';

-- CreateTable
CREATE TABLE "ActiveSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "gatewayId" TEXT,
    "protocol" "SessionProtocol" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "socketId" TEXT,
    "guacTokenHash" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "ActiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActiveSession_userId_status_idx" ON "ActiveSession"("userId", "status");

-- CreateIndex
CREATE INDEX "ActiveSession_status_idx" ON "ActiveSession"("status");

-- CreateIndex
CREATE INDEX "ActiveSession_gatewayId_status_idx" ON "ActiveSession"("gatewayId", "status");

-- CreateIndex
CREATE INDEX "ActiveSession_protocol_status_idx" ON "ActiveSession"("protocol", "status");

-- CreateIndex
CREATE INDEX "ActiveSession_lastActivityAt_idx" ON "ActiveSession"("lastActivityAt");

-- CreateIndex
CREATE INDEX "ActiveSession_socketId_idx" ON "ActiveSession"("socketId");

-- CreateIndex
CREATE INDEX "ActiveSession_guacTokenHash_idx" ON "ActiveSession"("guacTokenHash");

-- AddForeignKey
ALTER TABLE "ActiveSession" ADD CONSTRAINT "ActiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveSession" ADD CONSTRAINT "ActiveSession_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveSession" ADD CONSTRAINT "ActiveSession_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "Gateway"("id") ON DELETE SET NULL ON UPDATE CASCADE;
