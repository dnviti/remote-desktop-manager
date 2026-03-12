import { Request } from 'express';

export type TenantRoleType = 'OWNER' | 'ADMIN' | 'OPERATOR' | 'MEMBER' | 'CONSULTANT' | 'AUDITOR' | 'GUEST';

export interface AuthPayload {
  userId: string;
  email: string;
  tenantId?: string;
  tenantRole?: TenantRoleType;
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
