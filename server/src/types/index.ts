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
