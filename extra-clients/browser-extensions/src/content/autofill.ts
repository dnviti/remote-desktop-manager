/**
 * Autofill orchestrator — coordinates form detection, credential matching,
 * and the autofill UI. Communicates with the service worker via
 * chrome.runtime.sendMessage for all API operations.
 */

import { detectLoginForms, watchForLoginForms } from './formDetector';
import type { DetectedForm } from './formDetector';
import {
  createAutofillAnchor,
  fillFormFields,
  removeAllAnchors,
  updateAnchorCredentials,
} from './autofillUI';
import type { CredentialIndexEntry } from '../lib/urlMatcher';

/** Message types for content script <-> service worker communication. */
interface AutofillGetMatchesMessage {
  type: 'AUTOFILL_GET_MATCHES';
  url: string;
}

interface AutofillGetCredentialMessage {
  type: 'AUTOFILL_GET_CREDENTIAL';
  secretId: string;
  accountId: string;
}

interface AutofillGetStatusMessage {
  type: 'AUTOFILL_GET_STATUS';
  url: string;
}

interface AutofillOpenPopupMessage {
  type: 'AUTOFILL_OPEN_POPUP';
}

interface AutofillIsDisabledMessage {
  type: 'AUTOFILL_IS_DISABLED';
  domain: string;
}

export type AutofillMessage =
  | AutofillGetMatchesMessage
  | AutofillGetCredentialMessage
  | AutofillGetStatusMessage
  | AutofillOpenPopupMessage
  | AutofillIsDisabledMessage;

/** Response from AUTOFILL_GET_STATUS. */
interface AutofillStatusResponse {
  success: boolean;
  data?: {
    hasAccount: boolean;
    vaultLocked: boolean;
    autofillDisabledGlobally: boolean;
  };
  error?: string;
}

/** Response from AUTOFILL_GET_MATCHES. */
interface AutofillMatchesResponse {
  success: boolean;
  data?: CredentialIndexEntry[];
  error?: string;
}

/** Response from AUTOFILL_GET_CREDENTIAL. */
interface AutofillCredentialResponse {
  success: boolean;
  data?: {
    username: string;
    password: string;
  };
  error?: string;
}

/** Response from AUTOFILL_IS_DISABLED. */
interface AutofillIsDisabledResponse {
  success: boolean;
  data?: {
    disabled: boolean;
  };
  error?: string;
}

/** Send a typed message to the service worker. */
function sendToBackground<T>(message: AutofillMessage): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: T) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message } as T);
        return;
      }
      resolve(response ?? ({ success: false, error: 'No response' } as T));
    });
  });
}

/** Current state */
let currentForms: DetectedForm[] = [];
let currentMatches: CredentialIndexEntry[] = [];
let isVaultLocked = false;
let isInitialized = false;

/**
 * Initialize the autofill system. Called once at document_idle.
 */
export async function initAutofill(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  // Skip non-http(s) pages
  if (!window.location.protocol.startsWith('http')) return;

  // Check if autofill is disabled for this domain
  const domain = window.location.hostname;
  const disabledRes = await sendToBackground<AutofillIsDisabledResponse>({
    type: 'AUTOFILL_IS_DISABLED',
    domain,
  });
  if (disabledRes.success && disabledRes.data?.disabled) return;

  // Check status: do we have an account? Is vault locked?
  const statusRes = await sendToBackground<AutofillStatusResponse>({
    type: 'AUTOFILL_GET_STATUS',
    url: window.location.href,
  });

  if (!statusRes.success || !statusRes.data?.hasAccount) return;
  if (statusRes.data.autofillDisabledGlobally) return;

  isVaultLocked = statusRes.data.vaultLocked;

  // Scan for existing login forms
  currentForms = detectLoginForms();
  if (currentForms.length > 0) {
    await processDetectedForms(currentForms);
  }

  // Watch for dynamically added forms (SPAs)
  watchForLoginForms(async (forms) => {
    // Merge with existing, avoiding duplicates by password input reference
    const existingPwInputs = new Set(currentForms.map((f) => f.passwordInput));
    const newForms = forms.filter((f) => !existingPwInputs.has(f.passwordInput));
    if (newForms.length > 0) {
      currentForms = [...currentForms, ...newForms];
      await processDetectedForms(newForms);
    }
  });
}

