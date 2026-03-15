import api from './client';

export interface OAuthProviders {
  google: boolean;
  microsoft: boolean;
  github: boolean;
  oidc?: boolean;
  oidcProviderName?: string;
  saml?: boolean;
  samlProviderName?: string;
  ldap?: boolean;
  ldapProviderName?: string;
}

export interface LinkedAccount {
  id: string;
  provider: string;
  providerEmail: string | null;
  createdAt: string;
}

export async function getOAuthProviders(): Promise<OAuthProviders> {
  const { data } = await api.get('/auth/oauth/providers');
  return data;
}

export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  const { data } = await api.get('/auth/oauth/accounts');
  return data;
}

export async function unlinkOAuthAccount(provider: string): Promise<void> {
  await api.delete(`/auth/oauth/link/${provider.toLowerCase()}`);
}

export async function setupVaultPassword(vaultPassword: string): Promise<void> {
  await api.post('/auth/oauth/vault-setup', { vaultPassword });
}

export function initiateOAuthLogin(provider: string): void {
  window.location.href = `/api/auth/oauth/${provider.toLowerCase()}`;
}

/**
 * Obtain a short-lived one-time link code from the server (via Axios with
 * Authorization header), then return the code for use in a redirect URL.
 */
async function obtainLinkCode(): Promise<string> {
  const { data } = await api.post<{ code: string }>('/auth/oauth/link-code');
  return data.code;
}

export async function initiateOAuthLink(provider: string): Promise<void> {
  const code = await obtainLinkCode();
  window.location.href = `/api/auth/oauth/link/${provider.toLowerCase()}?code=${encodeURIComponent(code)}`;
}

export function initiateSamlLogin(): void {
  window.location.href = '/api/auth/saml';
}

export async function initiateSamlLink(): Promise<void> {
  const code = await obtainLinkCode();
  window.location.href = `/api/auth/saml/link?code=${encodeURIComponent(code)}`;
}
