-- CreateEnum
CREATE TYPE "SecretType" AS ENUM ('LOGIN', 'SSH_KEY', 'CERTIFICATE', 'API_KEY', 'SECURE_NOTE');

-- CreateEnum
CREATE TYPE "SecretScope" AS ENUM ('PERSONAL', 'TEAM', 'TENANT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SECRET_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_READ';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_SHARE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_UNSHARE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_EXTERNAL_SHARE';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_EXTERNAL_ACCESS';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_VERSION_RESTORE';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_VAULT_INIT';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_VAULT_KEY_DISTRIBUTE';

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "hasTenantVaultKey" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VaultSecret" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "SecretType" NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "tenantId" TEXT,
    "folderId" TEXT,
    "encryptedData" TEXT NOT NULL,
    "dataIV" TEXT NOT NULL,
    "dataTag" TEXT NOT NULL,
    "metadata" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultSecretVersion" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "dataIV" TEXT NOT NULL,
    "dataTag" TEXT NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultSecretVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VaultFolder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "scope" "SecretScope" NOT NULL,
    "teamId" TEXT,
    "tenantId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VaultFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantVaultMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedTenantVaultKey" TEXT NOT NULL,
    "tenantVaultKeyIV" TEXT NOT NULL,
    "tenantVaultKeyTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantVaultMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VaultSecret_userId_scope_idx" ON "VaultSecret"("userId", "scope");

-- CreateIndex
CREATE INDEX "VaultSecret_teamId_idx" ON "VaultSecret"("teamId");

-- CreateIndex
CREATE INDEX "VaultSecret_tenantId_scope_idx" ON "VaultSecret"("tenantId", "scope");

-- CreateIndex
CREATE INDEX "VaultSecret_expiresAt_idx" ON "VaultSecret"("expiresAt");

-- CreateIndex
CREATE INDEX "VaultSecretVersion_secretId_idx" ON "VaultSecretVersion"("secretId");

-- CreateIndex
CREATE UNIQUE INDEX "VaultSecretVersion_secretId_version_key" ON "VaultSecretVersion"("secretId", "version");

-- CreateIndex
CREATE INDEX "VaultFolder_userId_scope_idx" ON "VaultFolder"("userId", "scope");

-- CreateIndex
CREATE INDEX "VaultFolder_teamId_idx" ON "VaultFolder"("teamId");

-- CreateIndex
CREATE INDEX "VaultFolder_tenantId_idx" ON "VaultFolder"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantVaultMember_tenantId_userId_key" ON "TenantVaultMember"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "VaultSecret" ADD CONSTRAINT "VaultSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSecret" ADD CONSTRAINT "VaultSecret_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSecret" ADD CONSTRAINT "VaultSecret_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSecret" ADD CONSTRAINT "VaultSecret_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "VaultFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSecretVersion" ADD CONSTRAINT "VaultSecretVersion_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "VaultSecret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultSecretVersion" ADD CONSTRAINT "VaultSecretVersion_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "VaultFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VaultFolder" ADD CONSTRAINT "VaultFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantVaultMember" ADD CONSTRAINT "TenantVaultMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantVaultMember" ADD CONSTRAINT "TenantVaultMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