/**
 * Process newly detected forms: fetch matches and show autofill anchors.
 */
async function processDetectedForms(forms: DetectedForm[]): Promise<void> {
  // Fetch matching credentials for this URL
  if (!isVaultLocked) {
    const matchRes = await sendToBackground<AutofillMatchesResponse>({
      type: 'AUTOFILL_GET_MATCHES',
      url: window.location.href,
    });
    if (matchRes.success && matchRes.data) {
      currentMatches = matchRes.data;
    }
  }

  // Create anchors for each detected password field
  for (const form of forms) {
    createAutofillAnchor(form.passwordInput, {
      credentials: currentMatches,
      vaultLocked: isVaultLocked,
      onSelect: (entry) => handleCredentialSelect(entry, form),
      onVaultUnlock: handleVaultUnlock,
    });
  }
}

/**
 * Handle credential selection: fetch the full secret data and fill the form.
 */
async function handleCredentialSelect(
  entry: CredentialIndexEntry,
  form: DetectedForm,
): Promise<void> {
  const credRes = await sendToBackground<AutofillCredentialResponse>({
    type: 'AUTOFILL_GET_CREDENTIAL',
    secretId: entry.secretId,
    accountId: entry.accountId,
  });

  if (!credRes.success || !credRes.data) {
    // If vault got locked, update UI
    if (credRes.error === 'vault_locked') {
      isVaultLocked = true;
      refreshAllAnchors();
    }
    return;
  }

  fillFormFields(
    form.usernameInput,
    form.passwordInput,
    credRes.data.username,
    credRes.data.password,
  );

  // Close all dropdowns by removing and re-adding anchors
  removeAllAnchors();
}

/**
 * Handle vault unlock request: open the extension popup.
 */
function handleVaultUnlock(): void {
  sendToBackground<{ success: boolean }>({ type: 'AUTOFILL_OPEN_POPUP' });
}

/**
 * Refresh all active anchors (e.g., after vault state change).
 */
function refreshAllAnchors(): void {
  removeAllAnchors();
  for (const form of currentForms) {
    createAutofillAnchor(form.passwordInput, {
      credentials: currentMatches,
      vaultLocked: isVaultLocked,
      onSelect: (entry) => handleCredentialSelect(entry, form),
      onVaultUnlock: handleVaultUnlock,
    });
  }
}

/**
 * Listen for messages from the service worker (e.g., vault state changes).
 */
chrome.runtime.onMessage.addListener((message: { type: string; vaultLocked?: boolean; matches?: CredentialIndexEntry[] }) => {
  if (message.type === 'AUTOFILL_VAULT_STATE_CHANGED') {
    isVaultLocked = message.vaultLocked ?? false;
    if (!isVaultLocked && currentForms.length > 0) {
      // Vault just unlocked — fetch matches and refresh
      sendToBackground<AutofillMatchesResponse>({
        type: 'AUTOFILL_GET_MATCHES',
        url: window.location.href,
      }).then((res) => {
        if (res.success && res.data) {
          currentMatches = res.data;
        }
        refreshAllAnchors();
      });
    } else {
      refreshAllAnchors();
    }
  }

  if (message.type === 'AUTOFILL_MATCHES_UPDATED' && message.matches) {
    currentMatches = message.matches;
    // Update existing anchor dropdowns without recreating
    const anchors = document.querySelectorAll('[data-arsenale-autofill]');
    if (anchors.length > 0) {
      refreshAllAnchors();
    }
  }
});

// Re-export AutofillMessage and related for background.ts
export type { AutofillStatusResponse, AutofillMatchesResponse, AutofillCredentialResponse, AutofillIsDisabledResponse };

// Also export updateAnchorCredentials for type completeness
export { updateAnchorCredentials };
