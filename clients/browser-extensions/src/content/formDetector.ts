/**
 * Form detector — scans the DOM for login forms and credential input fields.
 *
 * Designed to be lightweight: runs once at document_idle and watches for
 * dynamically added forms via a targeted MutationObserver.
 */

/** Detected login form with references to the relevant input elements. */
export interface DetectedForm {
  /** The form element (or a synthetic wrapper for orphan inputs). */
  form: HTMLFormElement | null;
  /** The username/email input. */
  usernameInput: HTMLInputElement | null;
  /** The password input. */
  passwordInput: HTMLInputElement;
}

/** Selectors for password fields. */
const PASSWORD_SELECTOR = 'input[type="password"]';

/** Selectors for username/email fields near a password input. */
const USERNAME_SELECTORS = [
  'input[type="email"]',
  'input[type="text"][name*="user"]',
  'input[type="text"][name*="login"]',
  'input[type="text"][name*="email"]',
  'input[type="text"][name*="account"]',
  'input[type="text"][autocomplete="username"]',
  'input[type="text"][autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[autocomplete="email"]',
  'input[type="text"][id*="user"]',
  'input[type="text"][id*="login"]',
  'input[type="text"][id*="email"]',
];

/**
 * Find the closest username/email input relative to a password field.
 *
 * Search strategy:
 * 1. If the password is inside a <form>, search within that form.
 * 2. Otherwise, look for a sibling or nearby preceding input.
 */
function findUsernameInput(passwordInput: HTMLInputElement): HTMLInputElement | null {
  const container = passwordInput.closest('form') ?? passwordInput.parentElement?.closest('div, section, fieldset');
  if (!container) return null;

  for (const selector of USERNAME_SELECTORS) {
    const candidates = container.querySelectorAll<HTMLInputElement>(selector);
    for (const candidate of candidates) {
      // Skip hidden inputs
      if (candidate.type === 'hidden' || !candidate.offsetParent) continue;
      return candidate;
    }
  }

  // Fallback: find any visible text input that precedes the password input in DOM order
  const allInputs = container.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="password"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"])');
  for (const input of allInputs) {
    if (!input.offsetParent) continue;
    // Must appear before the password field in DOM
    if (input.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING) {
      return input;
    }
  }

  return null;
}

/**
 * Scan the document for login forms.
 *
 * Returns an array of detected forms, each containing references to the
 * password input and the best-guess username input.
 */
export function detectLoginForms(): DetectedForm[] {
  const passwordInputs = document.querySelectorAll<HTMLInputElement>(PASSWORD_SELECTOR);
  const results: DetectedForm[] = [];
  const seen = new Set<HTMLInputElement>();

  for (const pwInput of passwordInputs) {
    // Skip hidden/invisible inputs
    if (pwInput.type === 'hidden' || !pwInput.offsetParent) continue;
    if (seen.has(pwInput)) continue;
    seen.add(pwInput);

    const form = pwInput.closest('form');
    const usernameInput = findUsernameInput(pwInput);

    results.push({
      form,
      usernameInput,
      passwordInput: pwInput,
    });
  }

  return results;
}

/**
 * Watch for dynamically added login forms using MutationObserver.
 *
 * The callback is invoked whenever new password inputs are detected.
 * Returns a disconnect function to stop observing.
 */
export function watchForLoginForms(
  callback: (forms: DetectedForm[]) => void,
): () => void {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const observer = new MutationObserver(() => {
    // Debounce: many SPA frameworks add nodes in bursts
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const forms = detectLoginForms();
      if (forms.length > 0) {
        callback(forms);
      }
    }, 500);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    observer.disconnect();
  };
}
