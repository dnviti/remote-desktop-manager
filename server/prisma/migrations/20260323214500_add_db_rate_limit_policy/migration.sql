-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_PLAN_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_AI_OPTIMIZED';
ALTER TYPE "AuditAction" ADD VALUE 'DB_INTROSPECTION_REQUESTED';
ALTER TYPE "AuditAction" ADD VALUE 'DB_SESSION_CONFIG_UPDATED';

-- CreateTable
CREATE TABLE "DbRateLimitPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "queryType" "DbQueryType",
    "windowMs" INTEGER NOT NULL DEFAULT 60000,
    "maxQueries" INTEGER NOT NULL DEFAULT 100,
    "burstMax" INTEGER NOT NULL DEFAULT 10,
    "exemptRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" TEXT,
    "action" "RateLimitAction" NOT NULL DEFAULT 'REJECT',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DbRateLimitPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DbRateLimitPolicy_tenantId_enabled_idx" ON "DbRateLimitPolicy"("tenantId", "enabled");

-- CreateIndex
CREATE INDEX "DbRateLimitPolicy_tenantId_queryType_scope_idx" ON "DbRateLimitPolicy"("tenantId", "queryType", "scope");
