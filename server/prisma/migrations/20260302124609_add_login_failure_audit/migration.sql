-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'LOGIN_FAILURE';

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;
