import crypto from 'crypto';
import { utils } from 'ssh2';
import prisma from '../lib/prisma';
import { encryptWithServerKey, decryptWithServerKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';

export interface SshKeyPairResponse {
  id: string;
  publicKey: string;
  fingerprint: string;
  algorithm: string;
  createdAt: Date;
  updatedAt: Date;
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

  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export async function getPublicKey(tenantId: string): Promise<SshKeyPairResponse | null> {
  const record = await prisma.sshKeyPair.findUnique({ where: { tenantId } });
  if (!record) return null;

  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
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

  return Buffer.from(privateKeyPem, 'utf8');
}

export async function rotateKeyPair(tenantId: string): Promise<SshKeyPairResponse> {
  const { privateKey, publicKey, fingerprint } = generateEd25519KeyPair();

  const encrypted = encryptWithServerKey(privateKey);

  const record = await prisma.$transaction(async (tx) => {
    await tx.sshKeyPair.deleteMany({ where: { tenantId } });
    return tx.sshKeyPair.create({
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
  });

  return {
    id: record.id,
    publicKey: record.publicKey,
    fingerprint: record.fingerprint,
    algorithm: record.algorithm,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
