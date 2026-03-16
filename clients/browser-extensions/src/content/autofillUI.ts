/**
 * Autofill UI — shadow DOM isolated dropdown for credential selection.
 *
 * Injects a floating icon near detected password fields. When clicked,
 * shows a dropdown of matching credentials from the Arsenale keychain.
 * Uses shadow DOM to isolate from host page styles and CSP.
 */

import type { CredentialIndexEntry } from '../lib/urlMatcher';

/** Callback invoked when the user selects a credential from the dropdown. */
export type OnCredentialSelect = (entry: CredentialIndexEntry) => void;

/** Callback invoked when the user clicks the vault unlock prompt. */
export type OnVaultUnlockRequest = () => void;

/** State for a single autofill anchor instance. */
interface AutofillAnchor {
  host: HTMLElement;
  shadowRoot: ShadowRoot;
  passwordInput: HTMLInputElement;
  cleanup: () => void;
}

/** Module-level registry of active anchors. */
const activeAnchors: AutofillAnchor[] = [];

/** CSS for the autofill UI, injected into each shadow root. */
const AUTOFILL_STYLES = `
  :host {
    all: initial;
    display: block;
    position: absolute;
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .arsenale-autofill-icon {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: #0f0f12;
    border: 1px solid #232328;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 150ms, border-color 150ms;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }

  .arsenale-autofill-icon:hover {
    background: #161619;
    border-color: #00e5a0;
  }

  .arsenale-autofill-icon svg {
    width: 16px;
    height: 16px;
    fill: #00e5a0;
  }

  .arsenale-dropdown {
    position: absolute;
    top: 30px;
    right: 0;
    min-width: 220px;
    max-width: 300px;
    max-height: 240px;
    overflow-y: auto;
    background: #0f0f12;
    border: 1px solid #232328;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    display: none;
    flex-direction: column;
    padding: 4px 0;
  }

  .arsenale-dropdown.open {
    display: flex;
  }

  .arsenale-dropdown-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    cursor: pointer;
    border: none;
    background: transparent;
    text-align: left;
    color: #f4f4f5;
    transition: background 120ms;
  }

  .arsenale-dropdown-item:hover {
    background: #1c1c20;
  }

  .arsenale-dropdown-item-name {
    font-size: 13px;
    font-weight: 500;
    color: #f4f4f5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .arsenale-dropdown-item-domain {
    font-size: 11px;
    color: #a1a1aa;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .arsenale-dropdown-empty {
    padding: 12px;
    font-size: 12px;
    color: #52525b;
    text-align: center;
  }

  .arsenale-dropdown-vault-locked {
    padding: 10px 12px;
    font-size: 12px;
    color: #a1a1aa;
    text-align: center;
    cursor: pointer;
    border: none;
    background: transparent;
    width: 100%;
    transition: background 120ms;
  }

  .arsenale-dropdown-vault-locked:hover {
    background: #1c1c20;
  }

  .arsenale-dropdown-vault-locked-text {
    color: #00e5a0;
    font-weight: 500;
  }

  .arsenale-dropdown-header {
    padding: 6px 12px;
    font-size: 10px;
    font-weight: 600;
    color: #52525b;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid #232328;
    margin-bottom: 2px;
  }
`;

