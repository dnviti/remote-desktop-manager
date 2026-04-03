--
-- PostgreSQL database dump
--


-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AccessPolicyTargetType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AccessPolicyTargetType" AS ENUM (
    'TENANT',
    'TEAM',
    'FOLDER'
);


--
-- Name: AuditAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuditAction" AS ENUM (
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
);


--
-- Name: AuthProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."AuthProvider" AS ENUM (
    'LOCAL',
    'GOOGLE',
    'MICROSOFT',
    'GITHUB',
    'OIDC',
    'SAML',
    'LDAP'
);


--
-- Name: CheckoutStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."CheckoutStatus" AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'EXPIRED',
    'CHECKED_IN'
);


--
-- Name: ConnectionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ConnectionType" AS ENUM (
    'RDP',
    'SSH',
    'VNC',
    'DATABASE',
    'DB_TUNNEL'
);


--
-- Name: DbQueryType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."DbQueryType" AS ENUM (
    'SELECT',
    'INSERT',
    'UPDATE',
    'DELETE',
    'DDL',
    'OTHER'
);


--
-- Name: ExternalVaultAuthMethod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ExternalVaultAuthMethod" AS ENUM (
    'TOKEN',
    'APPROLE',
    'IAM_ACCESS_KEY',
    'IAM_ROLE',
    'CLIENT_CREDENTIALS',
    'MANAGED_IDENTITY',
    'SERVICE_ACCOUNT_KEY',
    'WORKLOAD_IDENTITY',
    'CONJUR_API_KEY',
    'CONJUR_AUTHN_K8S'
);


--
-- Name: ExternalVaultType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ExternalVaultType" AS ENUM (
    'HASHICORP_VAULT',
    'AWS_SECRETS_MANAGER',
    'AZURE_KEY_VAULT',
    'GCP_SECRET_MANAGER',
    'CYBERARK_CONJUR'
);


--
-- Name: FirewallAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."FirewallAction" AS ENUM (
    'BLOCK',
    'ALERT',
    'LOG'
);


--
-- Name: GatewayHealthStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."GatewayHealthStatus" AS ENUM (
    'UNKNOWN',
    'REACHABLE',
    'UNREACHABLE'
);


--
-- Name: GatewayType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."GatewayType" AS ENUM (
    'GUACD',
    'SSH_BASTION',
    'MANAGED_SSH',
    'DB_PROXY'
);


--
-- Name: KeystrokePolicyAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."KeystrokePolicyAction" AS ENUM (
    'BLOCK_AND_TERMINATE',
    'ALERT_ONLY'
);


--
-- Name: LoadBalancingStrategy; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LoadBalancingStrategy" AS ENUM (
    'ROUND_ROBIN',
    'LEAST_CONNECTIONS'
);


--
-- Name: GatewayDeploymentMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."GatewayDeploymentMode" AS ENUM (
    'SINGLE_INSTANCE',
    'MANAGED_GROUP'
);


--
-- Name: ManagedInstanceStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ManagedInstanceStatus" AS ENUM (
    'PROVISIONING',
    'RUNNING',
    'STOPPED',
    'ERROR',
    'REMOVING'
);


--
-- Name: MaskingStrategy; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MaskingStrategy" AS ENUM (
    'REDACT',
    'HASH',
    'PARTIAL'
);


--
-- Name: NotificationType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."NotificationType" AS ENUM (
    'CONNECTION_SHARED',
    'SHARE_PERMISSION_UPDATED',
    'SHARE_REVOKED',
    'SECRET_SHARED',
    'SECRET_SHARE_REVOKED',
    'SECRET_EXPIRING',
    'SECRET_EXPIRED',
    'TENANT_INVITATION',
    'RECORDING_READY',
    'IMPOSSIBLE_TRAVEL_DETECTED',
    'SESSION_TERMINATED_POLICY_VIOLATION',
    'SECRET_CHECKOUT_REQUESTED',
    'SECRET_CHECKOUT_APPROVED',
    'SECRET_CHECKOUT_DENIED',
    'SECRET_CHECKOUT_EXPIRED',
    'LATERAL_MOVEMENT_ALERT',
    'TENANT_VAULT_KEY_RECEIVED'
);


--
-- Name: Permission; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."Permission" AS ENUM (
    'READ_ONLY',
    'FULL_ACCESS'
);


--
-- Name: RateLimitAction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RateLimitAction" AS ENUM (
    'REJECT',
    'LOG_ONLY'
);


--
-- Name: RecordingStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RecordingStatus" AS ENUM (
    'RECORDING',
    'COMPLETE',
    'ERROR'
);


--
-- Name: RotationStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RotationStatus" AS ENUM (
    'SUCCESS',
    'FAILED',
    'PENDING'
);


--
-- Name: RotationTargetOS; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RotationTargetOS" AS ENUM (
    'LINUX',
    'WINDOWS'
);


--
-- Name: RotationTrigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RotationTrigger" AS ENUM (
    'SCHEDULED',
    'CHECKIN',
    'MANUAL'
);


--
-- Name: SecretScope; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SecretScope" AS ENUM (
    'PERSONAL',
    'TEAM',
    'TENANT'
);


--
-- Name: SecretType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SecretType" AS ENUM (
    'LOGIN',
    'SSH_KEY',
    'CERTIFICATE',
    'API_KEY',
    'SECURE_NOTE'
);


--
-- Name: SessionProtocol; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionProtocol" AS ENUM (
    'SSH',
    'RDP',
    'VNC',
    'SSH_PROXY',
    'DATABASE',
    'DB_TUNNEL'
);


--
-- Name: SessionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionStatus" AS ENUM (
    'ACTIVE',
    'IDLE',
    'CLOSED'
);


--
-- Name: SyncProvider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncProvider" AS ENUM (
    'NETBOX'
);


--
-- Name: SyncStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SyncStatus" AS ENUM (
    'PENDING',
    'RUNNING',
    'SUCCESS',
    'PARTIAL',
    'ERROR'
);


--
-- Name: TeamRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TeamRole" AS ENUM (
    'TEAM_ADMIN',
    'TEAM_EDITOR',
    'TEAM_VIEWER'
);


--
-- Name: TenantMembershipStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TenantMembershipStatus" AS ENUM (
    'PENDING',
    'ACCEPTED'
);


--
-- Name: TenantRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."TenantRole" AS ENUM (
    'OWNER',
    'ADMIN',
    'MEMBER',
    'OPERATOR',
    'CONSULTANT',
    'AUDITOR',
    'GUEST'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AccessPolicy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AccessPolicy" (
    id text NOT NULL,
    "targetType" public."AccessPolicyTargetType" NOT NULL,
    "targetId" text NOT NULL,
    "allowedTimeWindows" text,
    "requireTrustedDevice" boolean DEFAULT false NOT NULL,
    "requireMfaStepUp" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ActiveSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ActiveSession" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "connectionId" text NOT NULL,
    "gatewayId" text,
    protocol public."SessionProtocol" NOT NULL,
    status public."SessionStatus" DEFAULT 'ACTIVE'::public."SessionStatus" NOT NULL,
    "socketId" text,
    "guacTokenHash" text,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastActivityAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "endedAt" timestamp(3) without time zone,
    metadata jsonb,
    "instanceId" text,
    "ipAddress" text
);


