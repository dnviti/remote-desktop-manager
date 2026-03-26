import prisma from '../lib/prisma';
import { DomainProfile, EncryptedField } from '../types';
import { encrypt, decrypt, getMasterKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import { logger } from '../utils/logger';

const log = logger.child('domain');

export async function getDomainProfile(userId: string): Promise<DomainProfile> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      domainName: true,
      domainUsername: true,
      encryptedDomainPassword: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);

  return {
    domainName: user.domainName,
    domainUsername: user.domainUsername,
    hasDomainPassword: Boolean(user.encryptedDomainPassword),
  };
}

export async function updateDomainProfile(
  userId: string,
  input: { domainName?: string; domainUsername?: string; domainPassword?: string | null },
): Promise<DomainProfile> {
  const data: Record<string, unknown> = {};

  if (input.domainName !== undefined) data.domainName = input.domainName || null;
  if (input.domainUsername !== undefined) data.domainUsername = input.domainUsername || null;

  if (input.domainPassword !== undefined) {
    if (input.domainPassword === null || input.domainPassword === '') {
      // Clear domain password
      data.encryptedDomainPassword = null;
      data.domainPasswordIV = null;
      data.domainPasswordTag = null;
    } else {
      // Encrypt domain password with vault master key
      const masterKey = await getMasterKey(userId);
      if (!masterKey) throw new AppError('Vault must be unlocked to set domain password', 403);

      const enc = encrypt(input.domainPassword, masterKey);
      data.encryptedDomainPassword = enc.ciphertext;
      data.domainPasswordIV = enc.iv;
      data.domainPasswordTag = enc.tag;
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      domainName: true,
      domainUsername: true,
      encryptedDomainPassword: true,
    },
  });

  return {
    domainName: user.domainName,
    domainUsername: user.domainUsername,
    hasDomainPassword: Boolean(user.encryptedDomainPassword),
  };
}

export async function clearDomainProfile(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: {
      domainName: null,
      domainUsername: null,
      encryptedDomainPassword: null,
      domainPasswordIV: null,
      domainPasswordTag: null,
    },
  });
}

export async function resolveDomainCredentials(
  userId: string,
): Promise<{ domainName: string | null; domainUsername: string | null; password: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      domainName: true,
      domainUsername: true,
      encryptedDomainPassword: true,
      domainPasswordIV: true,
      domainPasswordTag: true,
    },
  });
  if (!user) throw new AppError('User not found', 404);

  let password: string | null = null;
  if (user.encryptedDomainPassword && user.domainPasswordIV && user.domainPasswordTag) {
    const masterKey = await getMasterKey(userId);
    if (!masterKey) throw new AppError('Vault must be unlocked to access domain credentials', 403);

    const field: EncryptedField = {
      ciphertext: user.encryptedDomainPassword,
      iv: user.domainPasswordIV,
      tag: user.domainPasswordTag,
    };
    password = decrypt(field, masterKey);
  }

  return {
    domainName: user.domainName,
    domainUsername: user.domainUsername,
    password,
  };
}

export async function inferDomainFromSaml(
  userId: string,
  samlAttributes: Record<string, unknown>,
): Promise<void> {
  // Check if user already has a domain profile configured
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { domainName: true, email: true },
  });
  if (!user || user.domainName) return; // Don't overwrite manual config

  let domainName: string | null = null;
  let domainUsername: string | null = null;

  // Priority 1: explicit domain claim (windowsdomainname)
  if (typeof samlAttributes.domain === 'string' && samlAttributes.domain) {
    domainName = samlAttributes.domain.toUpperCase();
  }

  // Priority 2: UPN claim (e.g. john@contoso.com)
  if (typeof samlAttributes.upn === 'string' && samlAttributes.upn.includes('@')) {
    const [localPart, domainPart] = samlAttributes.upn.split('@');
    domainUsername = localPart;
    if (!domainName && domainPart) {
      // Extract NETBIOS-style domain from FQDN (first segment, uppercase)
      domainName = domainPart.split('.')[0].toUpperCase();
    }
  }

  // Priority 3: fallback to email
  if (!domainName && !domainUsername && user.email.includes('@')) {
    const [localPart, domainPart] = user.email.split('@');
    domainUsername = localPart;
    domainName = domainPart.split('.')[0].toUpperCase();
  }

  if (domainName || domainUsername) {
    await prisma.user.update({
      where: { id: userId },
      data: { domainName, domainUsername },
    });
    log.info(`Auto-inferred domain identity: ${domainName}\\${domainUsername}`);
  }
}
