-- AlterTable
ALTER TABLE "Connection" ADD COLUMN     "credentialSecretId" TEXT,
ALTER COLUMN "encryptedUsername" DROP NOT NULL,
ALTER COLUMN "usernameIV" DROP NOT NULL,
ALTER COLUMN "usernameTag" DROP NOT NULL,
ALTER COLUMN "encryptedPassword" DROP NOT NULL,
ALTER COLUMN "passwordIV" DROP NOT NULL,
ALTER COLUMN "passwordTag" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Connection" ADD CONSTRAINT "Connection_credentialSecretId_fkey" FOREIGN KEY ("credentialSecretId") REFERENCES "VaultSecret"("id") ON DELETE SET NULL ON UPDATE CASCADE;
