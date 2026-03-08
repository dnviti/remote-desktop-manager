-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SSH_KEY_AUTO_ROTATE';

-- AlterTable
ALTER TABLE "SshKeyPair" ADD COLUMN     "autoRotateEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "lastAutoRotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotationIntervalDays" INTEGER NOT NULL DEFAULT 90;
