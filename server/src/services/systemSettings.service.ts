import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
import { onSettingChanged } from './configReloader.service';
import type { TenantRoleType } from '../types';

// ---------------------------------------------------------------------------
// Role hierarchy (mirrors tenant.middleware.ts)
// ---------------------------------------------------------------------------
const ROLE_LEVEL: Record<string, number> = {
  GUEST: 0.1, AUDITOR: 0.3, CONSULTANT: 0.5,
  MEMBER: 1, OPERATOR: 2, ADMIN: 3, OWNER: 4,
};

function roleLevel(role: string): number {
  return ROLE_LEVEL[role] ?? 0;
}

// ---------------------------------------------------------------------------
// Setting types
// ---------------------------------------------------------------------------
export type SettingType = 'boolean' | 'number' | 'string' | 'select' | 'string[]';

export interface SettingDef {
  key: string;           // DB key + API identifier (matches env var name)
  envVar: string;        // process.env key for env-lock detection
  configPath?: string;   // Dot path in config object (for hot-patch at startup)
  type: SettingType;
  default: unknown;
  options?: string[];    // For 'select' type
  group: string;
  label: string;
  description: string;
  minEditRole: 'ADMIN' | 'OWNER';
  restartRequired?: boolean;
  sensitive?: boolean;
}

export interface SettingValue {
  key: string;
  value: unknown;
  source: 'env' | 'db' | 'default';
  envLocked: boolean;
  canEdit: boolean;
  type: SettingType;
  default: unknown;
  options?: string[];
  group: string;
  label: string;
  description: string;
  restartRequired: boolean;
  sensitive: boolean;
}

export const SENSITIVE_MASK = '••••••••';

