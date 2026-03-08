import crypto from 'crypto';
import { utils } from 'ssh2';
import prisma from '../lib/prisma';
import { encryptWithServerKey, decryptWithServerKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { config } from '../config';
import { logger } from '../utils/logger';
import { pushSshKeyToInstances } from './managedGateway.service';

const log = logger.child('sshkey');

export interface SshKeyPairResponse {
  id: string;
  publicKey: string;
  fingerprint: string;
  algorithm: string;
  expiresAt: Date | null;
  autoRotateEnabled: boolean;
  rotationIntervalDays: number;
  lastAutoRotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RotateOptions {
  updateExpiration?: boolean;
}

export interface RotationPolicyInput {
  autoRotateEnabled?: boolean;
  rotationIntervalDays?: number;
  expiresAt?: Date | null;
}

export interface RotationStatus {
  autoRotateEnabled: boolean;
  rotationIntervalDays: number;
  expiresAt: Date | null;
  lastAutoRotatedAt: Date | null;
  nextRotationDate: Date | null;
  daysUntilRotation: number | null;
  keyExists: boolean;
}

function generateEd25519KeyPair(): { privateKey: string; publicKey: string; fingerprint: string } {
  const keyPair = utils.generateKeyPairSync('ed25519');

  // Compute standard SSH fingerprint from the public key blob (matches ssh-keygen -l output)
  const parts = keyPair.public.split(' ');
  const pubKeyBlob = Buffer.from(parts[1], 'base64');
  const fingerprint = `SHA256:${crypto.createHash('sha256').update(pubKeyBlob).digest('base64')}`;

  return { privateKey: keyPair.private, publicKey: keyPair.public, fingerprint };
}

export async function generateKeyPair(tenantId: string): Promise<SshKeyPairResponse> {
  const existing = await prisma.sshKeyPair.findUnique({ where: { tenantId } });
  if (existing) {
    throw new AppError('SSH key pair already exists for this tenant. Use rotate to replace it.', 409);
  }

  const { privateKey, publicKey, fingerprint } = generateEd25519KeyPair();

  const encrypted = encryptWithServerKey(privateKey);

  const record = await prisma.sshKeyPair.create({
    data: {
      tenantId,
      encryptedPrivateKey: encrypted.ciphertext,
      privateKeyIV: encrypted.iv,
      privateKeyTag: encrypted.tag,
      publicKey,
      fingerprint,
      algorithm: 'ed25519',
    },
  });

  log.info(`Generated SSH key pair for tenant ${tenantId} (fingerprint: ${fingerprint})`);

  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
    expiresAt: record.expiresAt,
    autoRotateEnabled: record.autoRotateEnabled,
    rotationIntervalDays: record.rotationIntervalDays,
    lastAutoRotatedAt: record.lastAutoRotatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getPublicKey(tenantId: string): Promise<SshKeyPairResponse | null> {
  const record = await prisma.sshKeyPair.findUnique({ where: { tenantId } });
  if (!record) return null;

  log.debug(`Public key accessed for tenant ${tenantId}`);
  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
    expiresAt: record.expiresAt,
    autoRotateEnabled: record.autoRotateEnabled,
    rotationIntervalDays: record.rotationIntervalDays,
    lastAutoRotatedAt: record.lastAutoRotatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getPrivateKey(tenantId: string): Promise<Buffer> {
  const record = await prisma.sshKeyPair.findUnique({ where: { tenantId } });
  if (!record) {
    throw new AppError('No SSH key pair found for this tenant', 404);
  }

  const privateKeyPem = decryptWithServerKey({
    ciphertext: record.encryptedPrivateKey,
    iv: record.privateKeyIV,
    tag: record.privateKeyTag,
  });

  log.debug(`Private key accessed for tenant ${tenantId}`);
  return Buffer.from(privateKeyPem, 'utf8');
}

export async function rotateKeyPair(
  tenantId: string,
  options?: RotateOptions,
): Promise<SshKeyPairResponse> {
  log.info(`Rotating SSH key pair for tenant ${tenantId}`);
  const { privateKey, publicKey, fingerprint } = generateEd25519KeyPair();

  const encrypted = encryptWithServerKey(privateKey);

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.sshKeyPair.findUnique({ where: { tenantId } });

    await tx.sshKeyPair.deleteMany({ where: { tenantId } });

    let expiresAt = existing?.expiresAt ?? null;
    let lastAutoRotatedAt = existing?.lastAutoRotatedAt ?? null;

    if (options?.updateExpiration && existing) {
      const intervalDays = existing.rotationIntervalDays || 90;
      expiresAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
      lastAutoRotatedAt = new Date();
    }

    return tx.sshKeyPair.create({
      data: {
        tenantId,
        encryptedPrivateKey: encrypted.ciphertext,
        privateKeyIV: encrypted.iv,
        privateKeyTag: encrypted.tag,
        publicKey,
        fingerprint,
        algorithm: 'ed25519',
        autoRotateEnabled: existing?.autoRotateEnabled ?? false,
        rotationIntervalDays: existing?.rotationIntervalDays ?? 90,
        expiresAt,
        lastAutoRotatedAt,
      },
    });
  });

  log.info(`SSH key pair rotated for tenant ${tenantId} (new fingerprint: ${fingerprint})`);

  // Push new key to managed gateway instances (best-effort)
  try {
    const results = await pushSshKeyToInstances(tenantId, publicKey);
    const failed = results.filter(r => !r.ok);
    if (failed.length > 0) {
      log.warn(
        `Key push failed for ${failed.length}/${results.length} managed instances after rotation`,
      );
    }
  } catch (err) {
    log.warn(`Failed to push rotated key to managed instances: ${(err as Error).message}`);
  }

  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
    expiresAt: record.expiresAt,
    autoRotateEnabled: record.autoRotateEnabled,
    rotationIntervalDays: record.rotationIntervalDays,
    lastAutoRotatedAt: record.lastAutoRotatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function updateRotationPolicy(
  tenantId: string,
  input: RotationPolicyInput,
): Promise<SshKeyPairResponse> {
  const existing = await prisma.sshKeyPair.findUnique({ where: { tenantId } });
  if (!existing) {
    throw new AppError('No SSH key pair found for this tenant', 404);
  }

  const data: Parameters<typeof prisma.sshKeyPair.update>[0]['data'] = {};

  if (input.autoRotateEnabled !== undefined) {
    data.autoRotateEnabled = input.autoRotateEnabled;
  }
  if (input.rotationIntervalDays !== undefined) {
    data.rotationIntervalDays = input.rotationIntervalDays;
  }
  if (input.expiresAt !== undefined) {
    data.expiresAt = input.expiresAt;
  }

  const willBeEnabled = input.autoRotateEnabled ?? existing.autoRotateEnabled;
  const currentExpiresAt = input.expiresAt !== undefined ? input.expiresAt : existing.expiresAt;

  if (willBeEnabled && !currentExpiresAt) {
    const intervalDays = input.rotationIntervalDays ?? existing.rotationIntervalDays;
    data.expiresAt = new Date(Date.now() + intervalDays * 24 * 60 * 60 * 1000);
  }

  const record = await prisma.sshKeyPair.update({
    where: { tenantId },
    data,
  });

  log.info(`Rotation policy updated for tenant ${tenantId}: autoRotate=${record.autoRotateEnabled}, intervalDays=${record.rotationIntervalDays}`);

  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
    expiresAt: record.expiresAt,
    autoRotateEnabled: record.autoRotateEnabled,
    rotationIntervalDays: record.rotationIntervalDays,
    lastAutoRotatedAt: record.lastAutoRotatedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getRotationStatus(tenantId: string): Promise<RotationStatus> {
  const record = await prisma.sshKeyPair.findUnique({ where: { tenantId } });

  if (!record) {
    return {
      autoRotateEnabled: false,
      rotationIntervalDays: 90,
      expiresAt: null,
      lastAutoRotatedAt: null,
      nextRotationDate: null,
      daysUntilRotation: null,
      keyExists: false,
    };
  }

  let nextRotationDate: Date | null = null;
  let daysUntilRotation: number | null = null;

  if (record.autoRotateEnabled && record.expiresAt) {
    const advanceDays = config.keyRotationAdvanceDays;
    nextRotationDate = new Date(
      record.expiresAt.getTime() - advanceDays * 24 * 60 * 60 * 1000,
    );
    daysUntilRotation = Math.max(
      0,
      Math.ceil((nextRotationDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    );
  }

  return {
    autoRotateEnabled: record.autoRotateEnabled,
    rotationIntervalDays: record.rotationIntervalDays,
    expiresAt: record.expiresAt,
    lastAutoRotatedAt: record.lastAutoRotatedAt,
    nextRotationDate,
    daysUntilRotation,
    keyExists: true,
  };
}
