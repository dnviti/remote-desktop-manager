-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SECRET_SHARED';
ALTER TYPE "NotificationType" ADD VALUE 'SECRET_SHARE_REVOKED';

-- CreateTable
CREATE TABLE "SharedSecret" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "sharedWithUserId" TEXT NOT NULL,
    "sharedByUserId" TEXT NOT NULL,
    "permission" "Permission" NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "dataIV" TEXT NOT NULL,
    "dataTag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SharedSecret_secretId_sharedWithUserId_key" ON "SharedSecret"("secretId", "sharedWithUserId");

-- AddForeignKey
ALTER TABLE "SharedSecret" ADD CONSTRAINT "SharedSecret_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "VaultSecret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSecret" ADD CONSTRAINT "SharedSecret_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SharedSecret" ADD CONSTRAINT "SharedSecret_sharedByUserId_fkey" FOREIGN KEY ("sharedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
