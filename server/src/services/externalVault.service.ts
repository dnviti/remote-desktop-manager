import prisma from '../lib/prisma';
import { encryptWithServerKey } from './crypto.service';
import { AppError } from '../middleware/error.middleware';
import * as auditService from './audit.service';
import type { ResolvedCredentials } from '../types';
import { getAdapter, invalidateCaches, toResolvedCredentials } from './vaultAdapters';
import type { ExternalVaultType, ExternalVaultAuthMethod } from '../generated/prisma/client';

// ---------- Types ----------

export interface VaultProviderInput {
  name: string;
  providerType?: string;
  serverUrl: string;
  authMethod: string;
  namespace?: string;
  mountPath?: string;
  authPayload: string; // JSON string — structure depends on providerType + authMethod
  caCertificate?: string;
  cacheTtlSeconds?: number;
}

export interface VaultProviderUpdateInput {
  name?: string;
  providerType?: string;
  serverUrl?: string;
  authMethod?: string;
  namespace?: string | null;
  mountPath?: string;
  authPayload?: string;
  caCertificate?: string | null;
  cacheTtlSeconds?: number;
  enabled?: boolean;
}

// ---------- CRUD ----------

export async function listProviders(tenantId: string) {
  return prisma.externalVaultProvider.findMany({
    where: { tenantId },
    select: {
      id: true,
      name: true,
      providerType: true,
      serverUrl: true,
      authMethod: true,
      namespace: true,
      mountPath: true,
      cacheTtlSeconds: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function getProvider(tenantId: string, providerId: string) {
  const provider = await prisma.externalVaultProvider.findFirst({
    where: { id: providerId, tenantId },
    select: {
      id: true,
      name: true,
      providerType: true,
      serverUrl: true,
      authMethod: true,
      namespace: true,
      mountPath: true,
      cacheTtlSeconds: true,
      caCertificate: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!provider) throw new AppError('Vault provider not found', 404);
  return provider;
}

export async function createProvider(
  tenantId: string,
  userId: string,
  input: VaultProviderInput,
) {
  const encrypted = encryptWithServerKey(input.authPayload);

  const provider = await prisma.externalVaultProvider.create({
    data: {
      tenantId,
      name: input.name,
      providerType: (input.providerType ?? 'HASHICORP_VAULT') as ExternalVaultType,
      serverUrl: input.serverUrl,
      authMethod: input.authMethod as ExternalVaultAuthMethod,
      namespace: input.namespace ?? null,
      mountPath: input.mountPath ?? 'secret',
      encryptedAuthPayload: encrypted.ciphertext,
      authPayloadIV: encrypted.iv,
      authPayloadTag: encrypted.tag,
      caCertificate: input.caCertificate ?? null,
      cacheTtlSeconds: input.cacheTtlSeconds ?? 300,
    },
    select: {
      id: true,
      name: true,
      providerType: true,
      serverUrl: true,
      authMethod: true,
      namespace: true,
      mountPath: true,
      cacheTtlSeconds: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await auditService.log({
    userId,
    action: 'VAULT_PROVIDER_CREATE',
    targetType: 'ExternalVaultProvider',
    targetId: provider.id,
    details: { name: input.name, providerType: input.providerType ?? 'HASHICORP_VAULT', serverUrl: input.serverUrl, authMethod: input.authMethod },
  });

  return provider;
}

export async function updateProvider(
  tenantId: string,
  providerId: string,
  userId: string,
  input: VaultProviderUpdateInput,
) {
  const existing = await prisma.externalVaultProvider.findFirst({
    where: { id: providerId, tenantId },
  });
  if (!existing) throw new AppError('Vault provider not found', 404);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.providerType !== undefined) data.providerType = input.providerType;
  if (input.serverUrl !== undefined) data.serverUrl = input.serverUrl;
  if (input.authMethod !== undefined) data.authMethod = input.authMethod;
  if (input.namespace !== undefined) data.namespace = input.namespace;
  if (input.mountPath !== undefined) data.mountPath = input.mountPath;
  if (input.caCertificate !== undefined) data.caCertificate = input.caCertificate;
  if (input.cacheTtlSeconds !== undefined) data.cacheTtlSeconds = input.cacheTtlSeconds;
  if (input.enabled !== undefined) data.enabled = input.enabled;

  if (input.authPayload !== undefined) {
    const encrypted = encryptWithServerKey(input.authPayload);
    data.encryptedAuthPayload = encrypted.ciphertext;
    data.authPayloadIV = encrypted.iv;
    data.authPayloadTag = encrypted.tag;
  }

  // Invalidate caches on config change
  const providerType = (input.providerType ?? existing.providerType) as string;
  invalidateCaches(providerType, providerId);

  const provider = await prisma.externalVaultProvider.update({
    where: { id: providerId },
    data,
    select: {
      id: true,
      name: true,
      providerType: true,
      serverUrl: true,
      authMethod: true,
      namespace: true,
      mountPath: true,
      cacheTtlSeconds: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await auditService.log({
    userId,
    action: 'VAULT_PROVIDER_UPDATE',
    targetType: 'ExternalVaultProvider',
    targetId: providerId,
    details: { changes: Object.keys(data) },
  });

  return provider;
}

export async function deleteProvider(tenantId: string, providerId: string, userId: string) {
  const existing = await prisma.externalVaultProvider.findFirst({
    where: { id: providerId, tenantId },
  });
  if (!existing) throw new AppError('Vault provider not found', 404);

  // Clear any connections referencing this provider
  await prisma.connection.updateMany({
    where: { externalVaultProviderId: providerId },
    data: { externalVaultProviderId: null, externalVaultPath: null },
  });

  await prisma.externalVaultProvider.delete({ where: { id: providerId } });

  invalidateCaches(existing.providerType, providerId);

  await auditService.log({
    userId,
    action: 'VAULT_PROVIDER_DELETE',
    targetType: 'ExternalVaultProvider',
    targetId: providerId,
    details: { name: existing.name },
  });
}

// ---------- Connection test ----------

export async function testConnection(
  tenantId: string,
  providerId: string,
  secretPath: string,
  userId: string,
): Promise<{ success: boolean; keys?: string[]; error?: string }> {
  const provider = await prisma.externalVaultProvider.findFirst({
    where: { id: providerId, tenantId },
  });
  if (!provider) throw new AppError('Vault provider not found', 404);

  const adapter = getAdapter(provider.providerType);
  const result = await adapter.testConnection(provider, secretPath);

  await auditService.log({
    userId,
    action: 'VAULT_PROVIDER_TEST',
    targetType: 'ExternalVaultProvider',
    targetId: providerId,
    details: { secretPath, success: result.success, ...(result.error ? { error: result.error } : {}) },
  });

  return result;
}

// ---------- Credential resolution (called from connection.service) ----------

export async function resolveExternalVaultCredentials(
  providerId: string,
  secretPath: string,
  tenantId: string,
): Promise<ResolvedCredentials> {
  const provider = await prisma.externalVaultProvider.findFirst({
    where: { id: providerId, tenantId },
  });
  if (!provider) {
    throw new AppError('External vault provider not found or has been deleted', 404);
  }
  if (!provider.enabled) {
    throw new AppError('External vault provider is disabled', 400);
  }

  const adapter = getAdapter(provider.providerType);
  const data = await adapter.readSecret(provider, secretPath);

  return toResolvedCredentials(data, secretPath);
}