/** SVG for the Arsenale key icon. */
const KEY_ICON_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>`;

/**
 * Position the autofill host element relative to the target input.
 */
function positionHost(host: HTMLElement, input: HTMLInputElement): void {
  const rect = input.getBoundingClientRect();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  host.style.position = 'absolute';
  host.style.top = `${String(rect.top + scrollY + (rect.height - 24) / 2)}px`;
  host.style.left = `${String(rect.right + scrollX - 30)}px`;
  host.style.width = '24px';
  host.style.height = '24px';
}

/**
 * Create and attach an autofill anchor near a password input field.
 */
export function createAutofillAnchor(
  passwordInput: HTMLInputElement,
  options: {
    credentials: CredentialIndexEntry[];
    vaultLocked: boolean;
    onSelect: OnCredentialSelect;
    onVaultUnlock: OnVaultUnlockRequest;
  },
): AutofillAnchor {
  // Create host element
  const host = document.createElement('div');
  host.setAttribute('data-arsenale-autofill', 'true');
  const shadowRoot = host.attachShadow({ mode: 'closed' });

  // Inject styles
  const style = document.createElement('style');
  style.textContent = AUTOFILL_STYLES;
  shadowRoot.appendChild(style);

  // Build icon
  const icon = document.createElement('div');
  icon.className = 'arsenale-autofill-icon';
  icon.innerHTML = KEY_ICON_SVG;
  icon.title = 'Arsenale — Autofill credentials';
  shadowRoot.appendChild(icon);

  // Build dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'arsenale-dropdown';
  shadowRoot.appendChild(dropdown);

  // Populate dropdown
  populateDropdown(dropdown, options);

  // Toggle dropdown on icon click
  let isOpen = false;
  const toggleDropdown = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    isOpen = !isOpen;
    dropdown.classList.toggle('open', isOpen);
  };
  icon.addEventListener('click', toggleDropdown);

  // Close dropdown on outside click
  const handleOutsideClick = (e: MouseEvent) => {
    if (isOpen && !host.contains(e.target as Node)) {
      isOpen = false;
      dropdown.classList.remove('open');
    }
  };
  document.addEventListener('click', handleOutsideClick, true);

  // Reposition on scroll/resize
  const reposition = () => positionHost(host, passwordInput);
  window.addEventListener('scroll', reposition, { passive: true });
  window.addEventListener('resize', reposition, { passive: true });

  // Initial position
  positionHost(host, passwordInput);

  // Insert into page
  document.body.appendChild(host);

  const cleanup = () => {
    icon.removeEventListener('click', toggleDropdown);
    document.removeEventListener('click', handleOutsideClick, true);
    window.removeEventListener('scroll', reposition);
    window.removeEventListener('resize', reposition);
    host.remove();
  };

  const anchor: AutofillAnchor = { host, shadowRoot, passwordInput, cleanup };
  activeAnchors.push(anchor);
  return anchor;
}

/**
 * Populate the dropdown with credential entries or a vault-locked message.
 */
function populateDropdown(
  dropdown: HTMLElement,
  options: {
    credentials: CredentialIndexEntry[];
    vaultLocked: boolean;
    onSelect: OnCredentialSelect;
    onVaultUnlock: OnVaultUnlockRequest;
  },
): void {
  dropdown.innerHTML = '';

  if (options.vaultLocked) {
    const header = document.createElement('div');
    header.className = 'arsenale-dropdown-header';
    header.textContent = 'Arsenale Keychain';
    dropdown.appendChild(header);

    const lockBtn = document.createElement('button');
    lockBtn.className = 'arsenale-dropdown-vault-locked';
    lockBtn.innerHTML = 'Vault is locked. <span class="arsenale-dropdown-vault-locked-text">Click to unlock</span>';
    lockBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      options.onVaultUnlock();
    });
    dropdown.appendChild(lockBtn);
    return;
  }

  if (options.credentials.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'arsenale-dropdown-empty';
    empty.textContent = 'No matching credentials found';
    dropdown.appendChild(empty);
    return;
  }

  const header = document.createElement('div');
  header.className = 'arsenale-dropdown-header';
  header.textContent = 'Arsenale Keychain';
  dropdown.appendChild(header);

  for (const cred of options.credentials) {
    const item = document.createElement('button');
    item.className = 'arsenale-dropdown-item';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'arsenale-dropdown-item-name';
    nameSpan.textContent = cred.name;
    item.appendChild(nameSpan);

    const domainSpan = document.createElement('span');
    domainSpan.className = 'arsenale-dropdown-item-domain';
    domainSpan.textContent = cred.domain ?? cred.url ?? '';
    item.appendChild(domainSpan);

    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      options.onSelect(cred);
    });

    dropdown.appendChild(item);
  }
}

/**
 * Update the credentials displayed in an existing anchor's dropdown.
 */
export function updateAnchorCredentials(
  anchor: AutofillAnchor,
  options: {
    credentials: CredentialIndexEntry[];
    vaultLocked: boolean;
    onSelect: OnCredentialSelect;
    onVaultUnlock: OnVaultUnlockRequest;
  },
): void {
  const dropdown = anchor.shadowRoot.querySelector('.arsenale-dropdown');
  if (dropdown instanceof HTMLElement) {
    populateDropdown(dropdown, options);
  }
  positionHost(anchor.host, anchor.passwordInput);
}

/**
 * Remove all autofill anchors from the page.
 */
export function removeAllAnchors(): void {
  for (const anchor of activeAnchors) {
    anchor.cleanup();
  }
  activeAnchors.length = 0;
}

/**
 * Fill detected form fields with credential data.
 */
export function fillFormFields(
  usernameInput: HTMLInputElement | null,
  passwordInput: HTMLInputElement,
  username: string,
  password: string,
): void {
  // Use native input setter to trigger React/Angular/Vue change detection
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set;

  if (usernameInput && username) {
    nativeInputValueSetter?.call(usernameInput, username);
    usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
    usernameInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (password) {
    nativeInputValueSetter?.call(passwordInput, password);
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
