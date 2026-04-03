/** Represents a configured Arsenale server account. */
export interface Account {
  /** Unique identifier (UUID v4). */
  id: string;
  /** User-visible label (e.g. "Production", "Home Lab"). */
  label: string;
  /** Base URL of the Arsenale server (e.g. "https://arsenale.example.com"). */
  serverUrl: string;
  /** User ID returned after authentication. */
  userId: string;
  /** User email. */
  email: string;
  /** Short-lived JWT access token. */
  accessToken: string;
  /** Refresh token for obtaining new access tokens. */
  refreshToken: string;
  /** Optional tenant ID for multi-tenant deployments. */
  tenantId?: string;
  /** Optional tenant display name. */
  tenantName?: string;
  /** ISO-8601 timestamp of last activity. */
  lastUsed: string;
  /** Whether the vault is currently unlocked for this account. */
  vaultUnlocked: boolean;
  /** Whether the session has expired (refresh failed with 401). */
  sessionExpired?: boolean;
}

/** Shape of the stored data in chrome.storage.local. */
export interface StorageSchema {
  /** All configured accounts. */
  accounts: Account[];
  /** ID of the currently active account (or null if none). */
  activeAccountId: string | null;
}

/** Messages sent from popup/options/content to the service worker. */
export type BackgroundMessage =
  | { type: 'API_REQUEST'; accountId: string; method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; body?: unknown }
  | { type: 'HEALTH_CHECK'; serverUrl: string }
  | { type: 'LOGIN'; serverUrl: string; email: string; password: string }
  | { type: 'VERIFY_TOTP'; serverUrl: string; tempToken: string; code: string; pendingAccount: PendingAccount }
  | { type: 'REQUEST_SMS_CODE'; serverUrl: string; tempToken: string }
  | { type: 'VERIFY_SMS'; serverUrl: string; tempToken: string; code: string; pendingAccount: PendingAccount }
  | { type: 'REQUEST_WEBAUTHN_OPTIONS'; serverUrl: string; tempToken: string }
  | { type: 'VERIFY_WEBAUTHN'; serverUrl: string; tempToken: string; credential: Record<string, unknown>; pendingAccount: PendingAccount; expectedChallenge?: string }
  | { type: 'SWITCH_TENANT'; accountId: string; tenantId: string }
  | { type: 'LOGOUT_ACCOUNT'; accountId: string }
  | { type: 'REFRESH_TOKEN'; accountId: string }
  | { type: 'GET_ACCOUNTS' }
  | { type: 'SET_ACTIVE_ACCOUNT'; accountId: string }
  | { type: 'REMOVE_ACCOUNT'; accountId: string }
  | { type: 'UPDATE_ACCOUNT'; account: Partial<Account> & { id: string } }
  | { type: 'AUTOFILL_GET_STATUS'; url: string }
  | { type: 'AUTOFILL_GET_MATCHES'; url: string }
  | { type: 'AUTOFILL_GET_CREDENTIAL'; secretId: string; accountId: string }
  | { type: 'AUTOFILL_OPEN_POPUP' }
  | { type: 'AUTOFILL_IS_DISABLED'; domain: string }
  | { type: 'AUTOFILL_SET_DISABLED_SITES'; sites: string[] }
  | { type: 'AUTOFILL_GET_DISABLED_SITES' }
  | { type: 'AUTOFILL_SET_GLOBAL_ENABLED'; enabled: boolean }
  | { type: 'AUTOFILL_GET_GLOBAL_ENABLED' };

/** Standardized response from the service worker. */
export interface BackgroundResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Health check response from /api/health. */
export interface HealthCheckResult {
  status: string;
  version?: string;
}

/** Partial account info carried through the MFA flow before full account creation. */
export interface PendingAccount {
  serverUrl: string;
  email: string;
}

/** Tenant membership entry returned by the server. */
export interface TenantMembership {
  tenantId: string;
  name: string;
  slug: string;
  role: string;
  status?: 'PENDING' | 'ACCEPTED';
  pending?: boolean;
  isActive: boolean;
}

