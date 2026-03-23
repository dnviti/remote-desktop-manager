-- AlterEnum: Add missing AuditAction values for DB firewall alerts and SQL visualization
-- DB_QUERY_FIREWALL_ALERT was referenced in dbSession.service.ts but never migrated
-- DB_QUERY_PLAN_REQUESTED and DB_QUERY_AI_OPTIMIZED added for SQLVIZ-2070

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DB_QUERY_FIREWALL_ALERT'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_FIREWALL_ALERT';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DB_QUERY_PLAN_REQUESTED'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_PLAN_REQUESTED';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'DB_QUERY_AI_OPTIMIZED'
        AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'AuditAction')) THEN
        ALTER TYPE "AuditAction" ADD VALUE 'DB_QUERY_AI_OPTIMIZED';
    END IF;
END $$;
