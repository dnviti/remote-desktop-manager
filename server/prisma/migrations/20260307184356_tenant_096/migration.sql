/*
  Warnings:

  - You are about to drop the column `tenantId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `tenantRole` on the `User` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PROFILE_EMAIL_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EMAIL_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_PASSWORD_CHANGE';
ALTER TYPE "AuditAction" ADD VALUE 'DOMAIN_PROFILE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'DOMAIN_PROFILE_CLEAR';
ALTER TYPE "AuditAction" ADD VALUE 'TENANT_SWITCH';

-- AlterEnum
ALTER TYPE "AuthProvider" ADD VALUE 'SAML';

-- CreateTable (before dropping User columns so we can migrate data)
CREATE TABLE "TenantMember" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TenantRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMember_pkey" PRIMARY KEY ("id")
);

-- Migrate existing User tenant memberships into TenantMember
INSERT INTO "TenantMember" ("id", "tenantId", "userId", "role", "isActive", "joinedAt", "updatedAt")
SELECT gen_random_uuid(), "tenantId", "id", "tenantRole", true, "createdAt", NOW()
FROM "User"
WHERE "tenantId" IS NOT NULL AND "tenantRole" IS NOT NULL;

-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_tenantId_fkey";

-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "defaultCredentialMode" TEXT;

-- AlterTable
ALTER TABLE "OAuthAccount" ADD COLUMN     "samlAttributes" JSONB;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "tenantId",
DROP COLUMN "tenantRole",
ADD COLUMN     "domainName" TEXT,
ADD COLUMN     "domainPasswordIV" TEXT,
ADD COLUMN     "domainPasswordTag" TEXT,
ADD COLUMN     "domainUsername" TEXT,
ADD COLUMN     "emailChangeCodeNewHash" TEXT,
ADD COLUMN     "emailChangeCodeOldHash" TEXT,
ADD COLUMN     "emailChangeExpiry" TIMESTAMP(3),
ADD COLUMN     "encryptedDomainPassword" TEXT,
ADD COLUMN     "pendingEmail" TEXT;

-- CreateIndex
CREATE INDEX "TenantMember_userId_isActive_idx" ON "TenantMember"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMember_tenantId_userId_key" ON "TenantMember"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_targetId_createdAt_idx" ON "AuditLog"("targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMember" ADD CONSTRAINT "TenantMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
