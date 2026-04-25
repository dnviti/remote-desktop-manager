DO $$
DECLARE
  known_tables text[] := ARRAY[
    'AccessPolicy',
    'ActiveSession',
    'AiDailyUsage',
    'AppConfig',
    'AuditLog',
    'Connection',
    'DbAuditLog',
    'DbFirewallRule',
    'DbMaskingPolicy',
    'DbRateLimitPolicy',
    'DeviceAuthCode',
    'ExternalSecretShare',
    'ExternalVaultProvider',
    'Folder',
    'Gateway',
    'GatewayTemplate',
    'KeystrokePolicy',
    'ManagedGatewayInstance',
    'Notification',
    'NotificationPreference',
    'OAuthAccount',
    'OpenTab',
    'PasswordRotationLog',
    'PendingVaultKeyDistribution',
    'RefreshToken',
    'SecretCheckoutRequest',
    'SessionRecording',
    'SharedConnection',
    'SharedSecret',
    'SshKeyPair',
    'SyncLog',
    'SyncProfile',
    'SystemSecret',
    'Team',
    'TeamMember',
    'Tenant',
    'TenantAiConfig',
    'TenantMember',
    'TenantVaultMember',
    'User',
    'VaultFolder',
    'VaultSecret',
    'VaultSecretVersion',
    'WebAuthnCredential',
    '_prisma_migrations',
    'agent_runs',
    'arsenale_schema_migrations',
    'memory_items',
    'memory_namespaces',
    'orchestrator_connections'
  ];
  related_connection_ids text[] := ARRAY[]::text[];
  related_gateway_ids text[] := ARRAY[]::text[];
  discovered_ids text[];
  col record;
  tbl text;
BEGIN
  FOR col IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name <> ALL (known_tables)
      AND column_name IN ('connectionId', 'gatewayId', 'sourceGatewayId', 'ephemeralGatewayId')
    ORDER BY table_name, column_name
  LOOP
    EXECUTE format(
      'SELECT COALESCE(array_agg(DISTINCT %1$I::text), ARRAY[]::text[]) FROM public.%2$I WHERE %1$I IS NOT NULL',
      col.column_name,
      col.table_name
    )
    INTO discovered_ids;

    IF col.column_name = 'connectionId' THEN
      related_connection_ids := related_connection_ids || discovered_ids;
    ELSE
      related_gateway_ids := related_gateway_ids || discovered_ids;
    END IF;
  END LOOP;

  FOR tbl IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> ALL (known_tables)
    ORDER BY table_name
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', tbl);
  END LOOP;

  DELETE FROM public."Connection"
  WHERE id = ANY (related_connection_ids);

  DELETE FROM public."Gateway"
  WHERE id = ANY (related_gateway_ids);
END $$;

DO $$
DECLARE
  allowed_gateway_columns text[] := ARRAY[
    'id',
    'name',
    'type',
    'host',
    'port',
    'deploymentMode',
    'description',
    'isDefault',
    'tenantId',
    'createdById',
    'encryptedUsername',
    'usernameIV',
    'usernameTag',
    'encryptedPassword',
    'passwordIV',
    'passwordTag',
    'createdAt',
    'updatedAt',
    'lastCheckedAt',
    'lastError',
    'lastHealthStatus',
    'lastLatencyMs',
    'monitorIntervalMs',
    'monitoringEnabled',
    'encryptedSshKey',
    'sshKeyIV',
    'sshKeyTag',
    'apiPort',
    'inactivityTimeoutSeconds',
    'desiredReplicas',
    'isManaged',
    'autoScale',
    'lastScaleAction',
    'maxReplicas',
    'minReplicas',
    'scaleDownCooldownSeconds',
    'sessionsPerInstance',
    'templateId',
    'publishPorts',
    'lbStrategy',
    'tunnelEnabled',
    'encryptedTunnelToken',
    'tunnelTokenIV',
    'tunnelTokenTag',
    'tunnelTokenHash',
    'tunnelConnectedAt',
    'tunnelLastHeartbeat',
    'tunnelClientVersion',
    'tunnelClientIp',
    'tunnelClientCert',
    'tunnelClientCertExp',
    'tunnelClientKey',
    'tunnelClientKeyIV',
    'tunnelClientKeyTag'
  ];
  stale_column text;
BEGIN
  FOR stale_column IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Gateway'
      AND column_name <> ALL (allowed_gateway_columns)
    ORDER BY column_name
  LOOP
    EXECUTE format('ALTER TABLE public."Gateway" DROP COLUMN IF EXISTS %I CASCADE', stale_column);
  END LOOP;
