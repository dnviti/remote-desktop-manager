import prisma from '../lib/prisma';
import { logger } from '../utils/logger';
import { encryptWithServerKey, decryptWithServerKey } from './crypto.service';
import type { EncryptedField } from '../types';

const log = logger.child('tenantAiConfig');

export interface TenantAiConfigDto {
  provider: string;
  hasApiKey: boolean;
  modelId: string;
  baseUrl: string | null;
  maxTokensPerRequest: number;
  dailyRequestLimit: number;
  enabled: boolean;
}

export interface TenantAiConfigUpdateInput {
  provider?: string;
  apiKey?: string;
  modelId?: string;
  baseUrl?: string | null;
  maxTokensPerRequest?: number;
  dailyRequestLimit?: number;
  enabled?: boolean;
}

/**
 * Get tenant AI config (API key is NEVER returned, only `hasApiKey` boolean).
 */
export async function getConfig(tenantId: string): Promise<TenantAiConfigDto> {
  const row = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });

  if (!row) {
    return {
      provider: 'none',
      hasApiKey: false,
      modelId: '',
      baseUrl: null,
      maxTokensPerRequest: 4000,
      dailyRequestLimit: 100,
      enabled: false,
    };
  }

  return {
    provider: row.provider,
    hasApiKey: Boolean(row.encryptedApiKey),
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    maxTokensPerRequest: row.maxTokensPerRequest,
    dailyRequestLimit: row.dailyRequestLimit,
    enabled: row.enabled,
  };
}

/**
 * Get decrypted API key for internal use. Never expose to client.
 */
export async function getDecryptedApiKey(tenantId: string): Promise<string | null> {
  const row = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });
  if (!row?.encryptedApiKey || !row.apiKeyIV || !row.apiKeyTag) return null;

  try {
    const field: EncryptedField = {
      ciphertext: row.encryptedApiKey,
      iv: row.apiKeyIV,
      tag: row.apiKeyTag,
    };
    return decryptWithServerKey(field);
  } catch {
    log.error('Failed to decrypt tenant AI API key');
    return null;
  }
}

/**
 * Get full config with decrypted API key — server-side only.
 */
export async function getFullConfig(tenantId: string) {
  const row = await prisma.tenantAiConfig.findUnique({ where: { tenantId } });
  if (!row) return null;

  let apiKey: string | null = null;
  if (row.encryptedApiKey && row.apiKeyIV && row.apiKeyTag) {
    try {
      const field: EncryptedField = {
        ciphertext: row.encryptedApiKey,
        iv: row.apiKeyIV,
        tag: row.apiKeyTag,
      };
      apiKey = decryptWithServerKey(field);
    } catch {
      log.error('Failed to decrypt tenant AI API key');
    }
  }

  return {
    provider: row.provider,
    apiKey,
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    maxTokensPerRequest: row.maxTokensPerRequest,
    dailyRequestLimit: row.dailyRequestLimit,
    enabled: row.enabled,
  };
}

/**
 * Create or update tenant AI config. API key is encrypted at rest.
 */
export async function upsertConfig(
  tenantId: string,
  input: TenantAiConfigUpdateInput,
): Promise<TenantAiConfigDto> {
  let encryptedApiKey: string | undefined;
  let apiKeyIV: string | undefined;
  let apiKeyTag: string | undefined;

  if (input.apiKey !== undefined && input.apiKey !== '') {
    const encrypted = encryptWithServerKey(input.apiKey);
    encryptedApiKey = encrypted.ciphertext;
    apiKeyIV = encrypted.iv;
    apiKeyTag = encrypted.tag;
  }

  const data: Record<string, unknown> = {};
  if (input.provider !== undefined) data.provider = input.provider;
  if (input.modelId !== undefined) data.modelId = input.modelId;
  if (input.baseUrl !== undefined) data.baseUrl = input.baseUrl || null;
  if (input.maxTokensPerRequest !== undefined) data.maxTokensPerRequest = input.maxTokensPerRequest;
  if (input.dailyRequestLimit !== undefined) data.dailyRequestLimit = input.dailyRequestLimit;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (encryptedApiKey) {
    data.encryptedApiKey = encryptedApiKey;
    data.apiKeyIV = apiKeyIV;
    data.apiKeyTag = apiKeyTag;
  }

  const row = await prisma.tenantAiConfig.upsert({
    where: { tenantId },
    create: {
      tenantId,
      provider: (input.provider ?? 'none') as string,
      modelId: input.modelId ?? '',
      baseUrl: input.baseUrl ?? null,
      maxTokensPerRequest: input.maxTokensPerRequest ?? 4000,
      dailyRequestLimit: input.dailyRequestLimit ?? 100,
      enabled: input.enabled ?? false,
      encryptedApiKey: encryptedApiKey ?? null,
      apiKeyIV: apiKeyIV ?? null,
      apiKeyTag: apiKeyTag ?? null,
    },
    update: data,
  });

  log.info(`Tenant AI config updated for tenant ${tenantId}, provider: ${row.provider}`);

  return {
    provider: row.provider,
    hasApiKey: Boolean(row.encryptedApiKey),
    modelId: row.modelId,
    baseUrl: row.baseUrl,
    maxTokensPerRequest: row.maxTokensPerRequest,
    dailyRequestLimit: row.dailyRequestLimit,
    enabled: row.enabled,
  };
}
