import crypto from 'crypto';
import bcrypt from 'bcrypt';
import prisma from '../lib/prisma';
import { AppError } from '../middleware/error.middleware';
import { getEmailStatus, sendIdentityVerificationCode } from './email';
import { sendOtpToPhone, verifyOtp as verifySmsOtp } from './smsOtp.service';
import * as webauthn from './webauthn.service';
import { getDecryptedSecret, verifyCode as verifyTotpCode } from './totp.service';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VerificationMethod = 'email' | 'totp' | 'sms' | 'webauthn' | 'password';
export type VerificationPurpose = 'email-change' | 'password-change' | 'admin-action';

export interface VerificationInitResult {
  verificationId: string;
  method: VerificationMethod;
  metadata?: Record<string, unknown>;
}

interface VerificationSession {
  userId: string;
  method: VerificationMethod;
  purpose: VerificationPurpose;
  confirmed: boolean;
  confirmedAt: number | null;
  attempts: number;
  expiresAt: number;
  emailOtpHash?: string;
  webauthnOptions?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory verification store (keyed by verificationId, TTL auto-cleanup)
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes for initiation
const CONSUME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes to consume after confirmation
const MAX_ATTEMPTS = 5;
const OTP_LENGTH = 6;

const verificationStore = new Map<string, VerificationSession>();

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of verificationStore) {
    if (session.expiresAt < now) verificationStore.delete(key);
  }
}, 30_000);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateOtp(): string {
  const max = 1_000_000;
  const limit = 2 ** 32 - (2 ** 32 % max);
  let num: number;
  do { num = crypto.randomBytes(4).readUInt32BE(0); } while (num >= limit);
  return (num % max).toString().padStart(OTP_LENGTH, '0');
}

function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getAvailableMethods(userId: string): Promise<VerificationMethod[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      emailVerified: true,
      totpEnabled: true,
      smsMfaEnabled: true,
      phoneVerified: true,
      webauthnEnabled: true,
      passwordHash: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);

  const methods: VerificationMethod[] = [];

  const emailStatus = getEmailStatus();
  if (emailStatus.configured && user.emailVerified) methods.push('email');
  if (user.totpEnabled) methods.push('totp');
  if (user.smsMfaEnabled && user.phoneVerified) methods.push('sms');
  if (user.webauthnEnabled) methods.push('webauthn');
  if (user.passwordHash) methods.push('password');

  return methods;
}

export async function initiateVerification(
  userId: string,
  purpose: VerificationPurpose,
): Promise<VerificationInitResult> {
  const methods = await getAvailableMethods(userId);
  if (methods.length === 0) {
    throw new AppError(
      'No verification method available. Please set up a password or enable MFA.',
      400,
    );
  }

  const method = methods[0];
  const verificationId = crypto.randomUUID();

  const session: VerificationSession = {
    userId,
    method,
    purpose,
    confirmed: false,
    confirmedAt: null,
    attempts: 0,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };

  let metadata: Record<string, unknown> | undefined;

  switch (method) {
    case 'email': {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      const otp = generateOtp();
      session.emailOtpHash = hashOtp(otp);
      if (!user) throw new AppError('User not found', 404);
      await sendIdentityVerificationCode(user.email, otp, purpose);
      const masked = user.email.replace(/^(.{2}).*@/, '$1***@');
      metadata = { maskedEmail: masked };
      break;
    }
    case 'sms': {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { phoneNumber: true },
      });
      if (user?.phoneNumber) {
        await sendOtpToPhone(userId, user.phoneNumber);
        const masked = '+' + '*'.repeat(Math.max(0, user.phoneNumber.length - 5)) + user.phoneNumber.slice(-4);
        metadata = { maskedPhone: masked };
      }
      break;
    }
    case 'webauthn': {
      const options = await webauthn.generateAuthenticationOpts(userId);
      session.webauthnOptions = options as unknown as Record<string, unknown>;
      metadata = { options };
      break;
    }
    case 'totp':
    case 'password':
      break;
  }

  verificationStore.set(verificationId, session);

  return { verificationId, method, metadata };
}

export async function confirmVerification(
  verificationId: string,
  userId: string,
  payload: {
    code?: string;
    credential?: AuthenticationResponseJSON;
    password?: string;
  },
): Promise<boolean> {
  const session = verificationStore.get(verificationId);
  if (!session) throw new AppError('Verification session not found or expired.', 400);
  if (session.userId !== userId) throw new AppError('Verification session mismatch.', 403);
  if (session.expiresAt < Date.now()) {
    verificationStore.delete(verificationId);
    throw new AppError('Verification session expired.', 400);
  }
  if (session.confirmed) throw new AppError('Verification already confirmed.', 400);

  session.attempts++;
  if (session.attempts > MAX_ATTEMPTS) {
    verificationStore.delete(verificationId);
    throw new AppError('Too many verification attempts. Please start a new verification.', 429);
  }

  let valid = false;

  switch (session.method) {
    case 'email': {
      if (!payload.code) throw new AppError('Verification code is required.', 400);
      const inputHash = hashOtp(payload.code);
      valid = timingSafeEqual(inputHash, session.emailOtpHash as string);
      break;
    }
    case 'totp': {
      if (!payload.code) throw new AppError('TOTP code is required.', 400);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          encryptedTotpSecret: true,
          totpSecretIV: true,
          totpSecretTag: true,
          totpSecret: true,
        },
      });
      if (!user) throw new AppError('User not found', 404);
      const secret = await getDecryptedSecret(user, userId);
      if (!secret) throw new AppError('TOTP is not configured properly.', 400);
      valid = verifyTotpCode(secret, payload.code);
      break;
    }
    case 'sms': {
      if (!payload.code) throw new AppError('SMS code is required.', 400);
      valid = await verifySmsOtp(userId, payload.code);
      break;
    }
    case 'webauthn': {
      if (!payload.credential) throw new AppError('WebAuthn credential is required.', 400);
      try {
        const verification = await webauthn.verifyAuthenticationWithChallenge(
          userId,
          payload.credential,
          session.webauthnOptions as Record<string, unknown>,
        );
        valid = verification.verified;
      } catch {
        valid = false;
      }
      break;
    }
    case 'password': {
      if (!payload.password) throw new AppError('Password is required.', 400);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { passwordHash: true },
      });
      if (!user?.passwordHash) throw new AppError('No password set.', 400);
      valid = await bcrypt.compare(payload.password, user.passwordHash);
      break;
    }
  }

  if (valid) {
    session.confirmed = true;
    session.confirmedAt = Date.now();
    session.expiresAt = Date.now() + CONSUME_WINDOW_MS;
  }

  return valid;
}

export function consumeVerification(
  verificationId: string,
  userId: string,
  purpose: VerificationPurpose,
): void {
  const session = verificationStore.get(verificationId);
  if (!session) throw new AppError('Verification session not found or expired.', 400);
  if (!session.confirmed) throw new AppError('Verification not yet confirmed.', 400);
  if (session.userId !== userId) throw new AppError('Verification session mismatch.', 403);
  if (session.purpose !== purpose) throw new AppError('Verification purpose mismatch.', 403);
  if (session.expiresAt < Date.now()) {
    verificationStore.delete(verificationId);
    throw new AppError('Verification expired. Please start a new verification.', 400);
  }

  verificationStore.delete(verificationId);
}
