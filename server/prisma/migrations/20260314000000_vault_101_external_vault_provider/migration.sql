-- CreateEnum
CREATE TYPE "ExternalVaultAuthMethod" AS ENUM ('TOKEN', 'APPROLE');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_PROVIDER_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_PROVIDER_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_PROVIDER_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'VAULT_PROVIDER_TEST';

-- CreateTable
CREATE TABLE "ExternalVaultProvider" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "serverUrl" TEXT NOT NULL,
    "authMethod" "ExternalVaultAuthMethod" NOT NULL,
    "namespace" TEXT,
    "mountPath" TEXT NOT NULL DEFAULT 'secret',
    "encryptedAuthPayload" TEXT NOT NULL,
    "authPayloadIV" TEXT NOT NULL,
    "authPayloadTag" TEXT NOT NULL,
    "caCertificate" TEXT,
    "cacheTtlSeconds" INTEGER NOT NULL DEFAULT 300,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalVaultProvider_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Connection" ADD COLUMN "externalVaultProviderId" TEXT;
ALTER TABLE "Connection" ADD COLUMN "externalVaultPath" TEXT;

-- CreateIndex
CREATE INDEX "ExternalVaultProvider_tenantId_idx" ON "ExternalVaultProvider"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalVaultProvider_tenantId_name_key" ON "ExternalVaultProvider"("tenantId", "name");

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_externalVaultProviderId_fkey" FOREIGN KEY ("externalVaultProviderId") REFERENCES "ExternalVaultProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalVaultProvider" ADD CONSTRAINT "ExternalVaultProvider_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
