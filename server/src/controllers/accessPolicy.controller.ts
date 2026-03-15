import { Response } from 'express';
import { AuthRequest, assertTenantAuthenticated } from '../types';
import * as accessPolicyService from '../services/accessPolicy.service';
import type { CreateAccessPolicyInput, UpdateAccessPolicyInput } from '../schemas/accessPolicy.schemas';

export async function list(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policies = await accessPolicyService.listPolicies(req.user.tenantId);
  res.json(policies);
}

export async function create(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const data = req.body as CreateAccessPolicyInput;
  const policy = await accessPolicyService.createPolicy(req.user.tenantId, data);
  res.status(201).json(policy);
}

export async function update(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.id as string;
  const data = req.body as UpdateAccessPolicyInput;
  const policy = await accessPolicyService.updatePolicy(req.user.tenantId, policyId, data);
  res.json(policy);
}

export async function remove(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.id as string;
  await accessPolicyService.deletePolicy(req.user.tenantId, policyId);
  res.json({ deleted: true });
}
