import prisma from '../lib/prisma';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/error.middleware';
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
}

// ---------------------------------------------------------------------------
// Settings Registry — single source of truth for all UI-configurable settings
// ---------------------------------------------------------------------------
export const SETTINGS_REGISTRY: SettingDef[] = [
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
    type: 'boolean', default: true,
    group: 'general', label: 'Allow Local Network Connections',
    description: 'Allow connections to private/local network addresses (10.x, 172.16-31.x, 192.168.x).',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'CLI_ENABLED', envVar: 'CLI_ENABLED',
    type: 'boolean', default: false,
    group: 'general', label: 'CLI Enabled',
    description: 'Enable the arsenale CLI tool inside the container.',
    minEditRole: 'ADMIN', restartRequired: true,
  },

  // ── Logging ──────────────────────────────────────────────────────────────
  {
    key: 'LOG_LEVEL', envVar: 'LOG_LEVEL',
    configPath: 'logLevel', type: 'select', default: 'info',
    options: ['error', 'warn', 'info', 'verbose', 'debug'],
    group: 'logging', label: 'Log Level',
    description: 'Server log verbosity level.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'LOG_FORMAT', envVar: 'LOG_FORMAT',
    configPath: 'logFormat', type: 'select', default: 'text',
    options: ['text', 'json'],
    group: 'logging', label: 'Log Format',
    description: 'Log output format.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'LOG_TIMESTAMPS', envVar: 'LOG_TIMESTAMPS',
    configPath: 'logTimestamps', type: 'boolean', default: true,
    group: 'logging', label: 'Include Timestamps',
    description: 'Include ISO-8601 timestamps in log output.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'LOG_HTTP_REQUESTS', envVar: 'LOG_HTTP_REQUESTS',
    configPath: 'logHttpRequests', type: 'boolean', default: false,
    group: 'logging', label: 'Log HTTP Requests',
    description: 'Log HTTP requests (method, url, status, duration).',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'LOG_GUACAMOLE', envVar: 'LOG_GUACAMOLE',
    configPath: 'logGuacamole', type: 'boolean', default: true,
    group: 'logging', label: 'Log Guacamole',
    description: 'Enable guacamole-lite (RDP/VNC tunnel) logs.',
    minEditRole: 'ADMIN', restartRequired: true,
  },

  // ── Rate Limiting ────────────────────────────────────────────────────────
  {
    key: 'GLOBAL_RATE_LIMIT_WINDOW_MS', envVar: 'GLOBAL_RATE_LIMIT_WINDOW_MS',
    type: 'number', default: 60000,
    group: 'rate-limiting', label: 'Global Rate Limit Window (ms)',
    description: 'Sliding window duration for the global API rate limiter.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED', envVar: 'GLOBAL_RATE_LIMIT_MAX_AUTHENTICATED',
    type: 'number', default: 200,
    group: 'rate-limiting', label: 'Global Max Requests (Authenticated)',
    description: 'Maximum API requests per window for authenticated users.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'GLOBAL_RATE_LIMIT_MAX_ANONYMOUS', envVar: 'GLOBAL_RATE_LIMIT_MAX_ANONYMOUS',
    type: 'number', default: 60,
    group: 'rate-limiting', label: 'Global Max Requests (Anonymous)',
    description: 'Maximum API requests per window for anonymous users.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'LOGIN_RATE_LIMIT_WINDOW_MS', envVar: 'LOGIN_RATE_LIMIT_WINDOW_MS',
    configPath: 'loginRateLimitWindowMs', type: 'number', default: 900000,
    group: 'rate-limiting', label: 'Login Rate Limit Window (ms)',
    description: 'Sliding window duration for login attempts.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'LOGIN_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'LOGIN_RATE_LIMIT_MAX_ATTEMPTS',
    configPath: 'loginRateLimitMaxAttempts', type: 'number', default: 5,
    group: 'rate-limiting', label: 'Login Max Attempts',
    description: 'Maximum login attempts per IP within the window.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'ACCOUNT_LOCKOUT_THRESHOLD', envVar: 'ACCOUNT_LOCKOUT_THRESHOLD',
    configPath: 'accountLockoutThreshold', type: 'number', default: 10,
    group: 'rate-limiting', label: 'Account Lockout Threshold',
    description: 'Consecutive failed logins before account lockout.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'ACCOUNT_LOCKOUT_DURATION_MS', envVar: 'ACCOUNT_LOCKOUT_DURATION_MS',
    configPath: 'accountLockoutDurationMs', type: 'number', default: 1800000,
    group: 'rate-limiting', label: 'Account Lockout Duration (ms)',
    description: 'How long an account stays locked after exceeding the threshold.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'RATE_LIMIT_WHITELIST_CIDRS', envVar: 'RATE_LIMIT_WHITELIST_CIDRS',
    configPath: 'rateLimitWhitelistCidrs', type: 'string',
    default: '127.0.0.1/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16',
    group: 'rate-limiting', label: 'Rate Limit Whitelist CIDRs',
    description: 'Comma-separated CIDR ranges that bypass the global rate limiter.',
    minEditRole: 'ADMIN', restartRequired: true,
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
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'SESSION_IDLE_THRESHOLD_MINUTES', envVar: 'SESSION_IDLE_THRESHOLD_MINUTES',
    configPath: 'sessionIdleThresholdMinutes', type: 'number', default: 5,
    group: 'sessions', label: 'Idle Threshold (min)',
    description: 'Minutes without heartbeat before marking a session as idle.',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'SESSION_CLEANUP_RETENTION_DAYS', envVar: 'SESSION_CLEANUP_RETENTION_DAYS',
    configPath: 'sessionCleanupRetentionDays', type: 'number', default: 30,
    group: 'sessions', label: 'Cleanup Retention (days)',
    description: 'Days to retain closed session records before purging.',
    minEditRole: 'ADMIN', restartRequired: true,
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
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'USER_DRIVE_QUOTA', envVar: 'USER_DRIVE_QUOTA',
    configPath: 'userDriveQuota', type: 'number', default: 104857600,
    group: 'storage', label: 'User Drive Quota (bytes)',
    description: 'Maximum storage per user (default: 100 MB).',
    minEditRole: 'ADMIN', restartRequired: true,
  },
  {
    key: 'SFTP_MAX_FILE_SIZE', envVar: 'SFTP_MAX_FILE_SIZE',
    configPath: 'sftpMaxFileSize', type: 'number', default: 104857600,
    group: 'storage', label: 'SFTP Max File Size (bytes)',
    description: 'Maximum SFTP transfer size (default: 100 MB).',
    minEditRole: 'ADMIN', restartRequired: true,
  },

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
    minEditRole: 'OWNER', restartRequired: true,
  },
  {
    key: 'VAULT_RATE_LIMIT_MAX_ATTEMPTS', envVar: 'VAULT_RATE_LIMIT_MAX_ATTEMPTS',
    configPath: 'vaultRateLimitMaxAttempts', type: 'number', default: 5,
    group: 'vault', label: 'Vault Unlock Max Attempts',
    description: 'Maximum vault unlock attempts per window.',
    minEditRole: 'OWNER', restartRequired: true,
  },

  // ── JWT & Tokens ─────────────────────────────────────────────────────────
  { key: 'JWT_EXPIRES_IN', envVar: 'JWT_EXPIRES_IN', configPath: 'jwtExpiresIn', type: 'string', default: '15m', group: 'jwt', label: 'Access Token Expiration', description: 'JWT access token lifetime (e.g., 15m, 1h, 2d).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'JWT_REFRESH_EXPIRES_IN', envVar: 'JWT_REFRESH_EXPIRES_IN', configPath: 'jwtRefreshExpiresIn', type: 'string', default: '7d', group: 'jwt', label: 'Refresh Token Expiration', description: 'Refresh token lifetime (e.g., 7d, 30d).', minEditRole: 'OWNER', restartRequired: true },

  // ── Recording ────────────────────────────────────────────────────────────
  { key: 'RECORDING_ENABLED', envVar: 'RECORDING_ENABLED', configPath: 'recordingEnabled', type: 'boolean', default: false, group: 'recording', label: 'Session Recording', description: 'Enable automatic recording of SSH/RDP/VNC sessions.', minEditRole: 'ADMIN' },
  { key: 'RECORDING_RETENTION_DAYS', envVar: 'RECORDING_RETENTION_DAYS', configPath: 'recordingRetentionDays', type: 'number', default: 90, group: 'recording', label: 'Recording Retention (days)', description: 'How many days to keep recordings before auto-cleanup.', minEditRole: 'ADMIN' },

  // ── Key Rotation ─────────────────────────────────────────────────────────
  { key: 'KEY_ROTATION_CRON', envVar: 'KEY_ROTATION_CRON', configPath: 'keyRotationCron', type: 'string', default: '0 2 * * *', group: 'key-rotation', label: 'Key Rotation Schedule (cron)', description: 'Cron expression for the SSH key rotation check job.', minEditRole: 'OWNER', restartRequired: true },
  { key: 'KEY_ROTATION_ADVANCE_DAYS', envVar: 'KEY_ROTATION_ADVANCE_DAYS', configPath: 'keyRotationAdvanceDays', type: 'number', default: 7, group: 'key-rotation', label: 'Rotation Advance (days)', description: 'How many days before expiration to trigger key rotation.', minEditRole: 'OWNER', restartRequired: true },

  // ── WebAuthn RP ──────────────────────────────────────────────────────────
  { key: 'WEBAUTHN_RP_ID', envVar: 'WEBAUTHN_RP_ID', configPath: 'webauthn.rpId', type: 'string', default: 'localhost', group: 'webauthn', label: 'Relying Party ID', description: 'WebAuthn relying party identifier (usually the domain name).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'WEBAUTHN_RP_ORIGIN', envVar: 'WEBAUTHN_RP_ORIGIN', configPath: 'webauthn.rpOrigin', type: 'string', default: 'http://localhost:3000', group: 'webauthn', label: 'Relying Party Origin', description: 'Exact origin expected by the browser (scheme + domain + port).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'WEBAUTHN_RP_NAME', envVar: 'WEBAUTHN_RP_NAME', configPath: 'webauthn.rpName', type: 'string', default: 'Arsenale', group: 'webauthn', label: 'Relying Party Name', description: 'Human-readable name shown in browser/authenticator prompts.', minEditRole: 'OWNER', restartRequired: true },

  // ── Email Provider (non-secret fields) ───────────────────────────────────
  { key: 'EMAIL_PROVIDER', envVar: 'EMAIL_PROVIDER', configPath: 'emailProvider', type: 'select', default: 'smtp', options: ['smtp', 'sendgrid', 'ses', 'resend', 'mailgun'], group: 'email', label: 'Email Provider', description: 'Email delivery provider.', minEditRole: 'OWNER', restartRequired: true },
  { key: 'SMTP_HOST', envVar: 'SMTP_HOST', configPath: 'smtpHost', type: 'string', default: '', group: 'email', label: 'SMTP Host', description: 'SMTP server hostname.', minEditRole: 'OWNER', restartRequired: true },
  { key: 'SMTP_PORT', envVar: 'SMTP_PORT', configPath: 'smtpPort', type: 'number', default: 587, group: 'email', label: 'SMTP Port', description: 'SMTP server port.', minEditRole: 'OWNER', restartRequired: true },
  { key: 'SMTP_USER', envVar: 'SMTP_USER', configPath: 'smtpUser', type: 'string', default: '', group: 'email', label: 'SMTP User', description: 'SMTP authentication username.', minEditRole: 'OWNER', restartRequired: true },
  { key: 'SMTP_FROM', envVar: 'SMTP_FROM', configPath: 'smtpFrom', type: 'string', default: 'noreply@example.com', group: 'email', label: 'SMTP From Address', description: 'Default sender email address.', minEditRole: 'OWNER', restartRequired: true },

  // ── SMS Provider (non-secret fields) ─────────────────────────────────────
  { key: 'SMS_PROVIDER', envVar: 'SMS_PROVIDER', configPath: 'smsProvider', type: 'select', default: '', options: ['', 'twilio', 'sns', 'vonage'], group: 'sms', label: 'SMS Provider', description: 'SMS delivery provider (empty = disabled, dev mode logs OTP to console).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'TWILIO_ACCOUNT_SID', envVar: 'TWILIO_ACCOUNT_SID', configPath: 'twilioAccountSid', type: 'string', default: '', group: 'sms', label: 'Twilio Account SID', description: 'Twilio account identifier (not a secret).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'TWILIO_FROM_NUMBER', envVar: 'TWILIO_FROM_NUMBER', configPath: 'twilioFromNumber', type: 'string', default: '', group: 'sms', label: 'Twilio From Number', description: 'Phone number to send SMS from (e.g., +1234567890).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'AWS_SNS_REGION', envVar: 'AWS_SNS_REGION', configPath: 'snsRegion', type: 'string', default: 'us-east-1', group: 'sms', label: 'AWS SNS Region', description: 'AWS region for SNS SMS delivery.', minEditRole: 'OWNER', restartRequired: true },
  { key: 'VONAGE_API_KEY', envVar: 'VONAGE_API_KEY', configPath: 'vonageApiKey', type: 'string', default: '', group: 'sms', label: 'Vonage API Key', description: 'Vonage API key (public identifier, not the secret).', minEditRole: 'OWNER', restartRequired: true },
  { key: 'VONAGE_FROM_NUMBER', envVar: 'VONAGE_FROM_NUMBER', configPath: 'vonageFromNumber', type: 'string', default: '', group: 'sms', label: 'Vonage From Number', description: 'Phone number or sender ID for Vonage SMS.', minEditRole: 'OWNER', restartRequired: true },

  // ── SSH Proxy ────────────────────────────────────────────────────────────
  { key: 'SSH_PROXY_ENABLED', envVar: 'SSH_PROXY_ENABLED', configPath: 'sshProxy.enabled', type: 'boolean', default: false, group: 'ssh-proxy', label: 'SSH Proxy Enabled', description: 'Enable the native SSH protocol proxy.', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'SSH_PROXY_PORT', envVar: 'SSH_PROXY_PORT', configPath: 'sshProxy.port', type: 'number', default: 2222, group: 'ssh-proxy', label: 'SSH Proxy Port', description: 'Port the SSH proxy listens on.', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'SSH_PROXY_AUTH_METHODS', envVar: 'SSH_PROXY_AUTH_METHODS', configPath: 'sshProxy.allowedAuthMethods', type: 'string', default: 'token,keyboard-interactive', group: 'ssh-proxy', label: 'SSH Proxy Auth Methods', description: 'Comma-separated allowed auth methods (token, keyboard-interactive, certificate).', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'SSH_PROXY_TOKEN_TTL_SECONDS', envVar: 'SSH_PROXY_TOKEN_TTL_SECONDS', configPath: 'sshProxy.tokenTtlSeconds', type: 'number', default: 300, group: 'ssh-proxy', label: 'SSH Token TTL (s)', description: 'SSH proxy authentication token lifetime.', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'SSH_PROXY_KEYSTROKE_RECORDING', envVar: 'SSH_PROXY_KEYSTROKE_RECORDING', configPath: 'sshProxy.keystrokeRecording', type: 'boolean', default: false, group: 'ssh-proxy', label: 'Keystroke Recording', description: 'Record keystrokes for SSH proxy sessions.', minEditRole: 'ADMIN', restartRequired: true },

  // ── Orchestration ────────────────────────────────────────────────────────
  { key: 'ORCHESTRATOR_TYPE', envVar: 'ORCHESTRATOR_TYPE', configPath: 'orchestratorType', type: 'select', default: '', options: ['', 'docker', 'podman', 'kubernetes', 'none'], group: 'orchestration', label: 'Orchestrator Type', description: 'Container orchestrator (empty = auto-detect).', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'ORCHESTRATOR_SSH_GATEWAY_IMAGE', envVar: 'ORCHESTRATOR_SSH_GATEWAY_IMAGE', configPath: 'orchestratorSshGatewayImage', type: 'string', default: 'ghcr.io/dnviti/arsenale/ssh-gateway:latest', group: 'orchestration', label: 'SSH Gateway Image', description: 'Container image for managed SSH gateways.', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'ORCHESTRATOR_GUACD_IMAGE', envVar: 'ORCHESTRATOR_GUACD_IMAGE', configPath: 'orchestratorGuacdImage', type: 'string', default: 'guacamole/guacd:1.6.0', group: 'orchestration', label: 'Guacd Image', description: 'Container image for Guacamole daemon.', minEditRole: 'ADMIN', restartRequired: true },
  { key: 'ORCHESTRATOR_DB_PROXY_IMAGE', envVar: 'ORCHESTRATOR_DB_PROXY_IMAGE', configPath: 'orchestratorDbProxyImage', type: 'string', default: 'ghcr.io/dnviti/arsenale/db-proxy:latest', group: 'orchestration', label: 'DB Proxy Image', description: 'Container image for database proxy.', minEditRole: 'ADMIN', restartRequired: true },
];

// Group metadata for UI display ordering and labels
export const SETTING_GROUPS: { key: string; label: string; order: number }[] = [
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
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
const CACHE_TTL_MS = 30_000;
let dbCache: Map<string, { value: string; expiresAt: number }> = new Map();

async function getDbValue(key: string): Promise<string | undefined> {
  const cached = dbCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  try {
    const row = await prisma.appConfig.findUnique({ where: { key } });
    if (row) {
      dbCache.set(key, { value: row.value, expiresAt: Date.now() + CACHE_TTL_MS });
      return row.value;
    }
  } catch (err) {
    logger.error(`Failed to read system setting ${key}:`, err);
  }
  return undefined;
}

function invalidateCache(key: string): void {
  dbCache.delete(key);
}

export function invalidateAllCache(): void {
  dbCache = new Map();
}

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

  for (const def of SETTINGS_REGISTRY) {
    const envRaw = process.env[def.envVar];
    const envLocked = envRaw !== undefined;

    let value: unknown;
    let source: 'env' | 'db' | 'default';

    if (envLocked) {
      value = parseValue(envRaw, def.type, def.default);
      source = 'env';
    } else {
      const dbVal = await getDbValue(def.key);
      if (dbVal !== undefined) {
        value = parseValue(dbVal, def.type, def.default);
        source = 'db';
      } else {
        value = def.default;
        source = 'default';
      }
    }

    results.push({
      key: def.key,
      value,
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

  const serialized = serializeValue(value, def.type);
  await prisma.appConfig.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized },
  });

  invalidateCache(key);
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
