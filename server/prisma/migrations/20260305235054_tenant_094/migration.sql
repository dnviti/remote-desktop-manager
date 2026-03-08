-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_REQUEST';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_COMPLETE';
ALTER TYPE "AuditAction" ADD VALUE 'PASSWORD_RESET_FAILURE';
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_RECOVERY_KEY_GENERATED';
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_RESET';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_CREATE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_TOGGLE_USER';
ALTER TYPE "AuditAction" ADD VALUE 'APP_CONFIG_UPDATE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "encryptedVaultRecoveryKey" TEXT,
ADD COLUMN     "passwordResetExpiry" TIMESTAMP(3),
ADD COLUMN     "passwordResetTokenHash" TEXT,
ADD COLUMN     "vaultRecoveryKeyIV" TEXT,
ADD COLUMN     "vaultRecoveryKeySalt" TEXT,
ADD COLUMN     "vaultRecoveryKeyTag" TEXT;

-- CreateTable
CREATE TABLE "AppConfig" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetTokenHash_key" ON "User"("passwordResetTokenHash");
