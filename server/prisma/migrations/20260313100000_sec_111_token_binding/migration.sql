-- AlterTable: Add ipUaHash column to RefreshToken for token binding (SEC-111)
ALTER TABLE "RefreshToken" ADD COLUMN "ipUaHash" TEXT;

-- AlterEnum: Add TOKEN_HIJACK_ATTEMPT to AuditAction
ALTER TYPE "AuditAction" ADD VALUE 'TOKEN_HIJACK_ATTEMPT';
