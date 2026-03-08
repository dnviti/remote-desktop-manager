-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN     "inactivityTimeoutSeconds" INTEGER NOT NULL DEFAULT 3600;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "defaultSessionTimeoutSeconds" INTEGER NOT NULL DEFAULT 3600;
