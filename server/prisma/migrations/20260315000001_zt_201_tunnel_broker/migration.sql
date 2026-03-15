-- AlterEnum: Add tunnel audit actions to AuditAction
DO $$
BEGIN
    -- TUNNEL_CONNECT
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TUNNEL_CONNECT'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'TUNNEL_CONNECT';
    END IF;
END
$$;
DO $$
BEGIN
    -- TUNNEL_DISCONNECT
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TUNNEL_DISCONNECT'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'TUNNEL_DISCONNECT';
    END IF;
END
$$;
DO $$
BEGIN
    -- TUNNEL_TOKEN_GENERATE
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TUNNEL_TOKEN_GENERATE'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'TUNNEL_TOKEN_GENERATE';
    END IF;
END
$$;
DO $$
BEGIN
    -- TUNNEL_TOKEN_ROTATE
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'TUNNEL_TOKEN_ROTATE'
                   AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'TUNNEL_TOKEN_ROTATE';
    END IF;
END
$$;

-- AlterTable: Add tunnel fields to Gateway
ALTER TABLE "Gateway"
    ADD COLUMN IF NOT EXISTS "tunnelEnabled"          BOOLEAN   NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "encryptedTunnelToken"   TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelTokenIV"          TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelTokenTag"         TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelTokenHash"        TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelConnectedAt"      TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "tunnelLastHeartbeat"    TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "tunnelClientVersion"    TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelClientIp"         TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelCaCert"           TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelCaKey"            TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelCaKeyIV"          TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelCaKeyTag"         TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelClientCert"       TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelClientCertExp"    TIMESTAMP(3);

-- Create unique index on tunnelTokenHash
CREATE UNIQUE INDEX IF NOT EXISTS "Gateway_tunnelTokenHash_key" ON "Gateway"("tunnelTokenHash");

-- AlterTable: Add tunnel proxy fields to ManagedGatewayInstance
ALTER TABLE "ManagedGatewayInstance"
    ADD COLUMN IF NOT EXISTS "tunnelProxyHost"  TEXT,
    ADD COLUMN IF NOT EXISTS "tunnelProxyPort"  INTEGER;
