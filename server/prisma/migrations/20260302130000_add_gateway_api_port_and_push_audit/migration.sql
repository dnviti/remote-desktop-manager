-- AlterTable
ALTER TABLE "Gateway" ADD COLUMN "apiPort" INTEGER;

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SSH_KEY_PUSH';
