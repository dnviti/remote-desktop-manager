-- CreateEnum
CREATE TYPE "CheckoutStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CHECKED_IN');

-- AlterEnum: add new audit actions
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_CHECKOUT_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_CHECKOUT_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_CHECKOUT_DENIED';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_CHECKOUT_EXPIRED';
ALTER TYPE "AuditAction" ADD VALUE 'SECRET_CHECKOUT_CHECKED_IN';

-- AlterEnum: add new notification types
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_CHECKOUT_REQUESTED';
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_CHECKOUT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_CHECKOUT_DENIED';
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_CHECKOUT_EXPIRED';

-- CreateTable
CREATE TABLE "SecretCheckoutRequest" (
    "id" TEXT NOT NULL,
    "secretId" TEXT,
    "connectionId" TEXT,
    "requesterId" TEXT NOT NULL,
    "approverId" TEXT,
    "status" "CheckoutStatus" NOT NULL DEFAULT 'PENDING',
    "durationMinutes" INTEGER NOT NULL,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecretCheckoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecretCheckoutRequest_requesterId_status_idx" ON "SecretCheckoutRequest"("requesterId", "status");

-- CreateIndex
CREATE INDEX "SecretCheckoutRequest_status_expiresAt_idx" ON "SecretCheckoutRequest"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SecretCheckoutRequest_secretId_idx" ON "SecretCheckoutRequest"("secretId");

-- CreateIndex
CREATE INDEX "SecretCheckoutRequest_connectionId_idx" ON "SecretCheckoutRequest"("connectionId");

-- AddForeignKey
ALTER TABLE "SecretCheckoutRequest" ADD CONSTRAINT "SecretCheckoutRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecretCheckoutRequest" ADD CONSTRAINT "SecretCheckoutRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
