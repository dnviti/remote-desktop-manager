import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import prisma from '../lib/prisma';
import { config } from '../config';
import { AppError } from '../middleware/error.middleware';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface WebAuthnCredentialInfo {
  id: string;
  credentialId: string;
  friendlyName: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

interface StoredChallenge {
  challenge: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// In-memory challenge store (keyed by userId, TTL 60 s)
// ---------------------------------------------------------------------------
const CHALLENGE_TTL_MS = 60_000;
const challengeStore = new Map<string, StoredChallenge>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of challengeStore) {
    if (val.expiresAt < now) challengeStore.delete(key);
  }
}, 30_000);

export function storeChallenge(userId: string, challenge: string): void {
  challengeStore.set(userId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

export function getAndDeleteChallenge(userId: string): string | null {
  const entry = challengeStore.get(userId);
  if (!entry) return null;
  challengeStore.delete(userId);
  if (entry.expiresAt < Date.now()) return null;
  return entry.challenge;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const { rpId, rpOrigin, rpName } = config.webauthn;

function toCredentialInfo(c: {
  id: string;
  credentialId: string;
  friendlyName: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}): WebAuthnCredentialInfo {
  return {
    id: c.id,
    credentialId: c.credentialId,
    friendlyName: c.friendlyName,
    deviceType: c.deviceType,
    backedUp: c.backedUp,
    lastUsedAt: c.lastUsedAt,
    createdAt: c.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Registration (settings context — user already authenticated)
// ---------------------------------------------------------------------------

export async function generateRegistrationOpts(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true, username: true, webauthnCredentials: { select: { credentialId: true, transports: true } } },
  });

  const existingCredentials = user.webauthnCredentials.map((c) => ({
    id: c.credentialId,
    transports: c.transports as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName,
    rpID: rpId,
    userName: user.email,
    userDisplayName: user.username || user.email,
    excludeCredentials: existingCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    attestationType: 'none',
  });

  storeChallenge(userId, options.challenge);
  return options;
}

export async function verifyRegistration(
  userId: string,
  credential: RegistrationResponseJSON,
  friendlyName?: string,
) {
  const expectedChallenge = getAndDeleteChallenge(userId);
  if (!expectedChallenge) throw new AppError('Challenge expired or not found. Please try again.', 400);

  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpId,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError('WebAuthn registration verification failed.', 400);
  }

  const { credential: regCredential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  const saved = await prisma.webAuthnCredential.create({
    data: {
      userId,
      credentialId: regCredential.id,
      publicKey: Buffer.from(regCredential.publicKey).toString('base64url'),
      counter: regCredential.counter,
      transports: regCredential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      friendlyName: friendlyName || 'Security Key',
      aaguid: verification.registrationInfo.aaguid,
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { webauthnEnabled: true },
  });

  return toCredentialInfo(saved);
}

// ---------------------------------------------------------------------------
// Authentication (login context — user not yet authenticated)
// ---------------------------------------------------------------------------

export async function generateAuthenticationOpts(userId: string) {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    select: { credentialId: true, transports: true },
  });

  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: credentials.map((c) => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransportFuture[],
    })),
    userVerification: 'preferred',
  });

  storeChallenge(userId, options.challenge);
  return options;
}

export async function verifyAuthentication(
  userId: string,
  credential: AuthenticationResponseJSON,
) {
  const expectedChallenge = getAndDeleteChallenge(userId);
  if (!expectedChallenge) throw new AppError('Challenge expired or not found. Please try again.', 400);

  const stored = await prisma.webAuthnCredential.findFirst({
    where: { userId, credentialId: credential.id },
  });
  if (!stored) throw new AppError('Credential not found.', 400);

  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpId,
    credential: {
      id: stored.credentialId,
      publicKey: Buffer.from(stored.publicKey, 'base64url'),
      counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new AppError('WebAuthn authentication failed.', 401);
  }

  await prisma.webAuthnCredential.update({
    where: { id: stored.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });

  return verification;
}

/**
 * Verify a WebAuthn authentication response using an explicit expected challenge
 * (instead of reading from the in-memory challenge store).
 * Used by the identity verification service to avoid conflicts with login MFA challenges.
 */
export async function verifyAuthenticationWithChallenge(
  userId: string,
  credential: AuthenticationResponseJSON,
  options: Record<string, unknown>,
) {
  const expectedChallenge = (options as { challenge?: string }).challenge;
  if (!expectedChallenge) throw new AppError('Missing WebAuthn challenge.', 400);

  const stored = await prisma.webAuthnCredential.findFirst({
    where: { userId, credentialId: credential.id },
  });
  if (!stored) throw new AppError('Credential not found.', 400);

  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: rpOrigin,
    expectedRPID: rpId,
    credential: {
      id: stored.credentialId,
      publicKey: Buffer.from(stored.publicKey, 'base64url'),
      counter: Number(stored.counter),
      transports: stored.transports as AuthenticatorTransportFuture[],
    },
  });

  if (!verification.verified) {
    throw new AppError('WebAuthn authentication failed.', 401);
  }

  await prisma.webAuthnCredential.update({
    where: { id: stored.id },
    data: {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: new Date(),
    },
  });

  return verification;
}

// ---------------------------------------------------------------------------
// Credential management (settings)
// ---------------------------------------------------------------------------

export async function getCredentials(userId: string): Promise<WebAuthnCredentialInfo[]> {
  const credentials = await prisma.webAuthnCredential.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
  return credentials.map(toCredentialInfo);
}

export async function removeCredential(userId: string, credentialId: string): Promise<void> {
  const cred = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialId, userId },
  });
  if (!cred) throw new AppError('Credential not found.', 404);

  await prisma.webAuthnCredential.delete({ where: { id: credentialId } });

  const remaining = await prisma.webAuthnCredential.count({ where: { userId } });
  if (remaining === 0) {
    await prisma.user.update({
      where: { id: userId },
      data: { webauthnEnabled: false },
    });
  }
}

export async function renameCredential(
  userId: string,
  credentialId: string,
  friendlyName: string,
): Promise<void> {
  const cred = await prisma.webAuthnCredential.findFirst({
    where: { id: credentialId, userId },
  });
  if (!cred) throw new AppError('Credential not found.', 404);

  await prisma.webAuthnCredential.update({
    where: { id: credentialId },
    data: { friendlyName },
  });
}

export async function getWebAuthnStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { webauthnEnabled: true, _count: { select: { webauthnCredentials: true } } },
  });
  return { enabled: user.webauthnEnabled, credentialCount: user._count.webauthnCredentials };
}
