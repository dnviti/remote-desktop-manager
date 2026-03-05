-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encryptedTotpSecret" TEXT,
ADD COLUMN     "totpSecretIV" TEXT,
ADD COLUMN     "totpSecretTag" TEXT;
