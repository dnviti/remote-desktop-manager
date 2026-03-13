-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "ipAllowlistEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Tenant" ADD COLUMN "ipAllowlistMode" TEXT NOT NULL DEFAULT 'flag';
ALTER TABLE "Tenant" ADD COLUMN "ipAllowlistEntries" TEXT[] DEFAULT ARRAY[]::TEXT[];
