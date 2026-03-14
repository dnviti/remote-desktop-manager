import { Response, NextFunction } from 'express';
import { AuthRequest, assertTenantAuthenticated } from '../types';
import * as externalVaultService from '../services/externalVault.service';
import type { CreateVaultProviderInput, UpdateVaultProviderInput, TestVaultProviderInput } from '../schemas/externalVault.schemas';

export async function listProviders(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const providers = await externalVaultService.listProviders(req.user.tenantId);
  res.json(providers);
}

export async function getProvider(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const provider = await externalVaultService.getProvider(req.user.tenantId, req.params.providerId as string);
  res.json(provider);
}

export async function createProvider(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const input = req.body as CreateVaultProviderInput;
  const provider = await externalVaultService.createProvider(req.user.tenantId, req.user.userId, input);
  res.status(201).json(provider);
}

export async function updateProvider(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const input = req.body as UpdateVaultProviderInput;
  const provider = await externalVaultService.updateProvider(
    req.user.tenantId, req.params.providerId as string, req.user.userId, input,
  );
  res.json(provider);
}

export async function deleteProvider(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  await externalVaultService.deleteProvider(req.user.tenantId, req.params.providerId as string, req.user.userId);
  res.status(204).end();
}

export async function testProvider(req: AuthRequest, res: Response, _next: NextFunction) {
  assertTenantAuthenticated(req);
  const { secretPath } = req.body as TestVaultProviderInput;
  const result = await externalVaultService.testConnection(
    req.user.tenantId, req.params.providerId as string, secretPath, req.user.userId,
  );
  res.json(result);
}
