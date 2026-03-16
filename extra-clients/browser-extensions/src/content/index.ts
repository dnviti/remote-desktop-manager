/**
 * Content script entry point — runs on all pages at document_idle.
 *
 * Initializes the credential autofill system which detects login forms
 * on web pages and offers to fill them with credentials from the
 * Arsenale keychain.
 */

import { initAutofill } from './autofill';

// Initialize autofill system
initAutofill().catch(() => {
  // Silently fail — autofill is a best-effort feature and should never
  // interfere with the host page's functionality.
});
