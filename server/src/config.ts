import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { parseExpiry } from './utils/format';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function resolveServerEncryptionKey(): Buffer {
  const envKey = process.env.SERVER_ENCRYPTION_KEY?.trim();
  if (envKey && envKey.length > 0) {
    if (!/^[0-9a-fA-F]{64}$/.test(envKey)) {
      throw new Error(
        `SERVER_ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes). ` +
        `Got ${envKey.length} chars. Generate one with: ` +
        `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
      );
    }
    return Buffer.from(envKey, 'hex');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SERVER_ENCRYPTION_KEY is required in production. Generate one with: ' +
      'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  // eslint-disable-next-line no-console
  console.warn(
    '[config] SERVER_ENCRYPTION_KEY not set — auto-generating for development. ' +
    'SSH key pairs will not survive server restarts.',
  );
  return crypto.randomBytes(32);
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  guacamoleWsPort: parseInt(process.env.GUACAMOLE_WS_PORT || '3002', 10),
  jwtSecret: (() => {
    const secret = process.env.JWT_SECRET;
    if (!secret && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      throw new Error('JWT_SECRET is required (set NODE_ENV=development to use a default)');
    }
    return secret || 'dev-secret-change-me';
  })(),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  guacdHost: process.env.GUACD_HOST || 'localhost',
  guacdPort: parseInt(process.env.GUACD_PORT || '4822', 10),
  guacamoleSecret: (() => {
    const secret = process.env.GUACAMOLE_SECRET;
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('GUACAMOLE_SECRET is required in production');
    }
    return secret || 'dev-guac-secret';
  })(),
  serverEncryptionKey: resolveServerEncryptionKey(),
  gatewayApiToken: process.env.GATEWAY_API_TOKEN || '',
  vaultTtlMinutes: parseInt(process.env.VAULT_TTL_MINUTES || '30', 10),
  vaultRecoveryTtlMs: parseExpiry(process.env.JWT_REFRESH_EXPIRES_IN || '7d'),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: (process.env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'verbose' | 'debug',
  logFormat: (process.env.LOG_FORMAT || 'text') as 'text' | 'json',
  logTimestamps: process.env.LOG_TIMESTAMPS !== 'false',
  logHttpRequests: process.env.LOG_HTTP_REQUESTS === 'true',
  logGuacamole: process.env.LOG_GUACAMOLE !== 'false',
  driveBasePath: process.env.DRIVE_BASE_PATH || path.resolve(__dirname, '../../data/drive'),
  fileUploadMaxSize: parseInt(process.env.FILE_UPLOAD_MAX_SIZE || String(10 * 1024 * 1024), 10),
  userDriveQuota: parseInt(process.env.USER_DRIVE_QUOTA || String(100 * 1024 * 1024), 10),
  sftpMaxFileSize: parseInt(process.env.SFTP_MAX_FILE_SIZE || String(100 * 1024 * 1024), 10),
  sftpChunkSize: parseInt(process.env.SFTP_CHUNK_SIZE || String(64 * 1024), 10),
  emailProvider: (process.env.EMAIL_PROVIDER || 'smtp') as
    | 'smtp'
    | 'sendgrid'
    | 'ses'
    | 'resend'
    | 'mailgun',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || 'noreply@localhost',
  sendgridApiKey: process.env.SENDGRID_API_KEY || '',
  sesRegion: process.env.AWS_SES_REGION || 'us-east-1',
  sesAccessKeyId: process.env.AWS_SES_ACCESS_KEY_ID || '',
  sesSecretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  mailgunApiKey: process.env.MAILGUN_API_KEY || '',
  mailgunDomain: process.env.MAILGUN_DOMAIN || '',
  mailgunRegion: (process.env.MAILGUN_REGION || 'us') as 'us' | 'eu',
  smsProvider: (process.env.SMS_PROVIDER || '') as '' | 'twilio' | 'sns' | 'vonage',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER || '',
  snsRegion: process.env.AWS_SNS_REGION || 'us-east-1',
  snsAccessKeyId: process.env.AWS_SNS_ACCESS_KEY_ID || '',
  snsSecretAccessKey: process.env.AWS_SNS_SECRET_ACCESS_KEY || '',
  vonageApiKey: process.env.VONAGE_API_KEY || '',
  vonageApiSecret: process.env.VONAGE_API_SECRET || '',
  vonageFromNumber: process.env.VONAGE_FROM_NUMBER || '',
  emailVerifyRequired: process.env.EMAIL_VERIFY_REQUIRED === 'true',
  selfSignupEnabled: process.env.SELF_SIGNUP_ENABLED === 'true',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  oauth: {
    google: {
      enabled: !!process.env.GOOGLE_CLIENT_ID,
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/api/auth/oauth/google/callback',
      hd: process.env.GOOGLE_HD || '',
    },
    microsoft: {
      enabled: !!process.env.MICROSOFT_CLIENT_ID,
      clientId: process.env.MICROSOFT_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
      callbackUrl: process.env.MICROSOFT_CALLBACK_URL || 'http://localhost:3001/api/auth/oauth/microsoft/callback',
      tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    },
    github: {
      enabled: !!process.env.GITHUB_CLIENT_ID,
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      callbackUrl: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3001/api/auth/oauth/github/callback',
    },
    oidc: {
      enabled: !!process.env.OIDC_CLIENT_ID,
      providerName: process.env.OIDC_PROVIDER_NAME || 'SSO',
      issuerUrl: process.env.OIDC_ISSUER_URL || '',
      clientId: process.env.OIDC_CLIENT_ID || '',
      clientSecret: process.env.OIDC_CLIENT_SECRET || '',
      callbackUrl: process.env.OIDC_CALLBACK_URL || 'http://localhost:3001/api/auth/oauth/oidc/callback',
      scopes: process.env.OIDC_SCOPES || 'openid profile email',
    },
    saml: {
      enabled: !!process.env.SAML_ENTRY_POINT,
      providerName: process.env.SAML_PROVIDER_NAME || 'SAML SSO',
      entryPoint: process.env.SAML_ENTRY_POINT || '',
      issuer: process.env.SAML_ISSUER || 'arsenale',
      callbackUrl: process.env.SAML_CALLBACK_URL || 'http://localhost:3001/api/auth/saml/callback',
      cert: process.env.SAML_CERT || '',
      metadataUrl: process.env.SAML_METADATA_URL || '',
      wantAuthnResponseSigned: process.env.SAML_WANT_AUTHN_RESPONSE_SIGNED !== 'false',
    },
  },
  cookie: {
    refreshTokenName: 'arsenale-rt',
    csrfTokenName: 'arsenale-csrf',
    path: '/api/auth',
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    httpOnly: true,
  },
  keyRotationCron: process.env.KEY_ROTATION_CRON || '0 2 * * *',
  keyRotationAdvanceDays: parseInt(process.env.KEY_ROTATION_ADVANCE_DAYS || '7', 10),
  loginRateLimitWindowMs: parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
  loginRateLimitMaxAttempts: parseInt(process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS || '5', 10),
  accountLockoutThreshold: parseInt(process.env.ACCOUNT_LOCKOUT_THRESHOLD || '10', 10),
  accountLockoutDurationMs: parseInt(process.env.ACCOUNT_LOCKOUT_DURATION_MS || String(30 * 60 * 1000), 10),
  vaultRateLimitWindowMs: parseInt(process.env.VAULT_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10),
  vaultRateLimitMaxAttempts: parseInt(process.env.VAULT_RATE_LIMIT_MAX_ATTEMPTS || '5', 10),
  vaultMfaRateLimitMaxAttempts: parseInt(process.env.VAULT_MFA_RATE_LIMIT_MAX_ATTEMPTS || '10', 10),
  sessionRateLimitWindowMs: parseInt(process.env.SESSION_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10),
  sessionRateLimitMaxAttempts: parseInt(process.env.SESSION_RATE_LIMIT_MAX_ATTEMPTS || '20', 10),
  oauthFlowRateLimitWindowMs: parseInt(process.env.OAUTH_FLOW_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
  oauthFlowRateLimitMaxAttempts: parseInt(process.env.OAUTH_FLOW_RATE_LIMIT_MAX_ATTEMPTS || '20', 10),
  oauthAccountRateLimitWindowMs: parseInt(process.env.OAUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS || String(60 * 1000), 10),
  oauthAccountRateLimitMaxAttempts: parseInt(process.env.OAUTH_ACCOUNT_RATE_LIMIT_MAX_ATTEMPTS || '15', 10),
  oauthLinkRateLimitWindowMs: parseInt(process.env.OAUTH_LINK_RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
  oauthLinkRateLimitMaxAttempts: parseInt(process.env.OAUTH_LINK_RATE_LIMIT_MAX_ATTEMPTS || '10', 10),
  // IP-based whitelist for global rate limiter bypass (loopback + RFC 1918 by default)
  rateLimitWhitelistCidrs: (() => {
    const val = process.env.RATE_LIMIT_WHITELIST_CIDRS;
    if (val !== undefined) {
      return val.trim() === '' ? [] : val.split(',').map(s => s.trim()).filter(Boolean);
    }
    return ['127.0.0.1/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  })(),
  sessionHeartbeatIntervalMs: parseInt(process.env.SESSION_HEARTBEAT_INTERVAL_MS || String(30 * 1000), 10),
  sessionIdleThresholdMinutes: parseInt(process.env.SESSION_IDLE_THRESHOLD_MINUTES || '5', 10),
  sessionCleanupRetentionDays: parseInt(process.env.SESSION_CLEANUP_RETENTION_DAYS || '30', 10),
  sessionInactivityTimeoutSeconds: parseInt(process.env.SESSION_INACTIVITY_TIMEOUT_SECONDS || '3600', 10),
  maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '0', 10),
  absoluteSessionTimeoutSeconds: parseInt(process.env.ABSOLUTE_SESSION_TIMEOUT_SECONDS || '43200', 10),
  // Database query execution
  dbQueryTimeoutMs: parseInt(process.env.DB_QUERY_TIMEOUT_MS || '30000', 10),
  dbQueryMaxRows: parseInt(process.env.DB_QUERY_MAX_ROWS || '10000', 10),
  dbPoolMaxConnections: parseInt(process.env.DB_POOL_MAX_CONNECTIONS || '3', 10),
  dbPoolIdleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '60000', 10),
  // Container orchestrator
  orchestratorType: (process.env.ORCHESTRATOR_TYPE || '') as '' | 'docker' | 'podman' | 'kubernetes' | 'none',
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  podmanSocketPath: process.env.PODMAN_SOCKET_PATH || (
    process.env.XDG_RUNTIME_DIR
      ? `${process.env.XDG_RUNTIME_DIR}/podman/podman.sock`
      : '/run/podman/podman.sock'
  ),
  dockerNetwork: process.env.DOCKER_NETWORK || '',
  orchestratorK8sNamespace: process.env.ORCHESTRATOR_K8S_NAMESPACE || 'arsenale',
  orchestratorSshGatewayImage: process.env.ORCHESTRATOR_SSH_GATEWAY_IMAGE || 'ghcr.io/dnviti/arsenale/ssh-gateway:latest',
  orchestratorGuacdImage: process.env.ORCHESTRATOR_GUACD_IMAGE || 'guacamole/guacd:1.6.0',
  orchestratorDbProxyImage: process.env.ORCHESTRATOR_DB_PROXY_IMAGE || 'ghcr.io/dnviti/arsenale/db-proxy:latest',
  // Session recording
  recordingEnabled: process.env.RECORDING_ENABLED === 'true',
  recordingPath: path.resolve(process.env.RECORDING_PATH || '/recordings'),
  recordingVolume: process.env.RECORDING_VOLUME || '',
  recordingRetentionDays: parseInt(process.env.RECORDING_RETENTION_DAYS || '90', 10),
  // Guacenc video conversion sidecar
  guacencServiceUrl: process.env.GUACENC_SERVICE_URL || 'http://guacenc:3003',
  guacencTimeoutMs: parseInt(process.env.GUACENC_TIMEOUT_MS || '120000', 10),
  guacencRecordingPath: process.env.GUACENC_RECORDING_PATH || '/recordings',
  // Asciicast-to-MP4 converter (defaults to same sidecar as guacenc)
  asciicastConverterUrl: process.env.ASCIICAST_CONVERTER_URL || process.env.GUACENC_SERVICE_URL || 'http://guacenc:3003',
  // Token binding — bind JWT tokens to client IP + User-Agent (MITRE T1563)
  tokenBindingEnabled: process.env.TOKEN_BINDING_ENABLED !== 'false',
  // IP Geolocation (MaxMind GeoLite2)
  geoipDbPath: process.env.GEOIP_DB_PATH ? path.resolve(process.env.GEOIP_DB_PATH) : '',
  // Impossible travel detection — maximum plausible speed in km/h (default: 900, faster than commercial aviation)
  impossibleTravelSpeedKmh: parseInt(process.env.IMPOSSIBLE_TRAVEL_SPEED_KMH || '900', 10),
  // Lateral movement anomaly detection (MITRE T1021)
  lateralMovementEnabled: process.env.LATERAL_MOVEMENT_DETECTION_ENABLED !== 'false',
  lateralMovementMaxDistinctTargets: parseInt(process.env.LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS || '10', 10),
  lateralMovementWindowMinutes: parseInt(process.env.LATERAL_MOVEMENT_WINDOW_MINUTES || '5', 10),
  lateralMovementLockoutMinutes: parseInt(process.env.LATERAL_MOVEMENT_LOCKOUT_MINUTES || '30', 10),
  // Reverse proxy trust depth for Express.
  // Controls how `req.ip` is resolved from X-Forwarded-For.
  // false = disabled, true = trust all, number = hop count to trust.
  // Example: Client → Caddy → nginx → Express = 2 hops.
  trustProxy: (() => {
    const val = process.env.TRUST_PROXY;
    if (val === undefined || val === '') return false;
    if (val === 'true') return true;
    if (val === 'false') return false;
    const num = parseInt(val, 10);
    return Number.isNaN(num) ? val : num;   // string = subnet, number = hop count
  })() as boolean | number | string,
  ldap: {
    enabled: process.env.LDAP_ENABLED === 'true',
    providerName: process.env.LDAP_PROVIDER_NAME || 'LDAP',
    serverUrl: process.env.LDAP_SERVER_URL || '',
    baseDn: process.env.LDAP_BASE_DN || '',
    bindDn: process.env.LDAP_BIND_DN || '',
    bindPassword: process.env.LDAP_BIND_PASSWORD || '',
    userSearchFilter: process.env.LDAP_USER_SEARCH_FILTER || '(uid={{username}})',
    userSearchBase: process.env.LDAP_USER_SEARCH_BASE || '',
    displayNameAttr: process.env.LDAP_DISPLAY_NAME_ATTR || 'displayName',
    emailAttr: process.env.LDAP_EMAIL_ATTR || 'mail',
    uidAttr: process.env.LDAP_UID_ATTR || 'uid',
    groupBaseDn: process.env.LDAP_GROUP_BASE_DN || '',
    groupSearchFilter: process.env.LDAP_GROUP_SEARCH_FILTER || '(objectClass=groupOfNames)',
    groupMemberAttr: process.env.LDAP_GROUP_MEMBER_ATTR || 'member',
    groupNameAttr: process.env.LDAP_GROUP_NAME_ATTR || 'cn',
    allowedGroups: (process.env.LDAP_ALLOWED_GROUPS || '').split(',').filter(Boolean),
    starttls: process.env.LDAP_STARTTLS === 'true',
    tlsRejectUnauthorized: process.env.LDAP_TLS_REJECT_UNAUTHORIZED !== 'false',
    syncEnabled: process.env.LDAP_SYNC_ENABLED === 'true',
    syncCron: process.env.LDAP_SYNC_CRON || '0 */6 * * *',
    autoProvision: process.env.LDAP_AUTO_PROVISION !== 'false',
    defaultTenantId: process.env.LDAP_DEFAULT_TENANT_ID || '',
  },
  // Allow connections to private/local network addresses
  allowLocalNetwork: process.env.ALLOW_LOCAL_NETWORK?.toLowerCase() !== 'false',
  // Allow connections to loopback addresses (localhost, 127.x, ::1) — opt-in, secure by default
  allowLoopback: process.env.ALLOW_LOOPBACK?.toLowerCase() === 'true',
  // Multi-tenancy — allow sharing connections with users outside the sharer's tenant
  allowExternalSharing: process.env.ALLOW_EXTERNAL_SHARING === 'true',
  webauthn: {
    rpId: process.env.WEBAUTHN_RP_ID || 'localhost',
    rpOrigin: process.env.WEBAUTHN_RP_ORIGIN || 'http://localhost:3000',
    rpName: process.env.WEBAUTHN_RP_NAME || 'Arsenale',
  },
  // SSH Protocol Proxy
  // AI query generation
  aiQueryEnabled: process.env.AI_QUERY_GENERATION_ENABLED === 'true',
  aiQueryProvider: (process.env.AI_QUERY_PROVIDER || 'none') as 'none' | 'anthropic' | 'openai',
  aiAnthropicApiKey: process.env.AI_ANTHROPIC_API_KEY || '',
  aiOpenaiApiKey: process.env.AI_OPENAI_API_KEY || '',
  aiOpenaiBaseUrl: process.env.AI_OPENAI_BASE_URL || 'https://api.openai.com/v1',
  aiModelVersion: process.env.AI_MODEL_VERSION || '',
  aiQueryTimeoutMs: parseInt(process.env.AI_QUERY_TIMEOUT_MS || '30000', 10),
  aiMaxRequestsPerDay: parseInt(process.env.AI_MAX_REQUESTS_PER_DAY || '100', 10),
  // SSH Protocol Proxy
  sshProxy: {
    enabled: process.env.SSH_PROXY_ENABLED === 'true',
    port: parseInt(process.env.SSH_PROXY_PORT || '2222', 10),
    hostKey: process.env.SSH_PROXY_HOST_KEY || '',
    allowedAuthMethods: (process.env.SSH_PROXY_AUTH_METHODS || 'token,keyboard-interactive').split(',').filter(Boolean) as Array<'token' | 'keyboard-interactive' | 'certificate'>,
    tokenTtlSeconds: parseInt(process.env.SSH_PROXY_TOKEN_TTL_SECONDS || '300', 10),
    caPublicKeyPath: process.env.SSH_PROXY_CA_PUBLIC_KEY || '',
    keystrokeRecording: process.env.SSH_PROXY_KEYSTROKE_RECORDING === 'true',
  },
};
