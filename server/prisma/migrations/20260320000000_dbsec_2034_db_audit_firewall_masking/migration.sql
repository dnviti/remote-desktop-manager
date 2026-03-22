-- AlterEnum: ConnectionType
ALTER TYPE "ConnectionType" ADD VALUE 'DATABASE';
ALTER TYPE "ConnectionType" ADD VALUE 'DB_TUNNEL';

-- AlterEnum: SessionProtocol
ALTER TYPE "SessionProtocol" ADD VALUE 'SSH_PROXY';
ALTER TYPE "SessionProtocol" ADD VALUE 'DATABASE';
ALTER TYPE "SessionProtocol" ADD VALUE 'DB_TUNNEL';

-- AlterEnum: GatewayType
ALTER TYPE "GatewayType" ADD VALUE 'DB_PROXY';

-- AlterEnum: AuditAction — SSH proxy
ALTER TYPE "AuditAction" ADD VALUE 'SSH_PROXY_SESSION_START';
ALTER TYPE "AuditAction" ADD VALUE 'SSH_PROXY_SESSION_END';
ALTER TYPE "AuditAction" ADD VALUE 'SSH_PROXY_AUTH_FAILURE';
ALTER TYPE "AuditAction" ADD VALUE 'SSH_PROXY_TOKEN_ISSUED';

-- AlterEnum: AuditAction — DB tunnel
ALTER TYPE "AuditAction" ADD VALUE 'DB_TUNNEL_OPEN';
ALTER TYPE "AuditAction" ADD VALUE 'DB_TUNNEL_CLOSE';
ALTER TYPE "AuditAction" ADD VALUE 'DB_TUNNEL_ERROR';

-- AlterEnum: AuditAction — DB audit / firewall / masking
ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_EXECUTED';
ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_BLOCKED';
ALTER TYPE "AuditAction" ADD VALUE 'DB_FIREWALL_RULE_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'DB_FIREWALL_RULE_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'DB_FIREWALL_RULE_DELETE';
ALTER TYPE "AuditAction" ADD VALUE 'DB_MASKING_POLICY_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'DB_MASKING_POLICY_UPDATE';
ALTER TYPE "AuditAction" ADD VALUE 'DB_MASKING_POLICY_DELETE';

-- AlterTable: Connection — add DB fields
ALTER TABLE "Connection" ADD COLUMN "dbSettings" JSONB;
ALTER TABLE "Connection" ADD COLUMN "bastionConnectionId" TEXT;
ALTER TABLE "Connection" ADD COLUMN "targetDbHost" TEXT;
ALTER TABLE "Connection" ADD COLUMN "targetDbPort" INTEGER;
ALTER TABLE "Connection" ADD COLUMN "dbType" TEXT;

-- CreateEnum: DbQueryType
CREATE TYPE "DbQueryType" AS ENUM ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL', 'OTHER');

-- CreateEnum: FirewallAction
CREATE TYPE "FirewallAction" AS ENUM ('BLOCK', 'ALERT', 'LOG');

-- CreateEnum: MaskingStrategy
CREATE TYPE "MaskingStrategy" AS ENUM ('REDACT', 'HASH', 'PARTIAL');

-- CreateTable: DbAuditLog
CREATE TABLE "DbAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "tenantId" TEXT,
    "queryText" TEXT NOT NULL,
    "queryType" "DbQueryType" NOT NULL,
    "tablesAccessed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rowsAffected" INTEGER,
    "executionTimeMs" INTEGER,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DbAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DbFirewallRule
CREATE TABLE "DbFirewallRule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "action" "FirewallAction" NOT NULL,
    "scope" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DbFirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DbMaskingPolicy
CREATE TABLE "DbMaskingPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columnPattern" TEXT NOT NULL,
    "strategy" "MaskingStrategy" NOT NULL,
    "exemptRoles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DbMaskingPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DbAuditLog_userId_createdAt_idx" ON "DbAuditLog"("userId", "createdAt");
CREATE INDEX "DbAuditLog_connectionId_createdAt_idx" ON "DbAuditLog"("connectionId", "createdAt");
CREATE INDEX "DbAuditLog_tenantId_createdAt_idx" ON "DbAuditLog"("tenantId", "createdAt");
CREATE INDEX "DbAuditLog_queryType_idx" ON "DbAuditLog"("queryType");
CREATE INDEX "DbAuditLog_blocked_idx" ON "DbAuditLog"("blocked");

CREATE INDEX "DbFirewallRule_tenantId_enabled_idx" ON "DbFirewallRule"("tenantId", "enabled");
CREATE INDEX "DbFirewallRule_tenantId_idx" ON "DbFirewallRule"("tenantId");

CREATE INDEX "DbMaskingPolicy_tenantId_enabled_idx" ON "DbMaskingPolicy"("tenantId", "enabled");
CREATE INDEX "DbMaskingPolicy_tenantId_idx" ON "DbMaskingPolicy"("tenantId");

-- AddForeignKey
ALTER TABLE "DbAuditLog" ADD CONSTRAINT "DbAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DbAuditLog" ADD CONSTRAINT "DbAuditLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "Connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