--
-- Name: AiDailyUsage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AiDailyUsage" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    date date NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AppConfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AppConfig" (
    key text NOT NULL,
    value text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."AuditLog" (
    id text NOT NULL,
    "userId" text,
    action public."AuditAction" NOT NULL,
    "targetType" text,
    "targetId" text,
    details jsonb,
    "ipAddress" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "gatewayId" text,
    "geoCity" text,
    "geoCoords" double precision[] DEFAULT ARRAY[]::double precision[],
    "geoCountry" text,
    flags text[] DEFAULT ARRAY[]::text[]
);


--
-- Name: Connection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Connection" (
    id text NOT NULL,
    name text NOT NULL,
    type public."ConnectionType" NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    "folderId" text,
    "encryptedUsername" text,
    "usernameIV" text,
    "usernameTag" text,
    "encryptedPassword" text,
    "passwordIV" text,
    "passwordTag" text,
    description text,
    "userId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "enableDrive" boolean DEFAULT false NOT NULL,
    "gatewayId" text,
    "isFavorite" boolean DEFAULT false NOT NULL,
    "rdpSettings" jsonb,
    "sshTerminalConfig" jsonb,
    "teamId" text,
    "credentialSecretId" text,
    "domainIV" text,
    "domainTag" text,
    "encryptedDomain" text,
    "defaultCredentialMode" text,
    "vncSettings" jsonb,
    "dlpPolicy" jsonb,
    "externalVaultProviderId" text,
    "externalVaultPath" text,
    "syncProfileId" text,
    "externalId" text,
    "dbSettings" jsonb,
    "bastionConnectionId" text,
    "targetDbHost" text,
    "targetDbPort" integer,
    "dbType" text
);


--
-- Name: DbAuditLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DbAuditLog" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "connectionId" text NOT NULL,
    "tenantId" text,
    "queryText" text NOT NULL,
    "queryType" public."DbQueryType" NOT NULL,
    "tablesAccessed" text[] DEFAULT ARRAY[]::text[],
    "rowsAffected" integer,
    "executionTimeMs" integer,
    blocked boolean DEFAULT false NOT NULL,
    "blockReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "executionPlan" jsonb
);


--
-- Name: DbFirewallRule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DbFirewallRule" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    pattern text NOT NULL,
    action public."FirewallAction" NOT NULL,
    scope text,
    description text,
    enabled boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DbMaskingPolicy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DbMaskingPolicy" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "columnPattern" text NOT NULL,
    strategy public."MaskingStrategy" NOT NULL,
    "exemptRoles" text[] DEFAULT ARRAY[]::text[],
    scope text,
    description text,
    enabled boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DbRateLimitPolicy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DbRateLimitPolicy" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "queryType" public."DbQueryType",
    "windowMs" integer DEFAULT 60000 NOT NULL,
    "maxQueries" integer DEFAULT 100 NOT NULL,
    "burstMax" integer DEFAULT 10 NOT NULL,
    "exemptRoles" text[] DEFAULT ARRAY[]::text[],
    scope text,
    action public."RateLimitAction" DEFAULT 'REJECT'::public."RateLimitAction" NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: DeviceAuthCode; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."DeviceAuthCode" (
    id text NOT NULL,
    "deviceCode" text NOT NULL,
    "userCode" text NOT NULL,
    "userId" text,
    authorized boolean DEFAULT false NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "interval" integer DEFAULT 5 NOT NULL,
    "clientId" text DEFAULT 'arsenale-cli'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ExternalSecretShare; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExternalSecretShare" (
    id text NOT NULL,
    "secretId" text NOT NULL,
    "createdByUserId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "encryptedData" text NOT NULL,
    "dataIV" text NOT NULL,
    "dataTag" text NOT NULL,
    "hasPin" boolean DEFAULT false NOT NULL,
    "pinSalt" text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "maxAccessCount" integer,
    "accessCount" integer DEFAULT 0 NOT NULL,
    "secretType" public."SecretType" NOT NULL,
    "secretName" text NOT NULL,
    "isRevoked" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "tokenSalt" text
);


--
-- Name: ExternalVaultProvider; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ExternalVaultProvider" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "serverUrl" text NOT NULL,
    "authMethod" public."ExternalVaultAuthMethod" NOT NULL,
    namespace text,
    "mountPath" text DEFAULT 'secret'::text NOT NULL,
    "encryptedAuthPayload" text NOT NULL,
    "authPayloadIV" text NOT NULL,
    "authPayloadTag" text NOT NULL,
    "caCertificate" text,
    "cacheTtlSeconds" integer DEFAULT 300 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "providerType" public."ExternalVaultType" DEFAULT 'HASHICORP_VAULT'::public."ExternalVaultType" NOT NULL
);


--
-- Name: Folder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Folder" (
    id text NOT NULL,
    name text NOT NULL,
    "parentId" text,
    "userId" text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "teamId" text
);


--
-- Name: Gateway; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Gateway" (
    id text NOT NULL,
    name text NOT NULL,
    type public."GatewayType" NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    "deploymentMode" public."GatewayDeploymentMode" DEFAULT 'SINGLE_INSTANCE'::public."GatewayDeploymentMode" NOT NULL,
    description text,
    "isDefault" boolean DEFAULT false NOT NULL,
    "tenantId" text NOT NULL,
    "createdById" text NOT NULL,
    "encryptedUsername" text,
    "usernameIV" text,
    "usernameTag" text,
    "encryptedPassword" text,
    "passwordIV" text,
    "passwordTag" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lastCheckedAt" timestamp(3) without time zone,
    "lastError" text,
    "lastHealthStatus" public."GatewayHealthStatus" DEFAULT 'UNKNOWN'::public."GatewayHealthStatus" NOT NULL,
    "lastLatencyMs" integer,
    "monitorIntervalMs" integer DEFAULT 5000 NOT NULL,
    "monitoringEnabled" boolean DEFAULT true NOT NULL,
    "encryptedSshKey" text,
    "sshKeyIV" text,
    "sshKeyTag" text,
    "apiPort" integer,
    "inactivityTimeoutSeconds" integer DEFAULT 3600 NOT NULL,
    "desiredReplicas" integer DEFAULT 1 NOT NULL,
    "isManaged" boolean DEFAULT false NOT NULL,
    "autoScale" boolean DEFAULT false NOT NULL,
    "lastScaleAction" timestamp(3) without time zone,
    "maxReplicas" integer DEFAULT 5 NOT NULL,
    "minReplicas" integer DEFAULT 1 NOT NULL,
    "scaleDownCooldownSeconds" integer DEFAULT 300 NOT NULL,
    "sessionsPerInstance" integer DEFAULT 10 NOT NULL,
    "templateId" text,
    "publishPorts" boolean DEFAULT false NOT NULL,
    "lbStrategy" public."LoadBalancingStrategy" DEFAULT 'ROUND_ROBIN'::public."LoadBalancingStrategy" NOT NULL,
    "tunnelEnabled" boolean DEFAULT false NOT NULL,
    "encryptedTunnelToken" text,
    "tunnelTokenIV" text,
    "tunnelTokenTag" text,
    "tunnelTokenHash" text,
    "tunnelConnectedAt" timestamp(3) without time zone,
    "tunnelLastHeartbeat" timestamp(3) without time zone,
    "tunnelClientVersion" text,
    "tunnelClientIp" text,
    "tunnelClientCert" text,
    "tunnelClientCertExp" timestamp(3) without time zone,
    "tunnelClientKey" text,
    "tunnelClientKeyIV" text,
    "tunnelClientKeyTag" text
);


--
-- Name: GatewayTemplate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."GatewayTemplate" (
    id text NOT NULL,
    name text NOT NULL,
    type public."GatewayType" NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    "deploymentMode" public."GatewayDeploymentMode" DEFAULT 'SINGLE_INSTANCE'::public."GatewayDeploymentMode" NOT NULL,
    description text,
    "apiPort" integer,
    "autoScale" boolean DEFAULT false NOT NULL,
    "minReplicas" integer DEFAULT 1 NOT NULL,
    "maxReplicas" integer DEFAULT 5 NOT NULL,
    "sessionsPerInstance" integer DEFAULT 10 NOT NULL,
    "scaleDownCooldownSeconds" integer DEFAULT 300 NOT NULL,
    "monitoringEnabled" boolean DEFAULT true NOT NULL,
    "monitorIntervalMs" integer DEFAULT 5000 NOT NULL,
    "inactivityTimeoutSeconds" integer DEFAULT 3600 NOT NULL,
    "tenantId" text NOT NULL,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "publishPorts" boolean DEFAULT false NOT NULL,
    "lbStrategy" public."LoadBalancingStrategy" DEFAULT 'ROUND_ROBIN'::public."LoadBalancingStrategy" NOT NULL
);


