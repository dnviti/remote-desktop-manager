-- CreateTable
CREATE TABLE "SystemSecret" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "encryptedValue" TEXT NOT NULL,
    "valueIV" TEXT NOT NULL,
    "valueTag" TEXT NOT NULL,
    "previousEncryptedValue" TEXT,
    "previousValueIV" TEXT,
    "previousValueTag" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "autoRotate" BOOLEAN NOT NULL DEFAULT true,
    "rotationIntervalDays" INTEGER NOT NULL DEFAULT 90,
    "distributed" BOOLEAN NOT NULL DEFAULT false,
    "targetService" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemSecret_name_key" ON "SystemSecret"("name");