// ---------------------------------------------------------------------------
// Settings Registry — single source of truth for all UI-configurable settings
// ---------------------------------------------------------------------------
export const SETTINGS_REGISTRY: SettingDef[] = [
  // ── Feature Toggles ─────────────────────────────────────────────────────
  {
    key: 'FEATURE_DATABASE_PROXY_ENABLED', envVar: 'FEATURE_DATABASE_PROXY_ENABLED',
    configPath: 'features.databaseProxyEnabled', type: 'boolean', default: true,
    group: 'feature-toggles', label: 'Database SQL Proxy',
    description: 'Enable the database SQL proxy feature (AI SQL, DB connections, DB audit).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'FEATURE_CONNECTIONS_ENABLED', envVar: 'FEATURE_CONNECTIONS_ENABLED',
    configPath: 'features.connectionsEnabled', type: 'boolean', default: true,
    group: 'feature-toggles', label: 'Connection Management',
    description: 'Enable the connection management feature (SSH, RDP, VNC connections, folders, sharing).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'FEATURE_KEYCHAIN_ENABLED', envVar: 'FEATURE_KEYCHAIN_ENABLED',
    configPath: 'features.keychainEnabled', type: 'boolean', default: true,
    group: 'feature-toggles', label: 'Keychain / Secrets Vault',
    description: 'Enable the keychain and secrets management feature.',
    minEditRole: 'ADMIN',
  },

  // ── General ──────────────────────────────────────────────────────────────
  {
    key: 'EMAIL_VERIFY_REQUIRED', envVar: 'EMAIL_VERIFY_REQUIRED',
    configPath: 'emailVerifyRequired', type: 'boolean', default: false,
    group: 'general', label: 'Require Email Verification',
    description: 'Require email verification before allowing login.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'ALLOW_EXTERNAL_SHARING', envVar: 'ALLOW_EXTERNAL_SHARING',
    configPath: 'allowExternalSharing', type: 'boolean', default: false,
    group: 'general', label: 'Allow External Sharing',
    description: 'Allow sharing connections with users outside the tenant.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'ALLOW_LOCAL_NETWORK', envVar: 'ALLOW_LOCAL_NETWORK',
    configPath: 'allowLocalNetwork', type: 'boolean', default: true,
    group: 'general', label: 'Allow Local Network Connections',
    description: 'Allow connections to private/local network addresses (10.x, 172.16-31.x, 192.168.x).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'ALLOW_LOOPBACK', envVar: 'ALLOW_LOOPBACK',
    configPath: 'allowLoopback', type: 'boolean', default: false,
    group: 'general', label: 'Allow Loopback Connections',
    description: 'Allow connections to loopback addresses (localhost, 127.x.x.x, ::1). Wildcard and link-local remain blocked.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'CLI_ENABLED', envVar: 'CLI_ENABLED',
    type: 'boolean', default: false,
    group: 'general', label: 'CLI Enabled',
    description: 'Enable the arsenale CLI tool inside the container.',
    minEditRole: 'ADMIN',
  },

  // ── Logging ──────────────────────────────────────────────────────────────
  {
    key: 'LOG_LEVEL', envVar: 'LOG_LEVEL',
    configPath: 'logLevel', type: 'select', default: 'info',
    options: ['error', 'warn', 'info', 'verbose', 'debug'],
    group: 'logging', label: 'Log Level',
    description: 'Server log verbosity level.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'LOG_FORMAT', envVar: 'LOG_FORMAT',
    configPath: 'logFormat', type: 'select', default: 'text',
    options: ['text', 'json'],
    group: 'logging', label: 'Log Format',
    description: 'Log output format.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'LOG_TIMESTAMPS', envVar: 'LOG_TIMESTAMPS',
    configPath: 'logTimestamps', type: 'boolean', default: true,
    group: 'logging', label: 'Include Timestamps',
    description: 'Include ISO-8601 timestamps in log output.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'LOG_HTTP_REQUESTS', envVar: 'LOG_HTTP_REQUESTS',
    configPath: 'logHttpRequests', type: 'boolean', default: false,
    group: 'logging', label: 'Log HTTP Requests',
    description: 'Log HTTP requests (method, url, status, duration).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'LOG_GUACAMOLE', envVar: 'LOG_GUACAMOLE',
    configPath: 'logGuacamole', type: 'boolean', default: true,
    group: 'logging', label: 'Log Guacamole',
    description: 'Enable guacamole-lite (RDP/VNC tunnel) logs.',
    minEditRole: 'ADMIN',
  },

  // ── Rate Limiting ────────────────────────────────────────────────────────
  {
    key: 'GLOBAL_RATE_LIMIT_WINDOW_MS', envVar: 'GLOBAL_RATE_LIMIT_WINDOW_MS',
    type: 'number', default: 60000,
    group: 'rate-limiting', label: 'Global Rate Limit Window (ms)',
    description: 'Sliding window duration for the global API rate limiter.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED', envVar: 'GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED',
    type: 'number', default: 200,
    group: 'rate-limiting', label: 'Global Max Requests (Authenticated)',
    description: 'Maximum API requests per window for authenticated users.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'GLOBAL_RATE_LIMIT_MAX_ANONYMOUS', envVar: 'GLOBAL_RATE_LIMIT_MAX_ANONYMOUS',
    type: 'number', default: 60,
    group: 'rate-limiting', label: 'Global Max Requests (Anonymous)',
    description: 'Maximum API requests per window for anonymous users.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'LOGIN_RATE_LIMIT_WINDOW_MS', envVar: 'LOGIN_RATE_LIMIT_WINDOW_MS',
    configPath: 'loginRateLimitWindowMs', type: 'number', default: 900000,
    group: 'rate-limiting', label: 'Login Rate Limit Window (ms)',
    description: 'Sliding window duration for login attempts.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'LOGIN_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
    configPath: 'loginRateLimitMaxAttempts', type: 'number', default: 5,
    group: 'rate-limiting', label: 'Login Max Attempts',
    description: 'Maximum login attempts per IP within the window.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'ACCOUNT_LOCKOUT_THRESHOLD', envVar: 'ACCOUNT_LOCKOUT_THRESHOLD',
    configPath: 'accountLockoutThreshold', type: 'number', default: 10,
    group: 'rate-limiting', label: 'Account Lockout Threshold',
    description: 'Consecutive failed logins before account lockout.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'ACCOUNT_LOCKOUT_DURATION_MS', envVar: 'ACCOUNT_LOCKOUT_DURATION_MS',
    configPath: 'accountLockoutDurationMs', type: 'number', default: 1800000,
    group: 'rate-limiting', label: 'Account Lockout Duration (ms)',
    description: 'How long an account stays locked after exceeding the threshold.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'RATE_LIMIT_WHITELIST_CIDRS', envVar: 'RATE_LIMIT_WHITELIST_CIDRS',
    configPath: 'rateLimitWhitelistCidrs', type: 'string',
    default: '127.0.0.1/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
    group: 'rate-limiting', label: 'Rate Limit Whitelist CIDRs',
    description: 'Comma-separated CIDR ranges that bypass the global rate limiter.',
    minEditRole: 'ADMIN',
  },

  // ── Session Defaults ─────────────────────────────────────────────────────
  {
    key: 'MAX_CONCURRENT_SESSIONS', envVar: 'MAX_CONCURRENT_SESSIONS',
    configPath: 'maxConcurrentSessions', type: 'number', default: 0,
    group: 'sessions', label: 'Max Concurrent Sessions',
    description: 'Maximum concurrent login sessions per user (0 = unlimited).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'ABSOLUTE_SESSION_TIMEOUT_SECONDS', envVar: 'ABSOLUTE_SESSION_TIMEOUT_SECONDS',
    configPath: 'absoluteSessionTimeoutSeconds', type: 'number', default: 43200,
    group: 'sessions', label: 'Absolute Session Timeout (s)',
    description: 'Forces re-login regardless of activity (0 = disabled, default: 43200 = 12h).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'SESSION_INACTIVITY_TIMEOUT_SECONDS', envVar: 'SESSION_INACTIVITY_TIMEOUT_SECONDS',
    configPath: 'sessionInactivityTimeoutSeconds', type: 'number', default: 3600,
    group: 'sessions', label: 'Inactivity Timeout (s)',
    description: 'Idle timeout before a session is marked inactive (default: 3600 = 1h).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'SESSION_HEARTBEAT_INTERVAL_MS', envVar: 'SESSION_HEARTBEAT_INTERVAL_MS',
    configPath: 'sessionHeartbeatIntervalMs', type: 'number', default: 30000,
    group: 'sessions', label: 'Heartbeat Interval (ms)',
    description: 'How often clients send a heartbeat to keep sessions alive.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'SESSION_IDLE_THRESHOLD_MINUTES', envVar: 'SESSION_IDLE_THRESHOLD_MINUTES',
    configPath: 'sessionIdleThresholdMinutes', type: 'number', default: 5,
    group: 'sessions', label: 'Idle Threshold (min)',
    description: 'Minutes without heartbeat before marking a session as idle.',
    minEditRole: 'ADMIN',
  },
  {
    key: 'SESSION_CLEANUP_RETENTION_DAYS', envVar: 'SESSION_CLEANUP_RETENTION_DAYS',
    configPath: 'sessionCleanupRetentionDays', type: 'number', default: 30,
    group: 'sessions', label: 'Cleanup Retention (days)',
    description: 'Days to retain closed session records before purging.',
    minEditRole: 'ADMIN',
  },

  // ── Security Detection ───────────────────────────────────────────────────
  {
    key: 'TOKEN_BINDING_ENABLED', envVar: 'TOKEN_BINDING_ENABLED',
    configPath: 'tokenBindingEnabled', type: 'boolean', default: true,
    group: 'security-detection', label: 'Token Binding',
    description: 'Bind JWT tokens to client IP + User-Agent to prevent session hijacking.',
    minEditRole: 'OWNER',
  },
  {
    key: 'IMPOSSIBLE_TRAVEL_SPEED_KMH', envVar: 'IMPOSSIBLE_TRAVEL_SPEED_KMH',
    configPath: 'impossibleTravelSpeedKmh', type: 'number', default: 900,
    group: 'security-detection', label: 'Impossible Travel Speed (km/h)',
    description: 'Maximum plausible travel speed. Logins exceeding this are flagged. 0 = disabled.',
    minEditRole: 'OWNER',
  },
  {
    key: 'LATERAL_MOVEMENT_DETECTION_ENABLED', envVar: 'LATERAL_MOVEMENT_DETECTION_ENABLED',
    configPath: 'lateralMovementEnabled', type: 'boolean', default: true,
    group: 'security-detection', label: 'Lateral Movement Detection',
    description: 'Detect and block suspicious lateral movement across targets.',
    minEditRole: 'OWNER',
  },
  {
    key: 'LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS', envVar: 'LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS',
    configPath: 'lateralMovementMaxDistinctTargets', type: 'number', default: 10,
    group: 'security-detection', label: 'Max Distinct Targets',
    description: 'Maximum distinct targets a user can connect to within the detection window.',
    minEditRole: 'OWNER',
  },
  {
    key: 'LATERAL_MOVEMENT_WINDOW_MINUTES', envVar: 'LATERAL_MOVEMENT_WINDOW_MINUTES',
    configPath: 'lateralMovementWindowMinutes', type: 'number', default: 5,
    group: 'security-detection', label: 'Detection Window (min)',
    description: 'Time window for counting distinct connection targets.',
    minEditRole: 'OWNER',
  },
  {
    key: 'LATERAL_MOVEMENT_LOCKOUT_MINUTES', envVar: 'LATERAL_MOVEMENT_LOCKOUT_MINUTES',
    configPath: 'lateralMovementLockoutMinutes', type: 'number', default: 30,
    group: 'security-detection', label: 'Lockout Duration (min)',
    description: 'How long a user is blocked from new connections after a lateral movement alert.',
    minEditRole: 'OWNER',
  },

  // ── Storage & Quotas ─────────────────────────────────────────────────────
  {
    key: 'FILE_UPLOAD_MAX_SIZE', envVar: 'FILE_UPLOAD_MAX_SIZE',
    configPath: 'fileUploadMaxSize', type: 'number', default: 10485760,
    group: 'storage', label: 'Max File Upload Size (bytes)',
    description: 'Maximum size per uploaded file (default: 10 MB).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'USER_DRIVE_QUOTA', envVar: 'USER_DRIVE_QUOTA',
    configPath: 'userDriveQuota', type: 'number', default: 104857600,
    group: 'storage', label: 'User Drive Quota (bytes)',
    description: 'Maximum storage per user (default: 100 MB).',
    minEditRole: 'ADMIN',
  },
  {
    key: 'SFTP_MAX_FILE_SIZE', envVar: 'SFTP_MAX_FILE_SIZE',
    configPath: 'sftpMaxFileSize', type: 'number', default: 104857600,
    group: 'storage', label: 'SFTP Max File Size (bytes)',
    description: 'Maximum SFTP transfer size (default: 100 MB).',
    minEditRole: 'ADMIN',
  },
  { key: 'SFTP_CHUNK_SIZE', envVar: 'SFTP_CHUNK_SIZE', configPath: 'sftpChunkSize', type: 'number', default: 65536, group: 'storage', label: 'SFTP Chunk Size (bytes)', description: 'SFTP transfer chunk size (default: 64 KB).', minEditRole: 'ADMIN' },

  // ── Vault Defaults ───────────────────────────────────────────────────────
  {
    key: 'VAULT_TTL_MINUTES', envVar: 'VAULT_TTL_MINUTES',
    configPath: 'vaultTtlMinutes', type: 'number', default: 30,
    group: 'vault', label: 'Vault Session TTL (min)',
    description: 'Default vault master key session lifetime.',
    minEditRole: 'OWNER',
  },
  {
    key: 'VAULT_RATE_LIMIT_WINDOW_MS', envVar: 'VAULT_RATE_LIMIT_WINDOW_MS',
    configPath: 'vaultRateLimitWindowMs', type: 'number', default: 60000,
    group: 'vault', label: 'Vault Unlock Rate Limit Window (ms)',
    description: 'Sliding window duration for vault unlock attempts.',
    minEditRole: 'OWNER',
  },
  {
    key: 'VAULT_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'VAULT_RATE_LIMIT_MAX_ATTEMPTS',
    configPath: 'vaultRateLimitMaxAttempts', type: 'number', default: 5,
    group: 'vault', label: 'Vault Unlock Max Attempts',
    description: 'Maximum vault unlock attempts per window.',
    minEditRole: 'OWNER',
  },
  { key: 'VAULT_MFA_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'VAULT_MFA_RATE_LIMIT_MAX_ATTEMPTS', configPath: 'vaultMfaRateLimitMaxAttempts', type: 'number', default: 10, group: 'vault', label: 'Vault MFA Max Attempts', description: 'Maximum MFA attempts per vault unlock window.', minEditRole: 'OWNER' },

  // ── JWT & Tokens ─────────────────────────────────────────────────────────
  { key: 'JWT_EXPIRES_IN', envVar: 'JWT_EXPIRES_IN', configPath: 'jwtExpiresIn', type: 'string', default: '15m', group: 'jwt', label: 'Access Token Expiration', description: 'JWT access token lifetime (e.g., 15m, 1h, 2d).', minEditRole: 'OWNER' },
  { key: 'JWT_REFRESH_EXPIRES_IN', envVar: 'JWT_REFRESH_EXPIRES_IN', configPath: 'jwtRefreshExpiresIn', type: 'string', default: '7d', group: 'jwt', label: 'Refresh Token Expiration', description: 'Refresh token lifetime (e.g., 7d, 30d).', minEditRole: 'OWNER' },

  // ── Recording ────────────────────────────────────────────────────────────
  { key: 'RECORDING_ENABLED', envVar: 'RECORDING_ENABLED', configPath: 'recordingEnabled', type: 'boolean', default: false, group: 'recording', label: 'Session Recording', description: 'Enable automatic recording of SSH/RDP/VNC sessions.', minEditRole: 'ADMIN' },
  { key: 'RECORDING_RETENTION_DAYS', envVar: 'RECORDING_RETENTION_DAYS', configPath: 'recordingRetentionDays', type: 'number', default: 90, group: 'recording', label: 'Recording Retention (days)', description: 'How many days to keep recordings before auto-cleanup.', minEditRole: 'ADMIN' },
  { key: 'GUACENC_SERVICE_URL', envVar: 'GUACENC_SERVICE_URL', configPath: 'guacencServiceUrl', type: 'string', default: 'http://guacenc:3003', group: 'recording', label: 'Guacenc Service URL', description: 'URL of the guacenc video conversion sidecar.', minEditRole: 'ADMIN' },
  { key: 'GUACENC_TIMEOUT_MS', envVar: 'GUACENC_TIMEOUT_MS', configPath: 'guacencTimeoutMs', type: 'number', default: 120000, group: 'recording', label: 'Guacenc Timeout (ms)', description: 'Timeout for guacenc video conversion requests.', minEditRole: 'ADMIN' },

  // ── Key Rotation ─────────────────────────────────────────────────────────
  { key: 'KEY_ROTATION_CRON', envVar: 'KEY_ROTATION_CRON', configPath: 'keyRotationCron', type: 'string', default: '0 2 * * *', group: 'key-rotation', label: 'Key Rotation Schedule (cron)', description: 'Cron expression for the SSH key rotation check job.', minEditRole: 'OWNER' },
  { key: 'KEY_ROTATION_ADVANCE_DAYS', envVar: 'KEY_ROTATION_ADVANCE_DAYS', configPath: 'keyRotationAdvanceDays', type: 'number', default: 7, group: 'key-rotation', label: 'Rotation Advance (days)', description: 'How many days before expiration to trigger key rotation.', minEditRole: 'OWNER' },

  // ── WebAuthn RP ──────────────────────────────────────────────────────────
  { key: 'WEBAUTHN_RP_ID', envVar: 'WEBAUTHN_RP_ID', configPath: 'webauthn.rpId', type: 'string', default: 'localhost', group: 'webauthn', label: 'Relying Party ID', description: 'WebAuthn relying party identifier (usually the domain name).', minEditRole: 'OWNER' },
  { key: 'WEBAUTHN_RP_ORIGIN', envVar: 'WEBAUTHN_RP_ORIGIN', configPath: 'webauthn.rpOrigin', type: 'string', default: 'http://localhost:3000', group: 'webauthn', label: 'Relying Party Origin', description: 'Exact origin expected by the browser (scheme + domain + port).', minEditRole: 'OWNER' },
  { key: 'WEBAUTHN_RP_NAME', envVar: 'WEBAUTHN_RP_NAME', configPath: 'webauthn.rpName', type: 'string', default: 'Arsenale', group: 'webauthn', label: 'Relying Party Name', description: 'Human-readable name shown in browser/authenticator prompts.', minEditRole: 'OWNER' },

  // ── Email Provider ───────────────────────────────────────────────────────
  { key: 'EMAIL_PROVIDER', envVar: 'EMAIL_PROVIDER', configPath: 'emailProvider', type: 'select', default: 'smtp', options: ['smtp', 'sendgrid', 'ses', 'resend', 'mailgun'], group: 'email', label: 'Email Provider', description: 'Email delivery provider.', minEditRole: 'OWNER' },
  { key: 'SMTP_HOST', envVar: 'SMTP_HOST', configPath: 'smtpHost', type: 'string', default: '', group: 'email', label: 'SMTP Host', description: 'SMTP server hostname.', minEditRole: 'OWNER' },
  { key: 'SMTP_PORT', envVar: 'SMTP_PORT', configPath: 'smtpPort', type: 'number', default: 587, group: 'email', label: 'SMTP Port', description: 'SMTP server port.', minEditRole: 'OWNER' },
  { key: 'SMTP_USER', envVar: 'SMTP_USER', configPath: 'smtpUser', type: 'string', default: '', group: 'email', label: 'SMTP User', description: 'SMTP authentication username.', minEditRole: 'OWNER' },
  { key: 'SMTP_PASS', envVar: 'SMTP_PASS', configPath: 'smtpPass', type: 'string', default: '', group: 'email', label: 'SMTP Password', description: 'SMTP authentication password.', minEditRole: 'OWNER', sensitive: true },
  { key: 'SMTP_FROM', envVar: 'SMTP_FROM', configPath: 'smtpFrom', type: 'string', default: 'noreply@example.com', group: 'email', label: 'SMTP From Address', description: 'Default sender email address.', minEditRole: 'OWNER' },
  { key: 'SENDGRID_API_KEY', envVar: 'SENDGRID_API_KEY', configPath: 'sendgridApiKey', type: 'string', default: '', group: 'email', label: 'SendGrid API Key', description: 'SendGrid API key (requires EMAIL_PROVIDER=sendgrid).', minEditRole: 'OWNER', sensitive: true },
  { key: 'AWS_SES_REGION', envVar: 'AWS_SES_REGION', configPath: 'sesRegion', type: 'string', default: 'us-east-1', group: 'email', label: 'AWS SES Region', description: 'AWS region for SES email delivery.', minEditRole: 'OWNER' },
  { key: 'AWS_SES_ACCESS_KEY_ID', envVar: 'AWS_SES_ACCESS_KEY_ID', configPath: 'sesAccessKeyId', type: 'string', default: '', group: 'email', label: 'AWS SES Access Key ID', description: 'IAM access key for SES. Leave empty to use IAM roles.', minEditRole: 'OWNER', sensitive: true },
  { key: 'AWS_SES_SECRET_ACCESS_KEY', envVar: 'AWS_SES_SECRET_ACCESS_KEY', configPath: 'sesSecretAccessKey', type: 'string', default: '', group: 'email', label: 'AWS SES Secret Access Key', description: 'IAM secret key for SES.', minEditRole: 'OWNER', sensitive: true },
  { key: 'RESEND_API_KEY', envVar: 'RESEND_API_KEY', configPath: 'resendApiKey', type: 'string', default: '', group: 'email', label: 'Resend API Key', description: 'Resend API key (requires EMAIL_PROVIDER=resend).', minEditRole: 'OWNER', sensitive: true },
  { key: 'MAILGUN_API_KEY', envVar: 'MAILGUN_API_KEY', configPath: 'mailgunApiKey', type: 'string', default: '', group: 'email', label: 'Mailgun API Key', description: 'Mailgun API key (requires EMAIL_PROVIDER=mailgun).', minEditRole: 'OWNER', sensitive: true },
  { key: 'MAILGUN_DOMAIN', envVar: 'MAILGUN_DOMAIN', configPath: 'mailgunDomain', type: 'string', default: '', group: 'email', label: 'Mailgun Domain', description: 'Mailgun sending domain.', minEditRole: 'OWNER' },
  { key: 'MAILGUN_REGION', envVar: 'MAILGUN_REGION', configPath: 'mailgunRegion', type: 'select', default: 'us', options: ['us', 'eu'], group: 'email', label: 'Mailgun Region', description: 'Mailgun API region.', minEditRole: 'OWNER' },

  // ── SMS Provider ───────────────────────────────────────────────────────
  { key: 'SMS_PROVIDER', envVar: 'SMS_PROVIDER', configPath: 'smsProvider', type: 'select', default: '', options: ['', 'twilio', 'sns', 'vonage'], group: 'sms', label: 'SMS Provider', description: 'SMS delivery provider (empty = disabled, dev mode logs OTP to console).', minEditRole: 'OWNER' },
  { key: 'TWILIO_ACCOUNT_SID', envVar: 'TWILIO_ACCOUNT_SID', configPath: 'twilioAccountSid', type: 'string', default: '', group: 'sms', label: 'Twilio Account SID', description: 'Twilio account identifier (not a secret).', minEditRole: 'OWNER' },
  { key: 'TWILIO_AUTH_TOKEN', envVar: 'TWILIO_AUTH_TOKEN', configPath: 'twilioAuthToken', type: 'string', default: '', group: 'sms', label: 'Twilio Auth Token', description: 'Twilio authentication token.', minEditRole: 'OWNER', sensitive: true },
  { key: 'TWILIO_FROM_NUMBER', envVar: 'TWILIO_FROM_NUMBER', configPath: 'twilioFromNumber', type: 'string', default: '', group: 'sms', label: 'Twilio From Number', description: 'Phone number to send SMS from (e.g., +1234567890).', minEditRole: 'OWNER' },
  { key: 'AWS_SNS_REGION', envVar: 'AWS_SNS_REGION', configPath: 'snsRegion', type: 'string', default: 'us-east-1', group: 'sms', label: 'AWS SNS Region', description: 'AWS region for SNS SMS delivery.', minEditRole: 'OWNER' },
  { key: 'AWS_SNS_ACCESS_KEY_ID', envVar: 'AWS_SNS_ACCESS_KEY_ID', configPath: 'snsAccessKeyId', type: 'string', default: '', group: 'sms', label: 'AWS SNS Access Key ID', description: 'IAM access key for SNS. Leave empty to use IAM roles.', minEditRole: 'OWNER', sensitive: true },
  { key: 'AWS_SNS_SECRET_ACCESS_KEY', envVar: 'AWS_SNS_SECRET_ACCESS_KEY', configPath: 'snsSecretAccessKey', type: 'string', default: '', group: 'sms', label: 'AWS SNS Secret Access Key', description: 'IAM secret key for SNS.', minEditRole: 'OWNER', sensitive: true },
  { key: 'VONAGE_API_KEY', envVar: 'VONAGE_API_KEY', configPath: 'vonageApiKey', type: 'string', default: '', group: 'sms', label: 'Vonage API Key', description: 'Vonage API key (public identifier, not the secret).', minEditRole: 'OWNER' },
  { key: 'VONAGE_API_SECRET', envVar: 'VONAGE_API_SECRET', configPath: 'vonageApiSecret', type: 'string', default: '', group: 'sms', label: 'Vonage API Secret', description: 'Vonage API secret.', minEditRole: 'OWNER', sensitive: true },
  { key: 'VONAGE_FROM_NUMBER', envVar: 'VONAGE_FROM_NUMBER', configPath: 'vonageFromNumber', type: 'string', default: '', group: 'sms', label: 'Vonage From Number', description: 'Phone number or sender ID for Vonage SMS.', minEditRole: 'OWNER' },

  // ── SSH Proxy ────────────────────────────────────────────────────────────
  { key: 'SSH_PROXY_ENABLED', envVar: 'SSH_PROXY_ENABLED', configPath: 'sshProxy.enabled', type: 'boolean', default: false, group: 'ssh-proxy', label: 'SSH Proxy Enabled', description: 'Enable the native SSH protocol proxy.', minEditRole: 'ADMIN' },
  { key: 'SSH_PROXY_PORT', envVar: 'SSH_PROXY_PORT', configPath: 'sshProxy.port', type: 'number', default: 2222, group: 'ssh-proxy', label: 'SSH Proxy Port', description: 'Port the SSH proxy listens on.', minEditRole: 'ADMIN' },
  { key: 'SSH_PROXY_AUTH_METHODS', envVar: 'SSH_PROXY_AUTH_METHODS', configPath: 'sshProxy.allowedAuthMethods', type: 'string', default: 'token,keyboard-interactive', group: 'ssh-proxy', label: 'SSH Proxy Auth Methods', description: 'Comma-separated allowed auth methods (token, keyboard-interactive, certificate).', minEditRole: 'ADMIN' },
  { key: 'SSH_PROXY_TOKEN_TTL_SECONDS', envVar: 'SSH_PROXY_TOKEN_TTL_SECONDS', configPath: 'sshProxy.tokenTtlSeconds', type: 'number', default: 300, group: 'ssh-proxy', label: 'SSH Token TTL (s)', description: 'SSH proxy authentication token lifetime.', minEditRole: 'ADMIN' },
  { key: 'SSH_PROXY_KEYSTROKE_RECORDING', envVar: 'SSH_PROXY_KEYSTROKE_RECORDING', configPath: 'sshProxy.keystrokeRecording', type: 'boolean', default: false, group: 'ssh-proxy', label: 'Keystroke Recording', description: 'Record keystrokes for SSH proxy sessions.', minEditRole: 'ADMIN' },

  // ── Orchestration ────────────────────────────────────────────────────────
  { key: 'ORCHESTRATOR_TYPE', envVar: 'ORCHESTRATOR_TYPE', configPath: 'orchestratorType', type: 'select', default: '', options: ['', 'docker', 'podman', 'kubernetes', 'none'], group: 'orchestration', label: 'Orchestrator Type', description: 'Container orchestrator (empty = auto-detect).', minEditRole: 'ADMIN' },
  { key: 'ORCHESTRATOR_SSH_GATEWAY_IMAGE', envVar: 'ORCHESTRATOR_SSH_GATEWAY_IMAGE', configPath: 'orchestratorSshGatewayImage', type: 'string', default: 'ghcr.io/dnviti/arsenale/ssh-gateway:latest', group: 'orchestration', label: 'SSH Gateway Image', description: 'Container image for managed SSH gateways.', minEditRole: 'ADMIN' },
  { key: 'ORCHESTRATOR_GUACD_IMAGE', envVar: 'ORCHESTRATOR_GUACD_IMAGE', configPath: 'orchestratorGuacdImage', type: 'string', default: 'guacamole/guacd:1.6.0', group: 'orchestration', label: 'Guacd Image', description: 'Container image for Guacamole daemon.', minEditRole: 'ADMIN' },
  { key: 'ORCHESTRATOR_DB_PROXY_IMAGE', envVar: 'ORCHESTRATOR_DB_PROXY_IMAGE', configPath: 'orchestratorDbProxyImage', type: 'string', default: 'ghcr.io/dnviti/arsenale/db-proxy:latest', group: 'orchestration', label: 'DB Proxy Image', description: 'Container image for database proxy.', minEditRole: 'ADMIN' },

  // ── OAuth: Google ──────────────────────────────────────────────────────
  { key: 'GOOGLE_CLIENT_ID', envVar: 'GOOGLE_CLIENT_ID', configPath: 'oauth.google.clientId', type: 'string', default: '', group: 'oauth-google', label: 'Client ID', description: 'OAuth client ID from Google Cloud Console. Setting this enables Google login.', minEditRole: 'OWNER' },
  { key: 'GOOGLE_CLIENT_SECRET', envVar: 'GOOGLE_CLIENT_SECRET', configPath: 'oauth.google.clientSecret', type: 'string', default: '', group: 'oauth-google', label: 'Client Secret', description: 'OAuth client secret from Google Cloud Console.', minEditRole: 'OWNER', sensitive: true },
  { key: 'GOOGLE_CALLBACK_URL', envVar: 'GOOGLE_CALLBACK_URL', configPath: 'oauth.google.callbackUrl', type: 'string', default: 'http://localhost:3001/api/auth/oauth/google/callback', group: 'oauth-google', label: 'Callback URL', description: 'OAuth redirect URI (must match Google Console).', minEditRole: 'OWNER' },
  { key: 'GOOGLE_HD', envVar: 'GOOGLE_HD', configPath: 'oauth.google.hd', type: 'string', default: '', group: 'oauth-google', label: 'Hosted Domain (hd)', description: 'Restrict login to a specific Google Workspace domain (e.g., example.com). Leave empty for any domain.', minEditRole: 'OWNER' },

  // ── OAuth: Microsoft ───────────────────────────────────────────────────
  { key: 'MICROSOFT_CLIENT_ID', envVar: 'MICROSOFT_CLIENT_ID', configPath: 'oauth.microsoft.clientId', type: 'string', default: '', group: 'oauth-microsoft', label: 'Client ID', description: 'Application (client) ID from Azure AD. Setting this enables Microsoft login.', minEditRole: 'OWNER' },
  { key: 'MICROSOFT_CLIENT_SECRET', envVar: 'MICROSOFT_CLIENT_SECRET', configPath: 'oauth.microsoft.clientSecret', type: 'string', default: '', group: 'oauth-microsoft', label: 'Client Secret', description: 'Client secret from Azure AD.', minEditRole: 'OWNER', sensitive: true },
  { key: 'MICROSOFT_CALLBACK_URL', envVar: 'MICROSOFT_CALLBACK_URL', configPath: 'oauth.microsoft.callbackUrl', type: 'string', default: 'http://localhost:3001/api/auth/oauth/microsoft/callback', group: 'oauth-microsoft', label: 'Callback URL', description: 'OAuth redirect URI (must match Azure AD app registration).', minEditRole: 'OWNER' },
  { key: 'MICROSOFT_TENANT_ID', envVar: 'MICROSOFT_TENANT_ID', configPath: 'oauth.microsoft.tenantId', type: 'string', default: 'common', group: 'oauth-microsoft', label: 'Tenant ID', description: 'Azure AD tenant ID. Use "common" for multi-tenant, or a specific tenant UUID.', minEditRole: 'OWNER' },

  // ── OAuth: GitHub ──────────────────────────────────────────────────────
  { key: 'GITHUB_CLIENT_ID', envVar: 'GITHUB_CLIENT_ID', configPath: 'oauth.github.clientId', type: 'string', default: '', group: 'oauth-github', label: 'Client ID', description: 'OAuth App client ID from GitHub. Setting this enables GitHub login.', minEditRole: 'OWNER' },
  { key: 'GITHUB_CLIENT_SECRET', envVar: 'GITHUB_CLIENT_SECRET', configPath: 'oauth.github.clientSecret', type: 'string', default: '', group: 'oauth-github', label: 'Client Secret', description: 'OAuth App client secret from GitHub.', minEditRole: 'OWNER', sensitive: true },
  { key: 'GITHUB_CALLBACK_URL', envVar: 'GITHUB_CALLBACK_URL', configPath: 'oauth.github.callbackUrl', type: 'string', default: 'http://localhost:3001/api/auth/oauth/github/callback', group: 'oauth-github', label: 'Callback URL', description: 'OAuth redirect URI (must match GitHub app settings).', minEditRole: 'OWNER' },

  // ── OAuth: OIDC ────────────────────────────────────────────────────────
  { key: 'OIDC_PROVIDER_NAME', envVar: 'OIDC_PROVIDER_NAME', configPath: 'oauth.oidc.providerName', type: 'string', default: 'SSO', group: 'oauth-oidc', label: 'Provider Name', description: 'Human-readable label shown on the login button (e.g., "Authentik", "Keycloak").', minEditRole: 'OWNER' },
  { key: 'OIDC_ISSUER_URL', envVar: 'OIDC_ISSUER_URL', configPath: 'oauth.oidc.issuerUrl', type: 'string', default: '', group: 'oauth-oidc', label: 'Issuer URL', description: 'OIDC issuer base URL for discovery (e.g., https://auth.example.com/realms/main).', minEditRole: 'OWNER' },
  { key: 'OIDC_CLIENT_ID', envVar: 'OIDC_CLIENT_ID', configPath: 'oauth.oidc.clientId', type: 'string', default: '', group: 'oauth-oidc', label: 'Client ID', description: 'OIDC client identifier. Setting this enables OIDC login.', minEditRole: 'OWNER' },
  { key: 'OIDC_CLIENT_SECRET', envVar: 'OIDC_CLIENT_SECRET', configPath: 'oauth.oidc.clientSecret', type: 'string', default: '', group: 'oauth-oidc', label: 'Client Secret', description: 'OIDC client secret.', minEditRole: 'OWNER', sensitive: true },
  { key: 'OIDC_CALLBACK_URL', envVar: 'OIDC_CALLBACK_URL', configPath: 'oauth.oidc.callbackUrl', type: 'string', default: 'http://localhost:3001/api/auth/oauth/oidc/callback', group: 'oauth-oidc', label: 'Callback URL', description: 'OIDC redirect URI (must match IdP client configuration).', minEditRole: 'OWNER' },
  { key: 'OIDC_SCOPES', envVar: 'OIDC_SCOPES', configPath: 'oauth.oidc.scopes', type: 'string', default: 'openid profile email', group: 'oauth-oidc', label: 'Scopes', description: 'Space-separated OIDC scopes to request.', minEditRole: 'OWNER' },

  // ── OAuth: SAML ────────────────────────────────────────────────────────
  { key: 'SAML_PROVIDER_NAME', envVar: 'SAML_PROVIDER_NAME', configPath: 'oauth.saml.providerName', type: 'string', default: 'SAML SSO', group: 'oauth-saml', label: 'Provider Name', description: 'Human-readable label shown on the login button.', minEditRole: 'OWNER' },
  { key: 'SAML_ENTRY_POINT', envVar: 'SAML_ENTRY_POINT', configPath: 'oauth.saml.entryPoint', type: 'string', default: '', group: 'oauth-saml', label: 'Entry Point URL', description: 'IdP SSO URL. Setting this enables SAML login.', minEditRole: 'OWNER' },
  { key: 'SAML_ISSUER', envVar: 'SAML_ISSUER', configPath: 'oauth.saml.issuer', type: 'string', default: 'arsenale', group: 'oauth-saml', label: 'Issuer / Entity ID', description: 'Service Provider entity ID sent to the IdP.', minEditRole: 'OWNER' },
  { key: 'SAML_CALLBACK_URL', envVar: 'SAML_CALLBACK_URL', configPath: 'oauth.saml.callbackUrl', type: 'string', default: 'http://localhost:3001/api/auth/saml/callback', group: 'oauth-saml', label: 'Callback URL (ACS)', description: 'Assertion Consumer Service URL (must match IdP config).', minEditRole: 'OWNER' },
  { key: 'SAML_CERT', envVar: 'SAML_CERT', configPath: 'oauth.saml.cert', type: 'string', default: '', group: 'oauth-saml', label: 'IdP Certificate', description: 'PEM-encoded X.509 certificate of the IdP for signature verification.', minEditRole: 'OWNER', sensitive: true },
  { key: 'SAML_METADATA_URL', envVar: 'SAML_METADATA_URL', configPath: 'oauth.saml.metadataUrl', type: 'string', default: '', group: 'oauth-saml', label: 'Metadata URL', description: 'IdP metadata URL for automatic configuration.', minEditRole: 'OWNER' },
  { key: 'SAML_WANT_AUTHN_RESPONSE_SIGNED', envVar: 'SAML_WANT_AUTHN_RESPONSE_SIGNED', configPath: 'oauth.saml.wantAuthnResponseSigned', type: 'boolean', default: true, group: 'oauth-saml', label: 'Require Signed Response', description: 'Require the IdP to sign the SAML response.', minEditRole: 'OWNER' },

  // ── Rate Limiting: Advanced ─────────────────────────────────────────────
  { key: 'SESSION_RATE_LIMIT_WINDOW_MS', envVar: 'SESSION_RATE_LIMIT_WINDOW_MS', configPath: 'sessionRateLimitWindowMs', type: 'number', default: 60000, group: 'rate-limiting-advanced', label: 'Session Rate Limit Window (ms)', description: 'Sliding window for session creation attempts.', minEditRole: 'OWNER' },
  { key: 'SESSION_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'SESSION_RATE_LIMIT_MAX_ATTEMPTS', configPath: 'sessionRateLimitMaxAttempts', type: 'number', default: 20, group: 'rate-limiting-advanced', label: 'Session Rate Limit Max', description: 'Max session creation attempts per window.', minEditRole: 'OWNER' },
  { key: 'OAUTH_FLOW_RATE_LIMIT_WINDOW_MS', envVar: 'OAUTH_FLOW_RATE_LIMIT_WINDOW_MS', configPath: 'oauthFlowRateLimitWindowMs', type: 'number', default: 900000, group: 'rate-limiting-advanced', label: 'OAuth Flow Rate Limit Window (ms)', description: 'Sliding window for OAuth login flow attempts.', minEditRole: 'OWNER' },
  { key: 'OAUTH_FLOW_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'OAUTH_FLOW_RATE_LIMIT_MAX_ATTEMPTS', configPath: 'oauthFlowRateLimitMaxAttempts', type: 'number', default: 20, group: 'rate-limiting-advanced', label: 'OAuth Flow Rate Limit Max', description: 'Max OAuth flow attempts per window.', minEditRole: 'OWNER' },
  { key: 'OAUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS', envVar: 'OAUTH_ACCOUNT_RATE_LIMIT_WINDOW_MS', configPath: 'oauthAccountRateLimitWindowMs', type: 'number', default: 60000, group: 'rate-limiting-advanced', label: 'OAuth Account Rate Limit Window (ms)', description: 'Sliding window for OAuth account operations.', minEditRole: 'OWNER' },
  { key: 'OAUTH_ACCOUNT_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'OAUTH_ACCOUNT_RATE_LIMIT_MAX_ATTEMPTS', configPath: 'oauthAccountRateLimitMaxAttempts', type: 'number', default: 15, group: 'rate-limiting-advanced', label: 'OAuth Account Rate Limit Max', description: 'Max OAuth account operations per window.', minEditRole: 'OWNER' },
  { key: 'OAUTH_LINK_RATE_LIMIT_WINDOW_MS', envVar: 'OAUTH_LINK_RATE_LIMIT_WINDOW_MS', configPath: 'oauthLinkRateLimitWindowMs', type: 'number', default: 900000, group: 'rate-limiting-advanced', label: 'OAuth Link Rate Limit Window (ms)', description: 'Sliding window for OAuth account linking.', minEditRole: 'OWNER' },
  { key: 'OAUTH_LINK_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'OAUTH_LINK_RATE_LIMIT_MAX_ATTEMPTS', configPath: 'oauthLinkRateLimitMaxAttempts', type: 'number', default: 10, group: 'rate-limiting-advanced', label: 'OAuth Link Rate Limit Max', description: 'Max OAuth account link attempts per window.', minEditRole: 'OWNER' },

  // ── LDAP ────────────────────────────────────────────────────────────────
  { key: 'LDAP_ENABLED', envVar: 'LDAP_ENABLED', configPath: 'ldap.enabled', type: 'boolean', default: false, group: 'ldap', label: 'LDAP Enabled', description: 'Enable LDAP/FreeIPA authentication provider.', minEditRole: 'OWNER' },
  { key: 'LDAP_PROVIDER_NAME', envVar: 'LDAP_PROVIDER_NAME', configPath: 'ldap.providerName', type: 'string', default: 'LDAP', group: 'ldap', label: 'Provider Name', description: 'Human-readable label shown on the login button.', minEditRole: 'OWNER' },
  { key: 'LDAP_SERVER_URL', envVar: 'LDAP_SERVER_URL', configPath: 'ldap.serverUrl', type: 'string', default: '', group: 'ldap', label: 'Server URL', description: 'LDAP server URL (e.g., ldaps://ldap.example.com:636).', minEditRole: 'OWNER' },
  { key: 'LDAP_BASE_DN', envVar: 'LDAP_BASE_DN', configPath: 'ldap.baseDn', type: 'string', default: '', group: 'ldap', label: 'Base DN', description: 'Base distinguished name for LDAP searches.', minEditRole: 'OWNER' },
  { key: 'LDAP_BIND_DN', envVar: 'LDAP_BIND_DN', configPath: 'ldap.bindDn', type: 'string', default: '', group: 'ldap', label: 'Bind DN', description: 'Distinguished name for LDAP bind (service account).', minEditRole: 'OWNER' },
  { key: 'LDAP_BIND_PASSWORD', envVar: 'LDAP_BIND_PASSWORD', configPath: 'ldap.bindPassword', type: 'string', default: '', group: 'ldap', label: 'Bind Password', description: 'Password for the LDAP bind account.', minEditRole: 'OWNER', sensitive: true },
  { key: 'LDAP_USER_SEARCH_FILTER', envVar: 'LDAP_USER_SEARCH_FILTER', configPath: 'ldap.userSearchFilter', type: 'string', default: '(uid={{username}})', group: 'ldap', label: 'User Search Filter', description: 'LDAP filter for user lookup. Use {{username}} as placeholder.', minEditRole: 'OWNER' },
  { key: 'LDAP_USER_SEARCH_BASE', envVar: 'LDAP_USER_SEARCH_BASE', configPath: 'ldap.userSearchBase', type: 'string', default: '', group: 'ldap', label: 'User Search Base', description: 'Base DN for user searches (defaults to Base DN if empty).', minEditRole: 'OWNER' },
  { key: 'LDAP_DISPLAY_NAME_ATTR', envVar: 'LDAP_DISPLAY_NAME_ATTR', configPath: 'ldap.displayNameAttr', type: 'string', default: 'displayName', group: 'ldap', label: 'Display Name Attribute', description: 'LDAP attribute for the user display name.', minEditRole: 'OWNER' },
  { key: 'LDAP_EMAIL_ATTR', envVar: 'LDAP_EMAIL_ATTR', configPath: 'ldap.emailAttr', type: 'string', default: 'mail', group: 'ldap', label: 'Email Attribute', description: 'LDAP attribute for the user email address.', minEditRole: 'OWNER' },
  { key: 'LDAP_UID_ATTR', envVar: 'LDAP_UID_ATTR', configPath: 'ldap.uidAttr', type: 'string', default: 'uid', group: 'ldap', label: 'UID Attribute', description: 'LDAP attribute for the unique user identifier.', minEditRole: 'OWNER' },
  { key: 'LDAP_GROUP_BASE_DN', envVar: 'LDAP_GROUP_BASE_DN', configPath: 'ldap.groupBaseDn', type: 'string', default: '', group: 'ldap', label: 'Group Base DN', description: 'Base DN for group searches.', minEditRole: 'OWNER' },
  { key: 'LDAP_GROUP_SEARCH_FILTER', envVar: 'LDAP_GROUP_SEARCH_FILTER', configPath: 'ldap.groupSearchFilter', type: 'string', default: '(objectClass=groupOfNames)', group: 'ldap', label: 'Group Search Filter', description: 'LDAP filter for group lookup.', minEditRole: 'OWNER' },
  { key: 'LDAP_GROUP_MEMBER_ATTR', envVar: 'LDAP_GROUP_MEMBER_ATTR', configPath: 'ldap.groupMemberAttr', type: 'string', default: 'member', group: 'ldap', label: 'Group Member Attribute', description: 'LDAP attribute listing group members.', minEditRole: 'OWNER' },
  { key: 'LDAP_GROUP_NAME_ATTR', envVar: 'LDAP_GROUP_NAME_ATTR', configPath: 'ldap.groupNameAttr', type: 'string', default: 'cn', group: 'ldap', label: 'Group Name Attribute', description: 'LDAP attribute for the group name.', minEditRole: 'OWNER' },
  { key: 'LDAP_ALLOWED_GROUPS', envVar: 'LDAP_ALLOWED_GROUPS', configPath: 'ldap.allowedGroups', type: 'string', default: '', group: 'ldap', label: 'Allowed Groups', description: 'Comma-separated list of groups allowed to log in. Empty = all groups.', minEditRole: 'OWNER' },
  { key: 'LDAP_STARTTLS', envVar: 'LDAP_STARTTLS', configPath: 'ldap.starttls', type: 'boolean', default: false, group: 'ldap', label: 'StartTLS', description: 'Upgrade the connection to TLS via STARTTLS.', minEditRole: 'OWNER' },
  { key: 'LDAP_TLS_REJECT_UNAUTHORIZED', envVar: 'LDAP_TLS_REJECT_UNAUTHORIZED', configPath: 'ldap.tlsRejectUnauthorized', type: 'boolean', default: true, group: 'ldap', label: 'TLS Reject Unauthorized', description: 'Reject connections with invalid TLS certificates.', minEditRole: 'OWNER' },
  { key: 'LDAP_SYNC_ENABLED', envVar: 'LDAP_SYNC_ENABLED', configPath: 'ldap.syncEnabled', type: 'boolean', default: false, group: 'ldap', label: 'Sync Enabled', description: 'Enable periodic LDAP user/group synchronization.', minEditRole: 'OWNER' },
  { key: 'LDAP_SYNC_CRON', envVar: 'LDAP_SYNC_CRON', configPath: 'ldap.syncCron', type: 'string', default: '0 */6 * * *', group: 'ldap', label: 'Sync Schedule (cron)', description: 'Cron expression for LDAP synchronization.', minEditRole: 'OWNER' },
  { key: 'LDAP_AUTO_PROVISION', envVar: 'LDAP_AUTO_PROVISION', configPath: 'ldap.autoProvision', type: 'boolean', default: true, group: 'ldap', label: 'Auto Provision Users', description: 'Automatically create users on first LDAP login.', minEditRole: 'OWNER' },
  { key: 'LDAP_DEFAULT_TENANT_ID', envVar: 'LDAP_DEFAULT_TENANT_ID', configPath: 'ldap.defaultTenantId', type: 'string', default: '', group: 'ldap', label: 'Default Tenant ID', description: 'Tenant to assign auto-provisioned LDAP users to.', minEditRole: 'OWNER' },

  // ── AI / LLM Integration ─────────────────────────────────────────────────
  { key: 'AI_PROVIDER', envVar: 'AI_PROVIDER', configPath: 'ai.provider', type: 'select', default: '', options: ['', 'anthropic', 'openai', 'ollama', 'openai-compatible'], group: 'ai', label: 'AI Provider', description: 'LLM provider for AI features. Leave empty to disable.', minEditRole: 'ADMIN' },
  { key: 'AI_API_KEY', envVar: 'AI_API_KEY', configPath: 'ai.apiKey', type: 'string', default: '', group: 'ai', label: 'API Key', description: 'API key for the selected provider (not required for Ollama).', minEditRole: 'ADMIN', sensitive: true },
  { key: 'AI_MODEL', envVar: 'AI_MODEL', configPath: 'ai.model', type: 'string', default: '', group: 'ai', label: 'Model', description: 'Default model name (e.g., claude-sonnet-4-20250514, gpt-4o, llama3.1:8b). Empty uses provider default.', minEditRole: 'ADMIN' },
  { key: 'AI_BASE_URL', envVar: 'AI_BASE_URL', configPath: 'ai.baseUrl', type: 'string', default: '', group: 'ai', label: 'Base URL', description: 'API base URL. Required for Ollama (e.g., http://localhost:11434) and OpenAI-compatible providers.', minEditRole: 'ADMIN' },
  { key: 'AI_MAX_TOKENS', envVar: 'AI_MAX_TOKENS', configPath: 'ai.maxTokens', type: 'number', default: 4096, group: 'ai', label: 'Max Tokens', description: 'Maximum number of tokens in the AI response.', minEditRole: 'ADMIN' },
  { key: 'AI_TEMPERATURE', envVar: 'AI_TEMPERATURE', configPath: 'ai.temperature', type: 'number', default: 0.2, group: 'ai', label: 'Temperature', description: 'Sampling temperature (0-1). Lower values produce more deterministic results.', minEditRole: 'ADMIN' },
  { key: 'AI_TIMEOUT_MS', envVar: 'AI_TIMEOUT_MS', configPath: 'ai.timeoutMs', type: 'number', default: 60000, group: 'ai', label: 'Timeout (ms)', description: 'Request timeout in milliseconds. Increase for slower local models.', minEditRole: 'ADMIN' },
  { key: 'AI_QUERY_GENERATION_ENABLED', envVar: 'AI_QUERY_GENERATION_ENABLED', configPath: 'ai.queryGenerationEnabled', type: 'boolean', default: false, group: 'ai', label: 'Query Generation', description: 'Enable AI-powered natural-language-to-SQL query generation.', minEditRole: 'ADMIN' },
  { key: 'AI_QUERY_GENERATION_MODEL', envVar: 'AI_QUERY_GENERATION_MODEL', configPath: 'ai.queryGenerationModel', type: 'string', default: '', group: 'ai', label: 'Query Generation Model', description: 'Override model for SQL query generation. Leave empty to use the default model above.', minEditRole: 'ADMIN' },
  { key: 'AI_MAX_REQUESTS_PER_DAY', envVar: 'AI_MAX_REQUESTS_PER_DAY', configPath: 'ai.maxRequestsPerDay', type: 'number', default: 100, group: 'ai', label: 'Query Generation Daily Limit', description: 'Maximum AI query generation requests per tenant per day.', minEditRole: 'ADMIN' },

  // ── Gateway Routing ─────────────────────────────────────────────────────
  { key: 'GATEWAY_ROUTING_MODE', envVar: 'GATEWAY_ROUTING_MODE', configPath: 'gatewayRoutingMode', type: 'select', default: 'gateway-mandatory', options: ['gateway-mandatory'], group: 'gateway', label: 'Gateway Routing Mode', description: 'All connections must flow through gateway agents. No direct connections are allowed without a configured gateway.', minEditRole: 'ADMIN', restartRequired: false },
  { key: 'GATEWAY_HEALTH_CHECK_INTERVAL_MS', envVar: 'GATEWAY_HEALTH_CHECK_INTERVAL_MS', configPath: 'gatewayHealthCheckIntervalMs', type: 'number', default: 30000, group: 'gateway', label: 'Health Check Interval (ms)', description: 'How often the server checks gateway availability for the readiness endpoint. Default: 30000 (30 seconds).', minEditRole: 'ADMIN', restartRequired: false },
  { key: 'GATEWAY_REQUIRED_TYPES', envVar: 'GATEWAY_REQUIRED_TYPES', configPath: 'gatewayRequiredTypes', type: 'string[]', default: 'MANAGED_SSH,GUACD,DB_PROXY', options: ['MANAGED_SSH', 'GUACD', 'DB_PROXY'], group: 'gateway', label: 'Required Gateway Types', description: 'Gateway types that must have at least one connected tunnel for the readiness check to pass in gateway-mandatory mode.', minEditRole: 'ADMIN', restartRequired: false },
];

// Group metadata for UI display ordering and labels
export const SETTING_GROUPS: { key: string; label: string; order: number }[] = [
  { key: 'feature-toggles', label: 'Feature Toggles', order: -1 },
  { key: 'general', label: 'General', order: 0 },
  { key: 'logging', label: 'Logging', order: 1 },
  { key: 'rate-limiting', label: 'Rate Limiting', order: 2 },
  { key: 'sessions', label: 'Session Defaults', order: 3 },
  { key: 'security-detection', label: 'Security Detection', order: 4 },
  { key: 'storage', label: 'Storage & Quotas', order: 5 },
  { key: 'vault', label: 'Vault Defaults', order: 6 },
  { key: 'jwt', label: 'JWT & Tokens', order: 7 },
  { key: 'recording', label: 'Recording', order: 8 },
  { key: 'key-rotation', label: 'Key Rotation', order: 9 },
  { key: 'webauthn', label: 'WebAuthn', order: 10 },
  { key: 'email', label: 'Email Provider', order: 11 },
  { key: 'sms', label: 'SMS Provider', order: 12 },
  { key: 'ssh-proxy', label: 'SSH Proxy', order: 13 },
  { key: 'orchestration', label: 'Orchestration', order: 14 },
  { key: 'oauth-google', label: 'OAuth: Google', order: 15 },
  { key: 'oauth-microsoft', label: 'OAuth: Microsoft', order: 16 },
  { key: 'oauth-github', label: 'OAuth: GitHub', order: 17 },
  { key: 'oauth-oidc', label: 'OAuth: OIDC', order: 18 },
  { key: 'oauth-saml', label: 'OAuth: SAML', order: 19 },
  { key: 'rate-limiting-advanced', label: 'Rate Limiting: Advanced', order: 20 },
  { key: 'ldap', label: 'LDAP / FreeIPA', order: 21 },
  { key: 'ai', label: 'AI / LLM', order: 22 },
  { key: 'gateway', label: 'Gateway Routing', order: 23 },
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
// invalidateCache is a no-op now that getAllSettings uses batch fetch,
// but setSetting still calls it for forward compatibility.
function invalidateCache(_key: string): void { /* no-op */ }

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------
function parseValue(raw: string | undefined, type: SettingType, defaultVal: unknown): unknown {
  if (raw === undefined || raw === '') return defaultVal;
  switch (type) {
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'number': {
      const n = Number(raw);
      return Number.isNaN(n) ? defaultVal : n;
    }
    case 'select':
    case 'string':
    case 'string[]':
      return raw;
    default:
      return raw;
  }
}

function serializeValue(value: unknown, _type: SettingType): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function getAllSettings(callerRole: TenantRoleType): Promise<SettingValue[]> {
  const callerLevel = roleLevel(callerRole);
  const results: SettingValue[] = [];

  // Batch-fetch all DB values at once to avoid N sequential queries
  const rows = await prisma.appConfig.findMany();
  const dbMap = new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

  for (const def of SETTINGS_REGISTRY) {
    const envRaw = process.env[def.envVar];
    const envLocked = envRaw !== undefined;

    let value: unknown;
    let source: 'env' | 'db' | 'default';

    if (envLocked) {
      value = parseValue(envRaw, def.type, def.default);
      source = 'env';
    } else {
      const dbVal = dbMap.get(def.key);
      if (dbVal !== undefined) {
        value = parseValue(dbVal, def.type, def.default);
        source = 'db';
      } else {
        value = def.default;
        source = 'default';
      }
    }

    const isSensitive = def.sensitive === true;
    const maskedValue = isSensitive && value !== '' && value !== undefined && value !== null
      ? SENSITIVE_MASK
      : value;

    results.push({
      key: def.key,
      value: maskedValue,
      source,
      envLocked,
      canEdit: !envLocked && callerLevel >= roleLevel(def.minEditRole),
      type: def.type,
      default: def.default,
      options: def.options,
      group: def.group,
      label: def.label,
      description: def.description,
      restartRequired: def.restartRequired ?? false,
      sensitive: isSensitive,
    });
  }

  return results;
}

export async function setSetting(
  key: string,
  value: unknown,
  callerRole: TenantRoleType,
): Promise<{ key: string; value: unknown; source: 'db' }> {
  const def = SETTINGS_REGISTRY.find(d => d.key === key);
  if (!def) throw new AppError('Unknown setting key.', 400);

  if (roleLevel(callerRole) < roleLevel(def.minEditRole)) {
    throw new AppError('Insufficient role to modify this setting.', 403);
  }

  if (process.env[def.envVar] !== undefined) {
    throw new AppError(
      `Setting "${key}" is locked by environment variable and cannot be changed via the admin panel.`,
      403,
    );
  }

  // Skip update when the client sends back the mask placeholder unchanged
  // (placed after auth + env-lock checks to prevent bypass)
  if (def.sensitive && String(value) === SENSITIVE_MASK) {
    return { key, value: SENSITIVE_MASK, source: 'db' as const };
  }

  const serialized = serializeValue(value, def.type);
  await prisma.appConfig.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });

  // Hot-patch the in-memory config so settings take effect without restart
  if (def.configPath) {
    const parsed = parseValue(serialized, def.type, def.default);
    setNestedValue(config, def.configPath, parsed);

    // Special handling for derived fields
    if (def.configPath.startsWith('oauth.')) {
      config.oauth.google.enabled = !!config.oauth.google.clientId;
      config.oauth.microsoft.enabled = !!config.oauth.microsoft.clientId;
      config.oauth.github.enabled = !!config.oauth.github.clientId;
      config.oauth.oidc.enabled = !!config.oauth.oidc.clientId;
      config.oauth.saml.enabled = !!config.oauth.saml.entryPoint;
    }
    if (def.key === 'LDAP_ALLOWED_GROUPS' && typeof parsed === 'string') {
      config.ldap.allowedGroups = parsed.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  invalidateCache(key);

  // Trigger live reload for the affected setting group
  await onSettingChanged(def.group);

  return { key, value, source: 'db' };
}

export async function setSettings(
  updates: Array<{ key: string; value: unknown }>,
  callerRole: TenantRoleType,
): Promise<Array<{ key: string; success: boolean; error?: string }>> {
  const results: Array<{ key: string; success: boolean; error?: string }> = [];

  for (const { key, value } of updates) {
    try {
      await setSetting(key, value, callerRole);
      results.push({ key, success: true });
    } catch (err) {
      results.push({
        key,
        success: false,
        error: err instanceof AppError ? err.message : 'Unknown error',
      });
    }
  }

  return results;
}

export async function applySystemSettings(): Promise<void> {
  try {
    const rows = await prisma.appConfig.findMany();
    const dbMap = new Map(rows.map((r: { key: string; value: string }) => [r.key, r.value]));

    for (const def of SETTINGS_REGISTRY) {
      if (!def.configPath) continue;
      if (process.env[def.envVar] !== undefined) continue;

      const dbVal = dbMap.get(def.key);
      if (dbVal === undefined) continue;

      const parsed = parseValue(dbVal, def.type, def.default);
      setNestedValue(config, def.configPath, parsed);
    }

    // Re-derive OAuth enabled flags from the (now potentially DB-patched) config values
    config.oauth.google.enabled = !!config.oauth.google.clientId;
    config.oauth.microsoft.enabled = !!config.oauth.microsoft.clientId;
    config.oauth.github.enabled = !!config.oauth.github.clientId;
    config.oauth.oidc.enabled = !!config.oauth.oidc.clientId;
    config.oauth.saml.enabled = !!config.oauth.saml.entryPoint;

    // LDAP allowedGroups is stored as comma-separated string but config expects string[]
    if (typeof config.ldap.allowedGroups === 'string') {
      config.ldap.allowedGroups = (config.ldap.allowedGroups as unknown as string)
        .split(',').map(s => s.trim()).filter(Boolean);
    }

    // gatewayRequiredTypes is stored as comma-separated string but config expects string[]
    if (typeof config.gatewayRequiredTypes === 'string') {
      config.gatewayRequiredTypes = (config.gatewayRequiredTypes as unknown as string)
        .split(',').map(s => s.trim()).filter(Boolean) as Array<'MANAGED_SSH' | 'GUACD' | 'DB_PROXY'>;
    }

    logger.info(`System settings loaded: ${rows.length} keys from database.`);
  } catch (err) {
    logger.warn('Failed to load system settings from database (using defaults):', err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
function setNestedValue(obj: any, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) return;
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