--
-- Name: KeystrokePolicy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KeystrokePolicy" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    description text,
    action public."KeystrokePolicyAction" NOT NULL,
    "regexPatterns" text[],
    enabled boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: ManagedGatewayInstance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ManagedGatewayInstance" (
    id text NOT NULL,
    "gatewayId" text NOT NULL,
    "containerId" text NOT NULL,
    "containerName" text NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    status public."ManagedInstanceStatus" DEFAULT 'PROVISIONING'::public."ManagedInstanceStatus" NOT NULL,
    "orchestratorType" text NOT NULL,
    "healthStatus" text,
    "lastHealthCheck" timestamp(3) without time zone,
    "errorMessage" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "consecutiveFailures" integer DEFAULT 0 NOT NULL,
    "apiPort" integer,
    "tunnelProxyHost" text,
    "tunnelProxyPort" integer
);


--
-- Name: Notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Notification" (
    id text NOT NULL,
    "userId" text NOT NULL,
    type public."NotificationType" NOT NULL,
    message text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    "relatedId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: NotificationPreference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."NotificationPreference" (
    id text NOT NULL,
    "userId" text NOT NULL,
    type public."NotificationType" NOT NULL,
    "inApp" boolean DEFAULT true NOT NULL,
    email boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: OAuthAccount; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OAuthAccount" (
    id text NOT NULL,
    "userId" text NOT NULL,
    provider public."AuthProvider" NOT NULL,
    "providerUserId" text NOT NULL,
    "providerEmail" text,
    "accessToken" text,
    "refreshToken" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "samlAttributes" jsonb
);


--
-- Name: OpenTab; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OpenTab" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "connectionId" text NOT NULL,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PasswordRotationLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PasswordRotationLog" (
    id text NOT NULL,
    "secretId" text NOT NULL,
    status public."RotationStatus" NOT NULL,
    trigger public."RotationTrigger" NOT NULL,
    "targetOS" public."RotationTargetOS" NOT NULL,
    "targetHost" text NOT NULL,
    "targetUser" text NOT NULL,
    "errorMessage" text,
    "durationMs" integer,
    "initiatedBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: PendingVaultKeyDistribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PendingVaultKeyDistribution" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "targetUserId" text NOT NULL,
    "encryptedTenantVaultKey" text NOT NULL,
    "tenantVaultKeyIV" text NOT NULL,
    "tenantVaultKeyTag" text NOT NULL,
    "distributorUserId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: RefreshToken; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."RefreshToken" (
    id text NOT NULL,
    token text NOT NULL,
    "userId" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "revokedAt" timestamp(3) without time zone,
    "tokenFamily" text NOT NULL,
    "ipUaHash" text,
    "familyCreatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SecretCheckoutRequest; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SecretCheckoutRequest" (
    id text NOT NULL,
    "secretId" text,
    "connectionId" text,
    "requesterId" text NOT NULL,
    "approverId" text,
    status public."CheckoutStatus" DEFAULT 'PENDING'::public."CheckoutStatus" NOT NULL,
    "durationMinutes" integer NOT NULL,
    reason text,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SessionRecording; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SessionRecording" (
    id text NOT NULL,
    "sessionId" text,
    "userId" text NOT NULL,
    "connectionId" text NOT NULL,
    protocol public."SessionProtocol" NOT NULL,
    "filePath" text NOT NULL,
    "fileSize" integer,
    duration integer,
    format text DEFAULT 'asciicast'::text NOT NULL,
    status public."RecordingStatus" DEFAULT 'RECORDING'::public."RecordingStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    height integer,
    width integer
);


--
-- Name: SharedConnection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SharedConnection" (
    id text NOT NULL,
    "connectionId" text NOT NULL,
    "sharedWithUserId" text NOT NULL,
    "sharedByUserId" text NOT NULL,
    permission public."Permission" NOT NULL,
    "encryptedUsername" text,
    "usernameIV" text,
    "usernameTag" text,
    "encryptedPassword" text,
    "passwordIV" text,
    "passwordTag" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "domainIV" text,
    "domainTag" text,
    "encryptedDomain" text
);


--
-- Name: SharedSecret; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SharedSecret" (
    id text NOT NULL,
    "secretId" text NOT NULL,
    "sharedWithUserId" text NOT NULL,
    "sharedByUserId" text NOT NULL,
    permission public."Permission" NOT NULL,
    "encryptedData" text NOT NULL,
    "dataIV" text NOT NULL,
    "dataTag" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SshKeyPair; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SshKeyPair" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "encryptedPrivateKey" text NOT NULL,
    "privateKeyIV" text NOT NULL,
    "privateKeyTag" text NOT NULL,
    "publicKey" text NOT NULL,
    fingerprint text NOT NULL,
    algorithm text DEFAULT 'ed25519'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "autoRotateEnabled" boolean DEFAULT false NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "lastAutoRotatedAt" timestamp(3) without time zone,
    "rotationIntervalDays" integer DEFAULT 90 NOT NULL
);


--
-- Name: SyncLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SyncLog" (
    id text NOT NULL,
    "syncProfileId" text NOT NULL,
    status public."SyncStatus" NOT NULL,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    details jsonb,
    "triggeredBy" text NOT NULL
);


--
-- Name: SyncProfile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SyncProfile" (
    id text NOT NULL,
    name text NOT NULL,
    "tenantId" text NOT NULL,
    provider public."SyncProvider" NOT NULL,
    config jsonb NOT NULL,
    "encryptedApiToken" text NOT NULL,
    "apiTokenIV" text NOT NULL,
    "apiTokenTag" text NOT NULL,
    "cronExpression" text,
    enabled boolean DEFAULT true NOT NULL,
    "teamId" text,
    "lastSyncAt" timestamp(3) without time zone,
    "lastSyncStatus" public."SyncStatus",
    "lastSyncDetails" jsonb,
    "createdById" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: SystemSecret; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SystemSecret" (
    id text NOT NULL,
    name text NOT NULL,
    "currentVersion" integer DEFAULT 1 NOT NULL,
    "encryptedValue" text NOT NULL,
    "valueIV" text NOT NULL,
    "valueTag" text NOT NULL,
    "previousEncryptedValue" text,
    "previousValueIV" text,
    "previousValueTag" text,
    "rotatedAt" timestamp(3) without time zone,
    "autoRotate" boolean DEFAULT true NOT NULL,
    "rotationIntervalDays" integer DEFAULT 90 NOT NULL,
    distributed boolean DEFAULT false NOT NULL,
    "targetService" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: Team; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Team" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "tenantId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TeamMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TeamMember" (
    id text NOT NULL,
    "teamId" text NOT NULL,
    "userId" text NOT NULL,
    role public."TeamRole" NOT NULL,
    "encryptedTeamVaultKey" text,
    "teamVaultKeyIV" text,
    "teamVaultKeyTag" text,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "expiresAt" timestamp(3) without time zone
);


