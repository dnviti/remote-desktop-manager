-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "vaultAutoLockMaxMinutes" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "vaultAutoLockMinutes" INTEGER;