END $$;

DO $$
DECLARE
  connection_types text[] := ARRAY['RDP', 'SSH', 'VNC', 'DATABASE', 'DB_TUNNEL'];
  gateway_types text[] := ARRAY['GUACD', 'SSH_BASTION', 'MANAGED_SSH', 'DB_PROXY'];
  audit_actions text[] := ARRAY[
    'LOGIN',
    'LOGIN_OAUTH',
    'LOGIN_TOTP',
    'LOGOUT',
    'REGISTER',
    'VAULT_UNLOCK',
    'VAULT_LOCK',
    'VAULT_SETUP',
    'CREATE_CONNECTION',
    'UPDATE_CONNECTION',
    'DELETE_CONNECTION',
    'SHARE_CONNECTION',
    'UNSHARE_CONNECTION',
    'UPDATE_SHARE_PERMISSION',
    'CREATE_FOLDER',
    'UPDATE_FOLDER',
    'DELETE_FOLDER',
    'PASSWORD_CHANGE',
    'PROFILE_UPDATE',
    'TOTP_ENABLE',
    'TOTP_DISABLE',
    'LOGIN_SMS',
    'SMS_MFA_ENABLE',
    'SMS_MFA_DISABLE',
    'SMS_PHONE_VERIFY',
    'OAUTH_LINK',
    'OAUTH_UNLINK',
    'PASSWORD_REVEAL',
    'TENANT_CREATE',
    'TENANT_UPDATE',
    'TENANT_DELETE',
    'TENANT_INVITE_USER',
    'TENANT_REMOVE_USER',
    'TENANT_UPDATE_USER_ROLE',
    'TEAM_CREATE',
    'TEAM_UPDATE',
    'TEAM_DELETE',
    'TEAM_ADD_MEMBER',
    'TEAM_REMOVE_MEMBER',
    'TEAM_UPDATE_MEMBER_ROLE',
    'EMAIL_TEST_SEND',
    'GATEWAY_CREATE',
    'GATEWAY_UPDATE',
    'GATEWAY_DELETE',
    'SSH_KEY_GENERATE',
    'SSH_KEY_ROTATE',
    'BATCH_SHARE',
    'SSH_KEY_AUTO_ROTATE',
    'SESSION_START',
    'SESSION_END',
    'LOGIN_FAILURE',
    'SSH_KEY_PUSH',
    'SECRET_CREATE',
    'SECRET_READ',
    'SECRET_UPDATE',
    'SECRET_DELETE',
    'SECRET_SHARE',
    'SECRET_UNSHARE',
    'SECRET_EXTERNAL_SHARE',
    'SECRET_EXTERNAL_ACCESS',
    'SECRET_VERSION_RESTORE',
    'TENANT_VAULT_INIT',
    'TENANT_VAULT_KEY_DISTRIBUTE',
    'SESSION_TIMEOUT',
    'GATEWAY_DEPLOY',
    'GATEWAY_UNDEPLOY',
    'GATEWAY_SCALE',
    'GATEWAY_RESTART',
    'GATEWAY_HEALTH_CHECK',
    'GATEWAY_SCALE_UP',
    'GATEWAY_SCALE_DOWN',
    'TENANT_MFA_POLICY_UPDATE',
    'GATEWAY_TEMPLATE_CREATE',
    'GATEWAY_TEMPLATE_UPDATE',
    'GATEWAY_TEMPLATE_DELETE',
    'GATEWAY_TEMPLATE_DEPLOY',
    'REFRESH_TOKEN_REUSE',
    'GATEWAY_VIEW_LOGS',
    'SESSION_ERROR',
    'SFTP_UPLOAD',
    'SFTP_DOWNLOAD',
    'SFTP_DELETE',
    'SFTP_MKDIR',
    'SFTP_RENAME',
    'VAULT_AUTO_LOCK',
    'SESSION_TERMINATE',
    'SECRET_EXTERNAL_REVOKE',
    'SECRET_SHARE_UPDATE',
    'GATEWAY_RECONCILE',
    'CONNECTION_FAVORITE',
    'WEBAUTHN_REGISTER',
    'WEBAUTHN_REMOVE',
    'LOGIN_WEBAUTHN',
    'PASSWORD_RESET_REQUEST',
    'PASSWORD_RESET_COMPLETE',
    'PASSWORD_RESET_FAILURE',
    'VAULT_RECOVERY_KEY_GENERATED',
    'VAULT_RESET',
    'TENANT_CREATE_USER',
    'TENANT_TOGGLE_USER',
    'APP_CONFIG_UPDATE',
    'PROFILE_EMAIL_CHANGE',
    'ADMIN_EMAIL_CHANGE',
    'ADMIN_PASSWORD_CHANGE',
    'DOMAIN_PROFILE_UPDATE',
    'DOMAIN_PROFILE_CLEAR',
    'TENANT_SWITCH',
    'RECORDING_START',
    'RECORDING_VIEW',
    'RECORDING_DELETE',
    'RECORDING_EXPORT_VIDEO',
    'EXPORT_CONNECTIONS',
    'IMPORT_CONNECTIONS',
    'TENANT_MEMBERSHIP_EXPIRED',
    'TEAM_MEMBERSHIP_EXPIRED',
    'TENANT_MEMBERSHIP_EXPIRY_UPDATE',
    'TEAM_MEMBERSHIP_EXPIRY_UPDATE',
    'TENANT_DLP_POLICY_UPDATE',
    'TOKEN_HIJACK_ATTEMPT',
    'TENANT_CONNECTION_POLICY_UPDATE',
    'SESSION_LIMIT_EXCEEDED',
    'SESSION_ABSOLUTE_TIMEOUT',
    'VAULT_PROVIDER_CREATE',
    'VAULT_PROVIDER_UPDATE',
    'VAULT_PROVIDER_DELETE',
    'VAULT_PROVIDER_TEST',
    'LDAP_LOGIN',
    'LDAP_LOGIN_FAILURE',
    'LDAP_SYNC_START',
    'LDAP_SYNC_COMPLETE',
    'LDAP_SYNC_ERROR',
    'LDAP_USER_CREATED',
    'LDAP_USER_DISABLED',
    'SYNC_PROFILE_CREATE',
    'SYNC_PROFILE_UPDATE',
    'SYNC_PROFILE_DELETE',
    'SYNC_START',
    'SYNC_COMPLETE',
    'SYNC_ERROR',
    'IMPOSSIBLE_TRAVEL_DETECTED',
    'TUNNEL_CONNECT',
    'TUNNEL_DISCONNECT',
    'TUNNEL_TOKEN_GENERATE',
    'TUNNEL_TOKEN_ROTATE',
    'SESSION_DENIED_ABAC',
    'SESSION_TERMINATED_POLICY_VIOLATION',
    'KEYSTROKE_POLICY_CREATE',
    'KEYSTROKE_POLICY_UPDATE',
    'KEYSTROKE_POLICY_DELETE',
    'SECRET_CHECKOUT_REQUESTED',
    'SECRET_CHECKOUT_APPROVED',
    'SECRET_CHECKOUT_DENIED',
    'SECRET_CHECKOUT_EXPIRED',
    'SECRET_CHECKOUT_CHECKED_IN',
    'PASSWORD_ROTATION_SUCCESS',
    'PASSWORD_ROTATION_FAILED',
    'DEVICE_AUTH_INITIATED',
    'DEVICE_AUTH_COMPLETED',
    'ANOMALOUS_LATERAL_MOVEMENT',
    'SSH_PROXY_SESSION_START',
    'SSH_PROXY_SESSION_END',
    'SSH_PROXY_AUTH_FAILURE',
    'SSH_PROXY_TOKEN_ISSUED',
    'DB_TUNNEL_OPEN',
    'DB_TUNNEL_CLOSE',
    'DB_TUNNEL_ERROR',
    'DB_QUERY_EXECUTED',
    'DB_QUERY_BLOCKED',
    'DB_FIREWALL_RULE_CREATE',
    'DB_FIREWALL_RULE_UPDATE',
    'DB_FIREWALL_RULE_DELETE',
    'DB_MASKING_POLICY_CREATE',
    'DB_MASKING_POLICY_UPDATE',
    'DB_MASKING_POLICY_DELETE',
    'DB_QUERY_FIREWALL_ALERT',
    'DB_QUERY_PLAN_REQUESTED',
    'DB_QUERY_AI_OPTIMIZED',
    'DB_INTROSPECTION_REQUESTED',
    'DB_SESSION_CONFIG_UPDATED',
    'TENANT_UPDATE_USER_PERMISSIONS',
    'VAULT_NEEDS_RECOVERY',
    'VAULT_RECOVERED',
    'VAULT_EXPLICIT_RESET',
    'TUNNEL_MTLS_REJECTED',
    'SESSION_BLOCKED',
    'DB_QUERY_RATE_LIMITED',
    'DB_RATE_LIMIT_POLICY_CREATE',
    'DB_RATE_LIMIT_POLICY_UPDATE',
    'DB_RATE_LIMIT_POLICY_DELETE',
    'AI_QUERY_GENERATED'
  ];
  enum_values text;