--
-- Name: Tenant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Tenant" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "hasTenantVaultKey" boolean DEFAULT false NOT NULL,
    "defaultSessionTimeoutSeconds" integer DEFAULT 3600 NOT NULL,
    "mfaRequired" boolean DEFAULT false NOT NULL,
    "vaultAutoLockMaxMinutes" integer,
    "dlpDisableCopy" boolean DEFAULT false NOT NULL,
    "dlpDisablePaste" boolean DEFAULT false NOT NULL,
    "dlpDisableDownload" boolean DEFAULT false NOT NULL,
    "dlpDisableUpload" boolean DEFAULT false NOT NULL,
    "ipAllowlistEnabled" boolean DEFAULT false NOT NULL,
    "ipAllowlistMode" text DEFAULT 'flag'::text NOT NULL,
    "ipAllowlistEntries" text[] DEFAULT ARRAY[]::text[],
    "enforcedConnectionSettings" jsonb,
    "maxConcurrentSessions" integer DEFAULT 0 NOT NULL,
    "absoluteSessionTimeoutSeconds" integer DEFAULT 43200 NOT NULL,
    "tunnelDefaultEnabled" boolean DEFAULT false NOT NULL,
    "tunnelAutoTokenRotation" boolean DEFAULT false NOT NULL,
    "tunnelTokenRotationDays" integer DEFAULT 90 NOT NULL,
    "tunnelRequireForRemote" boolean DEFAULT false NOT NULL,
    "tunnelTokenMaxLifetimeDays" integer,
    "tunnelAgentAllowedCidrs" text[] DEFAULT ARRAY[]::text[],
    "loginRateLimitWindowMs" integer,
    "loginRateLimitMaxAttempts" integer,
    "accountLockoutThreshold" integer,
    "accountLockoutDurationMs" integer,
    "impossibleTravelSpeedKmh" integer,
    "jwtExpiresInSeconds" integer,
    "jwtRefreshExpiresInSeconds" integer,
    "vaultDefaultTtlMinutes" integer,
    "fileUploadMaxSizeBytes" integer,
    "recordingEnabled" boolean DEFAULT true NOT NULL,
    "recordingRetentionDays" integer,
    "tunnelCaCert" text,
    "tunnelCaCertFingerprint" text,
    "tunnelCaKey" text,
    "tunnelCaKeyIV" text,
    "tunnelCaKeyTag" text,
    "userDriveQuotaBytes" integer
);


--
-- Name: TenantAiConfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TenantAiConfig" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    provider text DEFAULT 'none'::text NOT NULL,
    "encryptedApiKey" text,
    "apiKeyIV" text,
    "apiKeyTag" text,
    "modelId" text DEFAULT 'claude-sonnet-4-20250514'::text NOT NULL,
    "baseUrl" text,
    "maxTokensPerRequest" integer DEFAULT 4000 NOT NULL,
    "dailyRequestLimit" integer DEFAULT 100 NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: TenantMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TenantMember" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "userId" text NOT NULL,
    role public."TenantRole" DEFAULT 'MEMBER'::public."TenantRole" NOT NULL,
    "isActive" boolean DEFAULT false NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "permissionOverrides" jsonb,
    status public."TenantMembershipStatus" DEFAULT 'ACCEPTED'::public."TenantMembershipStatus" NOT NULL
);


--
-- Name: TenantVaultMember; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TenantVaultMember" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "userId" text NOT NULL,
    "encryptedTenantVaultKey" text NOT NULL,
    "tenantVaultKeyIV" text NOT NULL,
    "tenantVaultKeyTag" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    "passwordHash" text,
    "vaultSalt" text,
    "encryptedVaultKey" text,
    "vaultKeyIV" text,
    "vaultKeyTag" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "avatarData" text,
    "emailVerified" boolean DEFAULT false NOT NULL,
    "emailVerifyExpiry" timestamp(3) without time zone,
    "emailVerifyToken" text,
    "phoneNumber" text,
    "phoneVerified" boolean DEFAULT false NOT NULL,
    "rdpDefaults" jsonb,
    "smsMfaEnabled" boolean DEFAULT false NOT NULL,
    "smsOtpExpiresAt" timestamp(3) without time zone,
    "smsOtpHash" text,
    "sshDefaults" jsonb,
    "totpEnabled" boolean DEFAULT false NOT NULL,
    "totpSecret" text,
    username text,
    "vaultSetupComplete" boolean DEFAULT true NOT NULL,
    "failedLoginAttempts" integer DEFAULT 0 NOT NULL,
    "lockedUntil" timestamp(3) without time zone,
    "encryptedTotpSecret" text,
    "totpSecretIV" text,
    "totpSecretTag" text,
    "webauthnEnabled" boolean DEFAULT false NOT NULL,
    "vaultAutoLockMinutes" integer,
    enabled boolean DEFAULT true NOT NULL,
    "encryptedVaultRecoveryKey" text,
    "passwordResetExpiry" timestamp(3) without time zone,
    "passwordResetTokenHash" text,
    "vaultRecoveryKeyIV" text,
    "vaultRecoveryKeySalt" text,
    "vaultRecoveryKeyTag" text,
    "domainName" text,
    "domainPasswordIV" text,
    "domainPasswordTag" text,
    "domainUsername" text,
    "emailChangeCodeNewHash" text,
    "emailChangeCodeOldHash" text,
    "emailChangeExpiry" timestamp(3) without time zone,
    "encryptedDomainPassword" text,
    "pendingEmail" text,
    "notifDndEnabled" boolean DEFAULT false NOT NULL,
    "notifQuietHoursStart" text,
    "notifQuietHoursEnd" text,
    "notifQuietHoursTimezone" text,
    "vaultNeedsRecovery" boolean DEFAULT false NOT NULL
);


--
-- Name: VaultFolder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VaultFolder" (
    id text NOT NULL,
    name text NOT NULL,
    "parentId" text,
    "userId" text NOT NULL,
    scope public."SecretScope" NOT NULL,
    "teamId" text,
    "tenantId" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: VaultSecret; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VaultSecret" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    type public."SecretType" NOT NULL,
    scope public."SecretScope" NOT NULL,
    "userId" text NOT NULL,
    "teamId" text,
    "tenantId" text,
    "folderId" text,
    "encryptedData" text NOT NULL,
    "dataIV" text NOT NULL,
    "dataTag" text NOT NULL,
    metadata jsonb,
    tags text[] DEFAULT ARRAY[]::text[],
    "isFavorite" boolean DEFAULT false NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "currentVersion" integer DEFAULT 1 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "targetRotationEnabled" boolean DEFAULT false NOT NULL,
    "rotationIntervalDays" integer DEFAULT 30 NOT NULL,
    "lastRotatedAt" timestamp(3) without time zone,
    "pwnedCount" integer DEFAULT 0 NOT NULL
);


