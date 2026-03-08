-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SSH_KEY_GENERATE';
ALTER TYPE "AuditAction" ADD VALUE 'SSH_KEY_ROTATE';

-- CreateTable
CREATE TABLE "SshKeyPair" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "privateKeyIV" TEXT NOT NULL,
    "privateKeyTag" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'ed25519',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SshKeyPair_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SshKeyPair_tenantId_key" ON "SshKeyPair"("tenantId");

-- AddForeignKey
ALTER TABLE "SshKeyPair" ADD CONSTRAINT "SshKeyPair_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