/** Login response from /api/auth/login — full success (no MFA required). */
export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  csrfToken?: string;
  accountId?: string;
  user: {
    id: string;
    email: string;
    name: string;
    tenantId?: string;
    tenantName?: string;
  };
  tenantMemberships?: TenantMembership[];
}

/** Login response when MFA is required. */
export interface LoginMfaRequired {
  requiresMFA: true;
  requiresTOTP?: boolean;
  methods: string[];
  tempToken: string;
}

/** Login response when MFA setup is required before first login. */
export interface LoginMfaSetupRequired {
  mfaSetupRequired: true;
  tempToken: string;
}

/** Union type for all possible /api/auth/login responses. */
export type LoginResponse = LoginResult | LoginMfaRequired | LoginMfaSetupRequired;

// ── Vault & Secrets types ────────────────────────────────────────────

/** Vault status response from GET /api/vault/status. */
export interface VaultStatusResponse {
  unlocked: boolean;
  mfaUnlockAvailable: boolean;
  mfaUnlockMethods: string[];
}

/** Secret type enum matching server model. */
export type SecretType = 'LOGIN' | 'SSH_KEY' | 'CERTIFICATE' | 'API_KEY' | 'SECURE_NOTE';

/** Secret scope enum. */
export type SecretScope = 'PERSONAL' | 'TEAM' | 'TENANT';

/** Secret list item returned by GET /api/secrets. */
export interface SecretListItem {
  id: string;
  name: string;
  description: string | null;
  type: SecretType;
  scope: SecretScope;
  teamId: string | null;
  tenantId: string | null;
  folderId: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  isFavorite: boolean;
  expiresAt: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Discriminated union for decrypted secret payload. */
export interface LoginData {
  type: 'LOGIN';
  username: string;
  password: string;
  domain?: string;
  url?: string;
  notes?: string;
}

export interface SshKeyData {
  type: 'SSH_KEY';
  username?: string;
  privateKey: string;
  publicKey?: string;
  passphrase?: string;
  algorithm?: string;
  notes?: string;
}

export interface CertificateData {
  type: 'CERTIFICATE';
  certificate: string;
  privateKey: string;
  chain?: string;
  passphrase?: string;
  expiresAt?: string;
  notes?: string;
}

export interface ApiKeyData {
  type: 'API_KEY';
  apiKey: string;
  endpoint?: string;
  headers?: Record<string, string>;
  notes?: string;
}

export interface SecureNoteData {
  type: 'SECURE_NOTE';
  content: string;
}

export type SecretPayload =
  | LoginData
  | SshKeyData
  | CertificateData
  | ApiKeyData
  | SecureNoteData;

/** Full secret detail returned by GET /api/secrets/:id. */
export interface SecretDetail extends SecretListItem {
  data: SecretPayload;
  shared?: boolean;
  permission?: 'READ_ONLY' | 'FULL_ACCESS';
}

/** Filters for listing secrets. */
export interface SecretListFilters {
  scope?: SecretScope;
  type?: SecretType;
  folderId?: string | null;
  search?: string;
  tags?: string[];
  isFavorite?: boolean;
}

/** Vault folder data returned by GET /api/vault-folders. */
export interface VaultFolderData {
  id: string;
  name: string;
  parentId: string | null;
  scope: 'PERSONAL' | 'TEAM' | 'TENANT';
  sortOrder: number;
  userId: string;
  teamId: string | null;
  tenantId: string | null;
  teamName?: string | null;
}

/** Vault folders grouped by scope. */
export interface VaultFoldersResponse {
  personal: VaultFolderData[];
  team: VaultFolderData[];
  tenant: VaultFolderData[];
}

// ── Autofill preferences ──────────────────────────────────────────────

/** Autofill preferences stored in chrome.storage.local. */
export interface AutofillPreferences {
  /** Whether autofill is enabled globally. Defaults to true. */
  globalEnabled: boolean;
  /** Domains where autofill is disabled (e.g. ["example.com", "internal.corp"]). */
  disabledSites: string[];
}
