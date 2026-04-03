DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'GatewayDeploymentMode'
  ) THEN
    CREATE TYPE public."GatewayDeploymentMode" AS ENUM ('SINGLE_INSTANCE', 'MANAGED_GROUP');
  END IF;
END $$;

ALTER TABLE public."Gateway"
  ADD COLUMN IF NOT EXISTS "deploymentMode" public."GatewayDeploymentMode"
  DEFAULT 'SINGLE_INSTANCE' NOT NULL;

ALTER TABLE public."GatewayTemplate"
  ADD COLUMN IF NOT EXISTS "deploymentMode" public."GatewayDeploymentMode"
  DEFAULT 'SINGLE_INSTANCE' NOT NULL;

UPDATE public."Gateway"
SET "deploymentMode" = CASE
  WHEN type = 'SSH_BASTION'::public."GatewayType" THEN 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
  WHEN "isManaged" THEN 'MANAGED_GROUP'::public."GatewayDeploymentMode"
  ELSE 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
END
WHERE "deploymentMode" IS DISTINCT FROM CASE
  WHEN type = 'SSH_BASTION'::public."GatewayType" THEN 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
  WHEN "isManaged" THEN 'MANAGED_GROUP'::public."GatewayDeploymentMode"
  ELSE 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
END;

UPDATE public."GatewayTemplate"
SET "deploymentMode" = CASE
  WHEN type = 'SSH_BASTION'::public."GatewayType" THEN 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
  WHEN COALESCE(BTRIM(host), '') = '' THEN 'MANAGED_GROUP'::public."GatewayDeploymentMode"
  ELSE 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
END
WHERE "deploymentMode" IS DISTINCT FROM CASE
  WHEN type = 'SSH_BASTION'::public."GatewayType" THEN 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
  WHEN COALESCE(BTRIM(host), '') = '' THEN 'MANAGED_GROUP'::public."GatewayDeploymentMode"
  ELSE 'SINGLE_INSTANCE'::public."GatewayDeploymentMode"
END;
