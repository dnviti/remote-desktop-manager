-- CreateTable
CREATE TABLE "ExternalSecretShare" (
    "id" TEXT NOT NULL,
    "secretId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "dataIV" TEXT NOT NULL,
    "dataTag" TEXT NOT NULL,
    "hasPin" BOOLEAN NOT NULL DEFAULT false,
    "pinSalt" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxAccessCount" INTEGER,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "secretType" "SecretType" NOT NULL,
    "secretName" TEXT NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSecretShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalSecretShare_tokenHash_key" ON "ExternalSecretShare"("tokenHash");

-- CreateIndex
CREATE INDEX "ExternalSecretShare_tokenHash_idx" ON "ExternalSecretShare"("tokenHash");

-- CreateIndex
CREATE INDEX "ExternalSecretShare_expiresAt_idx" ON "ExternalSecretShare"("expiresAt");

-- AddForeignKey
ALTER TABLE "ExternalSecretShare" ADD CONSTRAINT "ExternalSecretShare_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES "VaultSecret"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSecretShare" ADD CONSTRAINT "ExternalSecretShare_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
