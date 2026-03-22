import { Response } from 'express';
import { AuthRequest, assertTenantAuthenticated } from '../types';
import * as keystrokeInspectionService from '../services/keystrokeInspection.service';
import * as auditService from '../services/audit.service';
import type { CreateKeystrokePolicyInput, UpdateKeystrokePolicyInput } from '../schemas/keystrokePolicy.schemas';

export async function list(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policies = await keystrokeInspectionService.listPolicies(req.user.tenantId);
  res.json(policies);
}

export async function get(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.id as string;
  const policy = await keystrokeInspectionService.getPolicy(req.user.tenantId, policyId);
  res.json(policy);
}

export async function create(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const data = req.body as CreateKeystrokePolicyInput;
  const policy = await keystrokeInspectionService.createPolicy(req.user.tenantId, data);

  auditService.log({
    userId: req.user.userId,
    action: 'KEYSTROKE_POLICY_CREATE',
    targetType: 'KeystrokePolicy',
    targetId: policy.id,
    details: { name: policy.name, action: policy.action, patternCount: policy.regexPatterns.length },
  });

  res.status(201).json(policy);
}

export async function update(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.id as string;
  const data = req.body as UpdateKeystrokePolicyInput;
  const policy = await keystrokeInspectionService.updatePolicy(req.user.tenantId, policyId, data);

  auditService.log({
    userId: req.user.userId,
    action: 'KEYSTROKE_POLICY_UPDATE',
    targetType: 'KeystrokePolicy',
    targetId: policy.id,
    details: { name: policy.name, action: policy.action },
  });

  res.json(policy);
}

export async function remove(req: AuthRequest, res: Response) {
  assertTenantAuthenticated(req);
  const policyId = req.params.id as string;
  await keystrokeInspectionService.deletePolicy(req.user.tenantId, policyId);

  auditService.log({
    userId: req.user.userId,
    action: 'KEYSTROKE_POLICY_DELETE',
    targetType: 'KeystrokePolicy',
    targetId: policyId,
  });

  res.json({ deleted: true });
}
