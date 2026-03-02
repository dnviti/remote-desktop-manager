import { Request } from 'express';

export interface AuthPayload {
  userId: string;
  email: string;
  tenantId?: string;
  tenantRole?: 'OWNER' | 'ADMIN' | 'MEMBER';
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

// --- Secret Payload Types (discriminated union) ---

export interface LoginSecretData {
  type: 'LOGIN';
  username: string;
  password: string;
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
  privateKey?: string;
  passphrase?: string;
}
