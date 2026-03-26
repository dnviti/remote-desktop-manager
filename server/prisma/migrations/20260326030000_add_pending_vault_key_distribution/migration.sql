-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TENANT_VAULT_KEY_RECEIVED';

-- CreateTable
CREATE TABLE "PendingVaultKeyDistribution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "encryptedTenantVaultKey" TEXT NOT NULL,
    "tenantVaultKeyIV" TEXT NOT NULL,
    "tenantVaultKeyTag" TEXT NOT NULL,
    "distributorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingVaultKeyDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingVaultKeyDistribution_tenantId_targetUserId_key" ON "PendingVaultKeyDistribution"("tenantId", "targetUserId");

-- AddForeignKey
ALTER TABLE "PendingVaultKeyDistribution" ADD CONSTRAINT "PendingVaultKeyDistribution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingVaultKeyDistribution" ADD CONSTRAINT "PendingVaultKeyDistribution_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingVaultKeyDistribution" ADD CONSTRAINT "PendingVaultKeyDistribution_distributorUserId_fkey" FOREIGN KEY ("distributorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
