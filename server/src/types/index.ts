import { Request } from 'express';

export type TenantRoleType = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER' | 'CONSULTANT' | 'AUDITOR' | 'GUEST';

/** MFA method used to complete login for this session. Used by ABAC policy evaluation. */
export type MfaMethod = 'totp' | 'webauthn' | 'sms';

export interface AuthPayload {
  userId: string;
  email: string;
  tenantId?: string;
  tenantRole?: TenantRoleType;
  ipUaHash?: string;
  /** Set when the user completed an MFA challenge during login (TOTP, WebAuthn, or SMS). */
  mfaMethod?: MfaMethod;
}

// Merge AuthPayload into Express.User so passport's global
// req.user augmentation stays compatible with AuthRequest.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthPayload {}
  }
}

export interface TeamMembershipInfo {
  teamId: string;
  role: 'TEAM_ADMIN' | 'TEAM_EDITOR' | 'TEAM_VIEWER';
  tenantId: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
  teamMembership?: TeamMembershipInfo;
}

/** AuthRequest after `authenticate` middleware has verified the JWT. */
export interface AuthenticatedRequest extends Request {
  user: AuthPayload;
  teamMembership?: TeamMembershipInfo;
}

/** AuthRequest where the user is also bound to a tenant. */
export interface TenantRequest extends Request {
  user: AuthPayload & { tenantId: string; tenantRole: TenantRoleType };
  teamMembership?: TeamMembershipInfo;
}

/**
 * Narrows `AuthRequest` to `AuthenticatedRequest`.
 * Call at the top of any handler behind the `authenticate` middleware.
 */
export function assertAuthenticated(
  req: AuthRequest,
): asserts req is AuthenticatedRequest {
  if (!req.user) {
    const err = new Error('Authentication required') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
}

/**
 * Narrows `AuthRequest` to `TenantRequest`.
 * Call at the top of any handler that requires a tenant context.
 */
export function assertTenantAuthenticated(
  req: AuthRequest,
): asserts req is TenantRequest {
  if (!req.user) {
    const err = new Error('Authentication required') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }
  if (!req.user.tenantId || !req.user.tenantRole) {
    const err = new Error('Tenant membership required') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

export interface EncryptedField {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface VaultSession {
  masterKey: Buffer;
  expiresAt: number;
}

export interface SftpEntry {
  name: string;
  size: number;
  type: 'file' | 'directory' | 'symlink';
  modifiedAt: string;
}

export interface RdpSettings {
  colorDepth?: 8 | 16 | 24;
  width?: number;
  height?: number;
  dpi?: number;
  resizeMethod?: 'display-update' | 'reconnect';
  qualityPreset?: 'performance' | 'balanced' | 'quality' | 'custom';
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
  enableDesktopComposition?: boolean;
  enableMenuAnimations?: boolean;
  forceLossless?: boolean;
  disableAudio?: boolean;
  enableAudioInput?: boolean;
  security?: 'any' | 'nla' | 'nla-ext' | 'tls' | 'rdp';
  ignoreCert?: boolean;
  serverLayout?: string;
  console?: boolean;
  timezone?: string;
}

export interface VncSettings {
  colorDepth?: 8 | 16 | 24 | 32;
  cursor?: 'local' | 'remote';
  readOnly?: boolean;
  clipboardEncoding?: 'ISO8859-1' | 'UTF-8' | 'UTF-16' | 'CP1252';
  swapRedBlue?: boolean;
  disableAudio?: boolean;
}

export type DbProtocol = 'postgresql' | 'mysql' | 'mongodb' | 'oracle' | 'mssql' | 'db2';
export type OracleConnectionType = 'basic' | 'tns' | 'custom';
export type OracleRole = 'normal' | 'sysdba' | 'sysoper' | 'sysasm' | 'sysbackup' | 'sysdg' | 'syskm' | 'sysrac';

export interface DbSettings {
  protocol: DbProtocol;
  databaseName?: string;
  /** Oracle: connection mode (defaults to 'basic' for backward compat). */
  oracleConnectionType?: OracleConnectionType;
  /** Oracle Basic: SID for the target instance (mutually exclusive with serviceName). */
  oracleSid?: string;
  /** Oracle Basic: Service name for the target instance. */
  oracleServiceName?: string;
  /** Oracle: privilege role for the connection. */
  oracleRole?: OracleRole;
  /** Oracle TNS: alias name resolved via TNS_ADMIN / tnsnames.ora. */
  oracleTnsAlias?: string;
  /** Oracle TNS: full TNS descriptor string. */
  oracleTnsDescriptor?: string;
  /** Oracle Custom: raw connect string passed directly to the driver. */
  oracleConnectString?: string;
  /** MSSQL: Named instance (e.g. "SQLEXPRESS"). */
  mssqlInstanceName?: string;
  /** MSSQL: Authentication mode — "sql" for SQL auth, "windows" for NTLM/Kerberos. */
  mssqlAuthMode?: 'sql' | 'windows';
  /** DB2: Database alias as cataloged on the DB2 Connect gateway. */
  db2DatabaseAlias?: string;
}

export interface DbSessionConfig {
  /** Active database — MySQL: USE db, MSSQL: USE [db], PG/Oracle/DB2: pool-level (forces recreate) */
  activeDatabase?: string;
  /** Timezone — PG: SET timezone, MySQL: SET time_zone, Oracle: ALTER SESSION SET TIME_ZONE, DB2: SET CURRENT TIMEZONE */
  timezone?: string;
  /** Schema/search path — PG: search_path, Oracle: CURRENT_SCHEMA, MSSQL/DB2: SCHEMA */
  searchPath?: string;
  /** Character encoding — PG: client_encoding, MySQL: NAMES, Oracle: NLS_LANGUAGE */
  encoding?: string;
  /** Arbitrary SET/ALTER SESSION commands (OPERATOR+ roles only) */
  initCommands?: string[];
}

export interface DlpPolicy {
  disableCopy?: boolean;
  disablePaste?: boolean;
  disableDownload?: boolean;
  disableUpload?: boolean;
}

export interface ResolvedDlpPolicy {
  disableCopy: boolean;
  disablePaste: boolean;
  disableDownload: boolean;
  disableUpload: boolean;
}

// --- Secret Payload Types (discriminated union) ---

export interface LoginSecretData {
  type: 'LOGIN';
  username: string;
  password: string;
  domain?: string;
  url?: string;
  notes?: string;
}

export interface SshKeySecretData {
  type: 'SSH_KEY';
  username?: string;
  privateKey: string;
  publicKey?: string;
  passphrase?: string;
  algorithm?: string;
  notes?: string;
}

export interface CertificateSecretData {
  type: 'CERTIFICATE';
  certificate: string;
  privateKey: string;
  chain?: string;
  passphrase?: string;
  expiresAt?: string;
  notes?: string;
}

export interface ApiKeySecretData {
  type: 'API_KEY';
  apiKey: string;
  endpoint?: string;
  headers?: Record<string, string>;
  notes?: string;
}

export interface SecureNoteSecretData {
  type: 'SECURE_NOTE';
  content: string;
}

export type SecretPayload =
  | LoginSecretData
  | SshKeySecretData
  | CertificateSecretData
  | ApiKeySecretData
  | SecureNoteSecretData;

export interface ResolvedCredentials {
  username: string;
  password: string;
  domain?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface DomainProfile {
  domainName: string | null;
  domainUsername: string | null;
  hasDomainPassword: boolean;
}
