-- AlterTable
ALTER TABLE "Connection" ADD COLUMN "domainIV" TEXT,
ADD COLUMN "domainTag" TEXT,
ADD COLUMN "encryptedDomain" TEXT;

-- AlterTable
ALTER TABLE "SharedConnection" ADD COLUMN "domainIV" TEXT,
ADD COLUMN "domainTag" TEXT,
ADD COLUMN "encryptedDomain" TEXT;