--
-- Name: VaultSecretVersion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."VaultSecretVersion" (
    id text NOT NULL,
    "secretId" text NOT NULL,
    version integer NOT NULL,
    "encryptedData" text NOT NULL,
    "dataIV" text NOT NULL,
    "dataTag" text NOT NULL,
    "changedBy" text NOT NULL,
    "changeNote" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: WebAuthnCredential; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."WebAuthnCredential" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "credentialId" text NOT NULL,
    "publicKey" text NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    transports text[] DEFAULT ARRAY[]::text[],
    "deviceType" text,
    "backedUp" boolean DEFAULT false NOT NULL,
    "friendlyName" text DEFAULT 'Security Key'::text NOT NULL,
    aaguid text,
    "lastUsedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id text NOT NULL,
    tenant_id text NOT NULL,
    definition_id text NOT NULL,
    trigger text DEFAULT ''::text NOT NULL,
    goals jsonb DEFAULT '[]'::jsonb NOT NULL,
    requested_capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL,
    requires_approval boolean DEFAULT false NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    last_transition_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_items (
    id text NOT NULL,
    namespace_key text NOT NULL,
    content text NOT NULL,
    summary text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: memory_namespaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memory_namespaces (
    id text NOT NULL,
    namespace_key text NOT NULL,
    tenant_id text NOT NULL,
    scope text NOT NULL,
    principal_id text DEFAULT ''::text NOT NULL,
    agent_id text DEFAULT ''::text NOT NULL,
    run_id text DEFAULT ''::text NOT NULL,
    workflow_id text DEFAULT ''::text NOT NULL,
    memory_type text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: orchestrator_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orchestrator_connections (
    id text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL,
    scope text NOT NULL,
    endpoint text NOT NULL,
    namespace text DEFAULT ''::text NOT NULL,
    labels jsonb DEFAULT '{}'::jsonb NOT NULL,
    capabilities jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: AccessPolicy AccessPolicy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AccessPolicy"
    ADD CONSTRAINT "AccessPolicy_pkey" PRIMARY KEY (id);


--
-- Name: ActiveSession ActiveSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ActiveSession"
    ADD CONSTRAINT "ActiveSession_pkey" PRIMARY KEY (id);


--
-- Name: AiDailyUsage AiDailyUsage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AiDailyUsage"
    ADD CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY (id);


--
-- Name: AiDailyUsage AiDailyUsage_tenantId_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AiDailyUsage"
    ADD CONSTRAINT "AiDailyUsage_tenantId_date_key" UNIQUE ("tenantId", date);


--
-- Name: AppConfig AppConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AppConfig"
    ADD CONSTRAINT "AppConfig_pkey" PRIMARY KEY (key);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: Connection Connection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_pkey" PRIMARY KEY (id);


--
-- Name: DbAuditLog DbAuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DbAuditLog"
    ADD CONSTRAINT "DbAuditLog_pkey" PRIMARY KEY (id);


--
-- Name: DbFirewallRule DbFirewallRule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DbFirewallRule"
    ADD CONSTRAINT "DbFirewallRule_pkey" PRIMARY KEY (id);


--
-- Name: DbMaskingPolicy DbMaskingPolicy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DbMaskingPolicy"
    ADD CONSTRAINT "DbMaskingPolicy_pkey" PRIMARY KEY (id);


--
-- Name: DbRateLimitPolicy DbRateLimitPolicy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DbRateLimitPolicy"
    ADD CONSTRAINT "DbRateLimitPolicy_pkey" PRIMARY KEY (id);


--
-- Name: DeviceAuthCode DeviceAuthCode_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DeviceAuthCode"
    ADD CONSTRAINT "DeviceAuthCode_pkey" PRIMARY KEY (id);


--
-- Name: ExternalSecretShare ExternalSecretShare_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExternalSecretShare"
    ADD CONSTRAINT "ExternalSecretShare_pkey" PRIMARY KEY (id);


--
-- Name: ExternalVaultProvider ExternalVaultProvider_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExternalVaultProvider"
    ADD CONSTRAINT "ExternalVaultProvider_pkey" PRIMARY KEY (id);


--
-- Name: Folder Folder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_pkey" PRIMARY KEY (id);


--
-- Name: GatewayTemplate GatewayTemplate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GatewayTemplate"
    ADD CONSTRAINT "GatewayTemplate_pkey" PRIMARY KEY (id);


--
-- Name: Gateway Gateway_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Gateway"
    ADD CONSTRAINT "Gateway_pkey" PRIMARY KEY (id);


--
-- Name: KeystrokePolicy KeystrokePolicy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KeystrokePolicy"
    ADD CONSTRAINT "KeystrokePolicy_pkey" PRIMARY KEY (id);


--
-- Name: ManagedGatewayInstance ManagedGatewayInstance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ManagedGatewayInstance"
    ADD CONSTRAINT "ManagedGatewayInstance_pkey" PRIMARY KEY (id);


--
-- Name: NotificationPreference NotificationPreference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY (id);


--
-- Name: Notification Notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id);


--
-- Name: OAuthAccount OAuthAccount_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthAccount"
    ADD CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY (id);


--
-- Name: OpenTab OpenTab_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OpenTab"
    ADD CONSTRAINT "OpenTab_pkey" PRIMARY KEY (id);


--
-- Name: PasswordRotationLog PasswordRotationLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PasswordRotationLog"
    ADD CONSTRAINT "PasswordRotationLog_pkey" PRIMARY KEY (id);


--
-- Name: PendingVaultKeyDistribution PendingVaultKeyDistribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PendingVaultKeyDistribution"
    ADD CONSTRAINT "PendingVaultKeyDistribution_pkey" PRIMARY KEY (id);


--
-- Name: RefreshToken RefreshToken_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_pkey" PRIMARY KEY (id);


--
-- Name: SecretCheckoutRequest SecretCheckoutRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SecretCheckoutRequest"
    ADD CONSTRAINT "SecretCheckoutRequest_pkey" PRIMARY KEY (id);


--
-- Name: SessionRecording SessionRecording_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionRecording"
    ADD CONSTRAINT "SessionRecording_pkey" PRIMARY KEY (id);


--
-- Name: SharedConnection SharedConnection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedConnection"
    ADD CONSTRAINT "SharedConnection_pkey" PRIMARY KEY (id);


--
-- Name: SharedSecret SharedSecret_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedSecret"
    ADD CONSTRAINT "SharedSecret_pkey" PRIMARY KEY (id);


--
-- Name: SshKeyPair SshKeyPair_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SshKeyPair"
    ADD CONSTRAINT "SshKeyPair_pkey" PRIMARY KEY (id);


--
-- Name: SyncLog SyncLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncLog"
    ADD CONSTRAINT "SyncLog_pkey" PRIMARY KEY (id);


--
-- Name: SyncProfile SyncProfile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncProfile"
    ADD CONSTRAINT "SyncProfile_pkey" PRIMARY KEY (id);


--
-- Name: SystemSecret SystemSecret_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SystemSecret"
    ADD CONSTRAINT "SystemSecret_pkey" PRIMARY KEY (id);


--
-- Name: TeamMember TeamMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_pkey" PRIMARY KEY (id);


--
-- Name: Team Team_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_pkey" PRIMARY KEY (id);


--
-- Name: TenantAiConfig TenantAiConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantAiConfig"
    ADD CONSTRAINT "TenantAiConfig_pkey" PRIMARY KEY (id);


--
-- Name: TenantAiConfig TenantAiConfig_tenantId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantAiConfig"
    ADD CONSTRAINT "TenantAiConfig_tenantId_key" UNIQUE ("tenantId");


--
-- Name: TenantMember TenantMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantMember"
    ADD CONSTRAINT "TenantMember_pkey" PRIMARY KEY (id);


--
-- Name: TenantVaultMember TenantVaultMember_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantVaultMember"
    ADD CONSTRAINT "TenantVaultMember_pkey" PRIMARY KEY (id);


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: VaultFolder VaultFolder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultFolder"
    ADD CONSTRAINT "VaultFolder_pkey" PRIMARY KEY (id);


--
-- Name: VaultSecretVersion VaultSecretVersion_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecretVersion"
    ADD CONSTRAINT "VaultSecretVersion_pkey" PRIMARY KEY (id);


--
-- Name: VaultSecret VaultSecret_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecret"
    ADD CONSTRAINT "VaultSecret_pkey" PRIMARY KEY (id);


--
-- Name: WebAuthnCredential WebAuthnCredential_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebAuthnCredential"
    ADD CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: memory_items memory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_items
    ADD CONSTRAINT memory_items_pkey PRIMARY KEY (id);


--
-- Name: memory_namespaces memory_namespaces_namespace_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_namespaces
    ADD CONSTRAINT memory_namespaces_namespace_key_key UNIQUE (namespace_key);


--
-- Name: memory_namespaces memory_namespaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_namespaces
    ADD CONSTRAINT memory_namespaces_pkey PRIMARY KEY (id);


--
-- Name: orchestrator_connections orchestrator_connections_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_connections
    ADD CONSTRAINT orchestrator_connections_name_key UNIQUE (name);


--
-- Name: orchestrator_connections orchestrator_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orchestrator_connections
    ADD CONSTRAINT orchestrator_connections_pkey PRIMARY KEY (id);


--
-- Name: AccessPolicy_targetType_targetId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AccessPolicy_targetType_targetId_idx" ON public."AccessPolicy" USING btree ("targetType", "targetId");


--
-- Name: ActiveSession_gatewayId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_gatewayId_status_idx" ON public."ActiveSession" USING btree ("gatewayId", status);


--
-- Name: ActiveSession_guacTokenHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_guacTokenHash_idx" ON public."ActiveSession" USING btree ("guacTokenHash");


--
-- Name: ActiveSession_instanceId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_instanceId_status_idx" ON public."ActiveSession" USING btree ("instanceId", status);


--
-- Name: ActiveSession_lastActivityAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_lastActivityAt_idx" ON public."ActiveSession" USING btree ("lastActivityAt");


--
-- Name: ActiveSession_protocol_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_protocol_status_idx" ON public."ActiveSession" USING btree (protocol, status);


--
-- Name: ActiveSession_socketId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_socketId_idx" ON public."ActiveSession" USING btree ("socketId");


--
-- Name: ActiveSession_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_status_idx" ON public."ActiveSession" USING btree (status);


--
-- Name: ActiveSession_userId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ActiveSession_userId_status_idx" ON public."ActiveSession" USING btree ("userId", status);


--
-- Name: AiDailyUsage_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AiDailyUsage_date_idx" ON public."AiDailyUsage" USING btree (date);


--
-- Name: AuditLog_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_action_idx" ON public."AuditLog" USING btree (action);


--
-- Name: AuditLog_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_createdAt_idx" ON public."AuditLog" USING btree ("createdAt");


--
-- Name: AuditLog_gatewayId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_gatewayId_idx" ON public."AuditLog" USING btree ("gatewayId");


--
-- Name: AuditLog_geoCountry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_geoCountry_idx" ON public."AuditLog" USING btree ("geoCountry");


--
-- Name: AuditLog_targetId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_targetId_createdAt_idx" ON public."AuditLog" USING btree ("targetId", "createdAt");


--
-- Name: AuditLog_userId_action_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_userId_action_createdAt_idx" ON public."AuditLog" USING btree ("userId", action, "createdAt");


--
-- Name: AuditLog_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "AuditLog_userId_idx" ON public."AuditLog" USING btree ("userId");


--
-- Name: Connection_syncProfileId_externalId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Connection_syncProfileId_externalId_idx" ON public."Connection" USING btree ("syncProfileId", "externalId");


--
-- Name: DbAuditLog_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbAuditLog_blocked_idx" ON public."DbAuditLog" USING btree (blocked);


--
-- Name: DbAuditLog_connectionId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbAuditLog_connectionId_createdAt_idx" ON public."DbAuditLog" USING btree ("connectionId", "createdAt");


--
-- Name: DbAuditLog_queryType_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbAuditLog_queryType_idx" ON public."DbAuditLog" USING btree ("queryType");


--
-- Name: DbAuditLog_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbAuditLog_tenantId_createdAt_idx" ON public."DbAuditLog" USING btree ("tenantId", "createdAt");


--
-- Name: DbAuditLog_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbAuditLog_userId_createdAt_idx" ON public."DbAuditLog" USING btree ("userId", "createdAt");


--
-- Name: DbFirewallRule_tenantId_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbFirewallRule_tenantId_enabled_idx" ON public."DbFirewallRule" USING btree ("tenantId", enabled);


--
-- Name: DbFirewallRule_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbFirewallRule_tenantId_idx" ON public."DbFirewallRule" USING btree ("tenantId");


--
-- Name: DbMaskingPolicy_tenantId_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbMaskingPolicy_tenantId_enabled_idx" ON public."DbMaskingPolicy" USING btree ("tenantId", enabled);


--
-- Name: DbMaskingPolicy_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbMaskingPolicy_tenantId_idx" ON public."DbMaskingPolicy" USING btree ("tenantId");


--
-- Name: DbRateLimitPolicy_tenantId_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbRateLimitPolicy_tenantId_enabled_idx" ON public."DbRateLimitPolicy" USING btree ("tenantId", enabled);


--
-- Name: DbRateLimitPolicy_tenantId_queryType_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DbRateLimitPolicy_tenantId_queryType_scope_idx" ON public."DbRateLimitPolicy" USING btree ("tenantId", "queryType", scope);


--
-- Name: DeviceAuthCode_deviceCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DeviceAuthCode_deviceCode_idx" ON public."DeviceAuthCode" USING btree ("deviceCode");


--
-- Name: DeviceAuthCode_deviceCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DeviceAuthCode_deviceCode_key" ON public."DeviceAuthCode" USING btree ("deviceCode");


--
-- Name: DeviceAuthCode_userCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "DeviceAuthCode_userCode_idx" ON public."DeviceAuthCode" USING btree ("userCode");


--
-- Name: DeviceAuthCode_userCode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "DeviceAuthCode_userCode_key" ON public."DeviceAuthCode" USING btree ("userCode");


--
-- Name: ExternalSecretShare_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExternalSecretShare_expiresAt_idx" ON public."ExternalSecretShare" USING btree ("expiresAt");


--
-- Name: ExternalSecretShare_tokenHash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExternalSecretShare_tokenHash_idx" ON public."ExternalSecretShare" USING btree ("tokenHash");


--
-- Name: ExternalSecretShare_tokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ExternalSecretShare_tokenHash_key" ON public."ExternalSecretShare" USING btree ("tokenHash");


--
-- Name: ExternalVaultProvider_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ExternalVaultProvider_tenantId_idx" ON public."ExternalVaultProvider" USING btree ("tenantId");


--
-- Name: ExternalVaultProvider_tenantId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ExternalVaultProvider_tenantId_name_key" ON public."ExternalVaultProvider" USING btree ("tenantId", name);


--
-- Name: GatewayTemplate_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "GatewayTemplate_tenantId_idx" ON public."GatewayTemplate" USING btree ("tenantId");


--
-- Name: Gateway_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Gateway_tenantId_idx" ON public."Gateway" USING btree ("tenantId");


--
-- Name: Gateway_tenantId_type_isDefault_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Gateway_tenantId_type_isDefault_idx" ON public."Gateway" USING btree ("tenantId", type, "isDefault");


--
-- Name: Gateway_tunnelTokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Gateway_tunnelTokenHash_key" ON public."Gateway" USING btree ("tunnelTokenHash");


--
-- Name: KeystrokePolicy_tenantId_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KeystrokePolicy_tenantId_enabled_idx" ON public."KeystrokePolicy" USING btree ("tenantId", enabled);


--
-- Name: KeystrokePolicy_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "KeystrokePolicy_tenantId_idx" ON public."KeystrokePolicy" USING btree ("tenantId");


--
-- Name: ManagedGatewayInstance_containerId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "ManagedGatewayInstance_containerId_key" ON public."ManagedGatewayInstance" USING btree ("containerId");


--
-- Name: ManagedGatewayInstance_gatewayId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ManagedGatewayInstance_gatewayId_idx" ON public."ManagedGatewayInstance" USING btree ("gatewayId");


--
-- Name: ManagedGatewayInstance_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ManagedGatewayInstance_status_idx" ON public."ManagedGatewayInstance" USING btree (status);


--
-- Name: NotificationPreference_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "NotificationPreference_userId_idx" ON public."NotificationPreference" USING btree ("userId");


--
-- Name: NotificationPreference_userId_type_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "NotificationPreference_userId_type_key" ON public."NotificationPreference" USING btree ("userId", type);


--
-- Name: Notification_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_userId_createdAt_idx" ON public."Notification" USING btree ("userId", "createdAt");


--
-- Name: Notification_userId_read_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Notification_userId_read_idx" ON public."Notification" USING btree ("userId", read);


--
-- Name: OAuthAccount_provider_providerUserId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OAuthAccount_provider_providerUserId_key" ON public."OAuthAccount" USING btree (provider, "providerUserId");


--
-- Name: OAuthAccount_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OAuthAccount_userId_idx" ON public."OAuthAccount" USING btree ("userId");


--
-- Name: OpenTab_userId_connectionId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OpenTab_userId_connectionId_key" ON public."OpenTab" USING btree ("userId", "connectionId");


--
-- Name: OpenTab_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OpenTab_userId_idx" ON public."OpenTab" USING btree ("userId");


--
-- Name: PasswordRotationLog_secretId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PasswordRotationLog_secretId_createdAt_idx" ON public."PasswordRotationLog" USING btree ("secretId", "createdAt");


--
-- Name: PasswordRotationLog_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PasswordRotationLog_status_idx" ON public."PasswordRotationLog" USING btree (status);


--
-- Name: PendingVaultKeyDistribution_tenantId_targetUserId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PendingVaultKeyDistribution_tenantId_targetUserId_key" ON public."PendingVaultKeyDistribution" USING btree ("tenantId", "targetUserId");


--
-- Name: RefreshToken_tokenFamily_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefreshToken_tokenFamily_idx" ON public."RefreshToken" USING btree ("tokenFamily");


--
-- Name: RefreshToken_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "RefreshToken_token_key" ON public."RefreshToken" USING btree (token);


--
-- Name: RefreshToken_userId_familyCreatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefreshToken_userId_familyCreatedAt_idx" ON public."RefreshToken" USING btree ("userId", "familyCreatedAt");


--
-- Name: RefreshToken_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "RefreshToken_userId_idx" ON public."RefreshToken" USING btree ("userId");


--
-- Name: SecretCheckoutRequest_connectionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SecretCheckoutRequest_connectionId_idx" ON public."SecretCheckoutRequest" USING btree ("connectionId");


--
-- Name: SecretCheckoutRequest_requesterId_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SecretCheckoutRequest_requesterId_status_idx" ON public."SecretCheckoutRequest" USING btree ("requesterId", status);


--
-- Name: SecretCheckoutRequest_secretId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SecretCheckoutRequest_secretId_idx" ON public."SecretCheckoutRequest" USING btree ("secretId");


--
-- Name: SecretCheckoutRequest_status_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SecretCheckoutRequest_status_expiresAt_idx" ON public."SecretCheckoutRequest" USING btree (status, "expiresAt");


--
-- Name: SessionRecording_connectionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionRecording_connectionId_idx" ON public."SessionRecording" USING btree ("connectionId");


--
-- Name: SessionRecording_sessionId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionRecording_sessionId_idx" ON public."SessionRecording" USING btree ("sessionId");


--
-- Name: SessionRecording_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SessionRecording_userId_createdAt_idx" ON public."SessionRecording" USING btree ("userId", "createdAt");


--
-- Name: SharedConnection_connectionId_sharedWithUserId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SharedConnection_connectionId_sharedWithUserId_key" ON public."SharedConnection" USING btree ("connectionId", "sharedWithUserId");


--
-- Name: SharedSecret_secretId_sharedWithUserId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SharedSecret_secretId_sharedWithUserId_key" ON public."SharedSecret" USING btree ("secretId", "sharedWithUserId");


--
-- Name: SshKeyPair_tenantId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SshKeyPair_tenantId_key" ON public."SshKeyPair" USING btree ("tenantId");


--
-- Name: SyncLog_syncProfileId_startedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncLog_syncProfileId_startedAt_idx" ON public."SyncLog" USING btree ("syncProfileId", "startedAt");


--
-- Name: SyncProfile_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncProfile_tenantId_idx" ON public."SyncProfile" USING btree ("tenantId");


--
-- Name: SyncProfile_tenantId_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SyncProfile_tenantId_provider_idx" ON public."SyncProfile" USING btree ("tenantId", provider);


--
-- Name: SystemSecret_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SystemSecret_name_key" ON public."SystemSecret" USING btree (name);


--
-- Name: TeamMember_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TeamMember_expiresAt_idx" ON public."TeamMember" USING btree ("expiresAt");


--
-- Name: TeamMember_teamId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON public."TeamMember" USING btree ("teamId", "userId");


--
-- Name: Team_tenantId_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Team_tenantId_name_key" ON public."Team" USING btree ("tenantId", name);


--
-- Name: TenantMember_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TenantMember_expiresAt_idx" ON public."TenantMember" USING btree ("expiresAt");


--
-- Name: TenantMember_tenantId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TenantMember_tenantId_isActive_idx" ON public."TenantMember" USING btree ("tenantId", "isActive");


--
-- Name: TenantMember_tenantId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TenantMember_tenantId_userId_key" ON public."TenantMember" USING btree ("tenantId", "userId");


--
-- Name: TenantMember_userId_isActive_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TenantMember_userId_isActive_idx" ON public."TenantMember" USING btree ("userId", "isActive");


--
-- Name: TenantVaultMember_tenantId_userId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TenantVaultMember_tenantId_userId_key" ON public."TenantVaultMember" USING btree ("tenantId", "userId");


--
-- Name: Tenant_slug_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Tenant_slug_key" ON public."Tenant" USING btree (slug);


--
-- Name: User_emailVerifyToken_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_emailVerifyToken_key" ON public."User" USING btree ("emailVerifyToken");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_passwordResetTokenHash_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_passwordResetTokenHash_key" ON public."User" USING btree ("passwordResetTokenHash");


--
-- Name: VaultFolder_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultFolder_teamId_idx" ON public."VaultFolder" USING btree ("teamId");


--
-- Name: VaultFolder_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultFolder_tenantId_idx" ON public."VaultFolder" USING btree ("tenantId");


--
-- Name: VaultFolder_userId_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultFolder_userId_scope_idx" ON public."VaultFolder" USING btree ("userId", scope);


--
-- Name: VaultSecretVersion_secretId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecretVersion_secretId_idx" ON public."VaultSecretVersion" USING btree ("secretId");


--
-- Name: VaultSecretVersion_secretId_version_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "VaultSecretVersion_secretId_version_key" ON public."VaultSecretVersion" USING btree ("secretId", version);


--
-- Name: VaultSecret_expiresAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecret_expiresAt_idx" ON public."VaultSecret" USING btree ("expiresAt");


--
-- Name: VaultSecret_expiresAt_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecret_expiresAt_userId_idx" ON public."VaultSecret" USING btree ("expiresAt", "userId");


--
-- Name: VaultSecret_targetRotationEnabled_lastRotatedAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecret_targetRotationEnabled_lastRotatedAt_idx" ON public."VaultSecret" USING btree ("targetRotationEnabled", "lastRotatedAt");


--
-- Name: VaultSecret_teamId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecret_teamId_idx" ON public."VaultSecret" USING btree ("teamId");


--
-- Name: VaultSecret_tenantId_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecret_tenantId_scope_idx" ON public."VaultSecret" USING btree ("tenantId", scope);


--
-- Name: VaultSecret_userId_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "VaultSecret_userId_scope_idx" ON public."VaultSecret" USING btree ("userId", scope);


--
-- Name: WebAuthnCredential_credentialId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON public."WebAuthnCredential" USING btree ("credentialId");


--
-- Name: WebAuthnCredential_userId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "WebAuthnCredential_userId_idx" ON public."WebAuthnCredential" USING btree ("userId");


--
-- Name: idx_agent_runs_tenant_requested_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_tenant_requested_at ON public.agent_runs USING btree (tenant_id, requested_at DESC);


--
-- Name: idx_memory_items_namespace_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_items_namespace_created_at ON public.memory_items USING btree (namespace_key, created_at DESC);


--
-- Name: idx_memory_namespaces_tenant_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memory_namespaces_tenant_scope ON public.memory_namespaces USING btree (tenant_id, scope, memory_type);


--
-- Name: ActiveSession ActiveSession_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ActiveSession"
    ADD CONSTRAINT "ActiveSession_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."Connection"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ActiveSession ActiveSession_gatewayId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ActiveSession"
    ADD CONSTRAINT "ActiveSession_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES public."Gateway"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ActiveSession ActiveSession_instanceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ActiveSession"
    ADD CONSTRAINT "ActiveSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES public."ManagedGatewayInstance"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ActiveSession ActiveSession_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ActiveSession"
    ADD CONSTRAINT "ActiveSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AiDailyUsage AiDailyUsage_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AiDailyUsage"
    ADD CONSTRAINT "AiDailyUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: AuditLog AuditLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Connection Connection_credentialSecretId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_credentialSecretId_fkey" FOREIGN KEY ("credentialSecretId") REFERENCES public."VaultSecret"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Connection Connection_externalVaultProviderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_externalVaultProviderId_fkey" FOREIGN KEY ("externalVaultProviderId") REFERENCES public."ExternalVaultProvider"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Connection Connection_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public."Folder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Connection Connection_gatewayId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES public."Gateway"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Connection Connection_syncProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_syncProfileId_fkey" FOREIGN KEY ("syncProfileId") REFERENCES public."SyncProfile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Connection Connection_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Connection Connection_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Connection"
    ADD CONSTRAINT "Connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: DbAuditLog DbAuditLog_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DbAuditLog"
    ADD CONSTRAINT "DbAuditLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."Connection"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: DbAuditLog DbAuditLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."DbAuditLog"
    ADD CONSTRAINT "DbAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExternalSecretShare ExternalSecretShare_createdByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExternalSecretShare"
    ADD CONSTRAINT "ExternalSecretShare_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ExternalSecretShare ExternalSecretShare_secretId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExternalSecretShare"
    ADD CONSTRAINT "ExternalSecretShare_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES public."VaultSecret"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ExternalVaultProvider ExternalVaultProvider_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ExternalVaultProvider"
    ADD CONSTRAINT "ExternalVaultProvider_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Folder Folder_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."Folder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Folder Folder_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Folder Folder_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Folder"
    ADD CONSTRAINT "Folder_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: GatewayTemplate GatewayTemplate_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GatewayTemplate"
    ADD CONSTRAINT "GatewayTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: GatewayTemplate GatewayTemplate_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."GatewayTemplate"
    ADD CONSTRAINT "GatewayTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Gateway Gateway_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Gateway"
    ADD CONSTRAINT "Gateway_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Gateway Gateway_templateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Gateway"
    ADD CONSTRAINT "Gateway_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES public."GatewayTemplate"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Gateway Gateway_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Gateway"
    ADD CONSTRAINT "Gateway_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ManagedGatewayInstance ManagedGatewayInstance_gatewayId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ManagedGatewayInstance"
    ADD CONSTRAINT "ManagedGatewayInstance_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES public."Gateway"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: NotificationPreference NotificationPreference_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."NotificationPreference"
    ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Notification Notification_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Notification"
    ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OAuthAccount OAuthAccount_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OAuthAccount"
    ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OpenTab OpenTab_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OpenTab"
    ADD CONSTRAINT "OpenTab_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."Connection"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: OpenTab OpenTab_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OpenTab"
    ADD CONSTRAINT "OpenTab_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PasswordRotationLog PasswordRotationLog_secretId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PasswordRotationLog"
    ADD CONSTRAINT "PasswordRotationLog_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES public."VaultSecret"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PendingVaultKeyDistribution PendingVaultKeyDistribution_distributorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PendingVaultKeyDistribution"
    ADD CONSTRAINT "PendingVaultKeyDistribution_distributorUserId_fkey" FOREIGN KEY ("distributorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PendingVaultKeyDistribution PendingVaultKeyDistribution_targetUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PendingVaultKeyDistribution"
    ADD CONSTRAINT "PendingVaultKeyDistribution_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PendingVaultKeyDistribution PendingVaultKeyDistribution_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PendingVaultKeyDistribution"
    ADD CONSTRAINT "PendingVaultKeyDistribution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RefreshToken RefreshToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."RefreshToken"
    ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SecretCheckoutRequest SecretCheckoutRequest_approverId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SecretCheckoutRequest"
    ADD CONSTRAINT "SecretCheckoutRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SecretCheckoutRequest SecretCheckoutRequest_requesterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SecretCheckoutRequest"
    ADD CONSTRAINT "SecretCheckoutRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SessionRecording SessionRecording_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionRecording"
    ADD CONSTRAINT "SessionRecording_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."Connection"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SessionRecording SessionRecording_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SessionRecording"
    ADD CONSTRAINT "SessionRecording_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SharedConnection SharedConnection_connectionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedConnection"
    ADD CONSTRAINT "SharedConnection_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES public."Connection"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SharedConnection SharedConnection_sharedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedConnection"
    ADD CONSTRAINT "SharedConnection_sharedByUserId_fkey" FOREIGN KEY ("sharedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SharedConnection SharedConnection_sharedWithUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedConnection"
    ADD CONSTRAINT "SharedConnection_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SharedSecret SharedSecret_secretId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedSecret"
    ADD CONSTRAINT "SharedSecret_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES public."VaultSecret"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SharedSecret SharedSecret_sharedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedSecret"
    ADD CONSTRAINT "SharedSecret_sharedByUserId_fkey" FOREIGN KEY ("sharedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SharedSecret SharedSecret_sharedWithUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SharedSecret"
    ADD CONSTRAINT "SharedSecret_sharedWithUserId_fkey" FOREIGN KEY ("sharedWithUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SshKeyPair SshKeyPair_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SshKeyPair"
    ADD CONSTRAINT "SshKeyPair_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyncLog SyncLog_syncProfileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncLog"
    ADD CONSTRAINT "SyncLog_syncProfileId_fkey" FOREIGN KEY ("syncProfileId") REFERENCES public."SyncProfile"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SyncProfile SyncProfile_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncProfile"
    ADD CONSTRAINT "SyncProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SyncProfile SyncProfile_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncProfile"
    ADD CONSTRAINT "SyncProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SyncProfile SyncProfile_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SyncProfile"
    ADD CONSTRAINT "SyncProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamMember TeamMember_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TeamMember TeamMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TeamMember"
    ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Team Team_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Team"
    ADD CONSTRAINT "Team_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TenantAiConfig TenantAiConfig_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantAiConfig"
    ADD CONSTRAINT "TenantAiConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TenantMember TenantMember_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantMember"
    ADD CONSTRAINT "TenantMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TenantMember TenantMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantMember"
    ADD CONSTRAINT "TenantMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TenantVaultMember TenantVaultMember_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantVaultMember"
    ADD CONSTRAINT "TenantVaultMember_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TenantVaultMember TenantVaultMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantVaultMember"
    ADD CONSTRAINT "TenantVaultMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VaultFolder VaultFolder_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultFolder"
    ADD CONSTRAINT "VaultFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."VaultFolder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VaultFolder VaultFolder_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultFolder"
    ADD CONSTRAINT "VaultFolder_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VaultFolder VaultFolder_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultFolder"
    ADD CONSTRAINT "VaultFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VaultSecretVersion VaultSecretVersion_changedBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecretVersion"
    ADD CONSTRAINT "VaultSecretVersion_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VaultSecretVersion VaultSecretVersion_secretId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecretVersion"
    ADD CONSTRAINT "VaultSecretVersion_secretId_fkey" FOREIGN KEY ("secretId") REFERENCES public."VaultSecret"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VaultSecret VaultSecret_folderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecret"
    ADD CONSTRAINT "VaultSecret_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES public."VaultFolder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VaultSecret VaultSecret_teamId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecret"
    ADD CONSTRAINT "VaultSecret_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES public."Team"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VaultSecret VaultSecret_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecret"
    ADD CONSTRAINT "VaultSecret_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VaultSecret VaultSecret_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."VaultSecret"
    ADD CONSTRAINT "VaultSecret_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: WebAuthnCredential WebAuthnCredential_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."WebAuthnCredential"
    ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: memory_items memory_items_namespace_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memory_items
    ADD CONSTRAINT memory_items_namespace_key_fkey FOREIGN KEY (namespace_key) REFERENCES public.memory_namespaces(namespace_key) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