BEGIN
  DELETE FROM public."Connection"
  WHERE NOT (type::text = ANY (connection_types));

  DELETE FROM public."Connection" c
  USING public."Gateway" g
  WHERE c."gatewayId" = g.id
    AND NOT (g.type::text = ANY (gateway_types));

  DELETE FROM public."Gateway"
  WHERE NOT (type::text = ANY (gateway_types));

  DELETE FROM public."GatewayTemplate"
  WHERE NOT (type::text = ANY (gateway_types));

  DELETE FROM public."AuditLog"
  WHERE NOT (action::text = ANY (audit_actions));

  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'ConnectionType'
      AND NOT (e.enumlabel = ANY (connection_types))
  ) THEN
    ALTER TYPE public."ConnectionType" RENAME TO "ConnectionType_replaced_000026";
    SELECT string_agg(quote_literal(label), ', ')
    INTO enum_values
    FROM unnest(connection_types) AS labels(label);
    EXECUTE format('CREATE TYPE public."ConnectionType" AS ENUM (%s)', enum_values);
    ALTER TABLE public."Connection"
      ALTER COLUMN type TYPE public."ConnectionType"
      USING type::text::public."ConnectionType";
    DROP TYPE public."ConnectionType_replaced_000026";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'GatewayType'
      AND NOT (e.enumlabel = ANY (gateway_types))
  ) THEN
    ALTER TYPE public."GatewayType" RENAME TO "GatewayType_replaced_000026";
    SELECT string_agg(quote_literal(label), ', ')
    INTO enum_values
    FROM unnest(gateway_types) AS labels(label);
    EXECUTE format('CREATE TYPE public."GatewayType" AS ENUM (%s)', enum_values);
    ALTER TABLE public."Gateway"
      ALTER COLUMN type TYPE public."GatewayType"
      USING type::text::public."GatewayType";
    ALTER TABLE public."GatewayTemplate"
      ALTER COLUMN type TYPE public."GatewayType"
      USING type::text::public."GatewayType";
    DROP TYPE public."GatewayType_replaced_000026";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'AuditAction'
      AND NOT (e.enumlabel = ANY (audit_actions))
  ) THEN
    ALTER TYPE public."AuditAction" RENAME TO "AuditAction_replaced_000026";
    SELECT string_agg(quote_literal(label), ', ')
    INTO enum_values
    FROM unnest(audit_actions) AS labels(label);
    EXECUTE format('CREATE TYPE public."AuditAction" AS ENUM (%s)', enum_values);
    ALTER TABLE public."AuditLog"
      ALTER COLUMN action TYPE public."AuditAction"
      USING action::text::public."AuditAction";
    DROP TYPE public."AuditAction_replaced_000026";
  END IF;
