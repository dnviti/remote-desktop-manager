-- CreateEnum
CREATE TYPE "RotationStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING');

-- CreateEnum
CREATE TYPE "RotationTrigger" AS ENUM ('SCHEDULED', 'CHECKIN', 'MANUAL');

-- CreateEnum
CREATE TYPE "RotationTargetOS" AS ENUM ('LINUX', 'WINDOWS');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_ROTATION_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_ROTATION_FAILED';

-- AlterTable
ALTER TABLE "VaultSecret" ADD COLUMN "targetRotationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VaultSecret" ADD COLUMN "rotationIntervalDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "VaultSecret" ADD COLUMN "lastRotatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PasswordRotationLog" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "status" "RotationStatus" NOT NULL,
    "trigger" "RotationTrigger" NOT NULL,
    "targetOS" "RotationTargetOS" NOT NULL,
    "targetHost" TEXT NOT NULL,
    "targetUser" TEXT NOT NULL,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "initiatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordRotationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordRotationLog_secretId_createdAt_idx" ON "PasswordRotationLog"("secretId", "createdAt");

-- CreateIndex
CREATE INDEX "PasswordRotationLog_status_idx" ON "PasswordRotationLog"("status");

-- CreateIndex
CREATE INDEX "VaultSecret_targetRotationEnabled_lastRotatedAt_idx" ON "VaultSecret"("targetRotationEnabled", "lastRotatedAt");

-- AddForeignKey
ALTER TABLE "PasswordRotationLog" ADD CONSTRAINT "PasswordRotationLog_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "VaultSecret"("id") ON DELETE CASCADE ON UPDATE CASCADE;
