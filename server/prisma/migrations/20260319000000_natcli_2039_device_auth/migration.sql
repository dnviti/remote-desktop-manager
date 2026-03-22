-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DEVICE_AUTH_INITIATED';
ALTER TYPE "AuditAction" ADD VALUE 'DEVICE_AUTH_COMPLETED';

-- CreateTable
CREATE TABLE "DeviceAuthCode" (
    "id" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "userCode" TEXT NOT NULL,
    "userId" TEXT,
    "authorized" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 5,
    "clientId" TEXT NOT NULL DEFAULT 'arsenale-cli',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthCode_deviceCode_key" ON "DeviceAuthCode"("deviceCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeviceAuthCode_userCode_key" ON "DeviceAuthCode"("userCode");

-- CreateIndex
CREATE INDEX "DeviceAuthCode_deviceCode_idx" ON "DeviceAuthCode"("deviceCode");

-- CreateIndex
CREATE INDEX "DeviceAuthCode_userCode_idx" ON "DeviceAuthCode"("userCode");
