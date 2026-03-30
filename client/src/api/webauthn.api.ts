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
  const { data } = await api.post('/user/2fa/webauthn/registration-options');
  return data;
}

export async function registerWebAuthnCredential(credential: unknown, friendlyName?: string, expectedChallenge?: string) {
  const { data } = await api.post('/user/2fa/webauthn/register', { credential, friendlyName, expectedChallenge });
  return data as WebAuthnCredentialInfo;
}

export async function getWebAuthnCredentials() {
  const { data } = await api.get('/user/2fa/webauthn/credentials');
  return data as WebAuthnCredentialInfo[];
}

export async function removeWebAuthnCredential(id: string) {
  const { data } = await api.delete(`/user/2fa/webauthn/credentials/${id}`);
  return data as { removed: boolean };
}

export async function renameWebAuthnCredential(id: string, friendlyName: string) {
  const { data } = await api.patch(`/user/2fa/webauthn/credentials/${id}`, { friendlyName });
  return data as { renamed: boolean };
}

export async function getWebAuthnStatus() {
  const { data } = await api.get('/user/2fa/webauthn/status');
  return data as { enabled: boolean; credentialCount: number };
}
