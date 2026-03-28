import api from './client';
import type { TenantMembershipInfo } from './auth.api';

export interface SetupStatusResponse {
  required: boolean;
}

export interface SetupCompleteData {
  admin: {
    email: string;
    username?: string;
    password: string;
  };
  tenant: {
    name: string;
  };
  settings?: {
    selfSignupEnabled?: boolean;
    smtp?: {
      host: string;
      port: number;
      user?: string;
      pass?: string;
      from?: string;
      secure?: boolean;
    };
  };
}

export interface SetupCompleteResponse {
  recoveryKey: string;
  accessToken: string;
  csrfToken?: string;
  user: {
    id: string;
    email: string;
    username: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  tenantMemberships?: TenantMembershipInfo[];
  systemSecrets?: Array<{ name: string; value: string; description: string }>;
}

export async function getSetupStatus(): Promise<SetupStatusResponse> {
  const { data } = await api.get<SetupStatusResponse>('/setup/status');
  return data;
}

export async function completeSetup(body: SetupCompleteData): Promise<SetupCompleteResponse> {
  const { data } = await api.post<SetupCompleteResponse>('/setup/complete', body);
  return data;
}

export interface DbStatusResponse {
  host: string;
  port: number;
  database: string;
  connected: boolean;
  version: string | null;
}

export async function getDbStatus(): Promise<DbStatusResponse> {
  const { data } = await api.get<DbStatusResponse>('/setup/db-status');
  return data;
}
