import api from './client';

export type AccessPolicyTargetType = 'TENANT' | 'TEAM' | 'FOLDER';

export interface AccessPolicyData {
  id: string;
  targetType: AccessPolicyTargetType;
  targetId: string;
  allowedTimeWindows: string | null;
  requireTrustedDevice: boolean;
  requireMfaStepUp: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccessPolicyInput {
  targetType: AccessPolicyTargetType;
  targetId: string;
  allowedTimeWindows?: string | null;
  requireTrustedDevice?: boolean;
  requireMfaStepUp?: boolean;
}

export interface UpdateAccessPolicyInput {
  allowedTimeWindows?: string | null;
  requireTrustedDevice?: boolean;
  requireMfaStepUp?: boolean;
}

export async function listAccessPolicies(): Promise<AccessPolicyData[]> {
  const { data } = await api.get('/access-policies');
  return data;
}

export async function createAccessPolicy(payload: CreateAccessPolicyInput): Promise<AccessPolicyData> {
  const { data } = await api.post('/access-policies', payload);
  return data;
}

export async function updateAccessPolicy(id: string, payload: UpdateAccessPolicyInput): Promise<AccessPolicyData> {
  const { data } = await api.put(`/access-policies/${id}`, payload);
  return data;
}

export async function deleteAccessPolicy(id: string): Promise<{ deleted: boolean }> {
  const { data } = await api.delete(`/access-policies/${id}`);
  return data;
}
