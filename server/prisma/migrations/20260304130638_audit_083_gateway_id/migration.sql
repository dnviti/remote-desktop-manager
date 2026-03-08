-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'REFRESH_TOKEN_REUSE';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "gatewayId" TEXT;

-- AlterTable: add tokenFamily as nullable first, backfill, then make NOT NULL
ALTER TABLE "RefreshToken" ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "tokenFamily" TEXT;

-- Backfill existing rows: each token gets its own family (uuid from id)
UPDATE "RefreshToken" SET "tokenFamily" = "id" WHERE "tokenFamily" IS NULL;

-- Now make tokenFamily required
ALTER TABLE "RefreshToken" ALTER COLUMN "tokenFamily" SET NOT NULL;

-- CreateIndex
CREATE INDEX "AuditLog_gatewayId_idx" ON "AuditLog"("gatewayId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenFamily_idx" ON "RefreshToken"("tokenFamily");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