END $$;

DO $$
DECLARE
  known_enum_types text[] := ARRAY[
    'AccessPolicyTargetType',
    'AuditAction',
    'AuthProvider',
    'CheckoutStatus',
    'ConnectionType',
    'DbQueryType',
    'ExternalVaultAuthMethod',
    'ExternalVaultType',
    'FirewallAction',
    'GatewayDeploymentMode',
    'GatewayHealthStatus',
    'GatewayType',
    'KeystrokePolicyAction',
    'LoadBalancingStrategy',
    'ManagedInstanceStatus',
    'MaskingStrategy',
    'NotificationType',
    'Permission',
    'RateLimitAction',
    'RecordingStatus',
    'RotationStatus',
    'RotationTargetOS',
    'RotationTrigger',
    'SecretScope',
    'SecretType',
    'SessionProtocol',
    'SessionStatus',
    'SyncProvider',
    'SyncStatus',
    'TeamRole',
    'TenantMembershipStatus',
    'TenantRole'
  ];
  enum_type text;
BEGIN
  FOR enum_type IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
      AND t.typname <> ALL (known_enum_types)
    ORDER BY t.typname
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', enum_type);
  END LOOP;
END $$;

DELETE FROM public.arsenale_schema_migrations
WHERE version > 12
  AND version < 26;
