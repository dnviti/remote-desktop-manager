import { Request } from 'express';

export interface AuthPayload {
  userId: string;
  email: string;
}

export interface AuthRequest extends Request {
  user?: AuthPayload;
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
