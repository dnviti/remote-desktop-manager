import api from './client';

export interface WebAuthnCredentialInfo {
  id: string;
  credentialId: string;
  friendlyName: string;
  deviceType: string | null;
  backedUp: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

export async function getWebAuthnRegistrationOptions() {
  const res = await api.post('/user/2fa/webauthn/registration-options');
  return res.data;
}

export async function registerWebAuthnCredential(credential: unknown, friendlyName?: string) {
  const res = await api.post('/user/2fa/webauthn/register', { credential, friendlyName });
  return res.data as WebAuthnCredentialInfo;
}

export async function getWebAuthnCredentials() {
  const res = await api.get('/user/2fa/webauthn/credentials');
  return res.data as WebAuthnCredentialInfo[];
}

export async function removeWebAuthnCredential(id: string) {
  const res = await api.delete(`/user/2fa/webauthn/credentials/${id}`);
  return res.data as { removed: boolean };
}

export async function renameWebAuthnCredential(id: string, friendlyName: string) {
  const res = await api.patch(`/user/2fa/webauthn/credentials/${id}`, { friendlyName });
  return res.data as { renamed: boolean };
}

export async function getWebAuthnStatus() {
  const res = await api.get('/user/2fa/webauthn/status');
  return res.data as { enabled: boolean; credentialCount: number };
}
