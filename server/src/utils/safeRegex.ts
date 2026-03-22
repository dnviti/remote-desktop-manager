/**
 * Shared regex validation utilities for admin-supplied patterns.
 *
 * All services that compile user-provided regex strings (firewall rules,
 * masking policies, keystroke policies) must validate through these helpers
 * to prevent ReDoS and injection.
 */

/** Detects nested quantifiers that can cause catastrophic backtracking.
 *  Matches adjacent quantifiers (e.g. a++) and paren-wrapped ones (e.g. (a+)+). */
const NESTED_QUANTIFIER_RE = /(\+|\*|\{[^}]+\})\s*\)?\s*(\+|\*|\?|\{[^}]+\})/;

/** Maximum allowed pattern length. */
export const MAX_REGEX_LENGTH = 500;

/**
 * Return true if the pattern is safe to compile as a RegExp.
 * Rejects nested quantifiers and overly long patterns.
 */
export function isRegexSafe(pattern: string): boolean {
  if (pattern.length > MAX_REGEX_LENGTH) return false;
  if (NESTED_QUANTIFIER_RE.test(pattern)) return false;
  return true;
}

/**
 * Safely compile a user-supplied regex string.
 * Validates safety first, then compiles. Throws a descriptive error on failure.
 */
export function compileRegex(pattern: string, flags?: string, label = 'pattern'): RegExp {
  if (!isRegexSafe(pattern)) {
    throw new Error(`Regex ${label} rejected: pattern too long or contains nested quantifiers`);
  }
  try {
    // isRegexSafe() validates length and rejects nested quantifiers (ReDoS).
    // This function is used for admin-supplied patterns (firewall rules, masking policies)
    // where dynamic regex is intentional — not end-user input.
    // eslint-disable-next-line security/detect-non-literal-regexp
    return new RegExp(pattern, flags); // codeql[js/regex-injection] — validated by isRegexSafe() above; admin-only patterns
  } catch {
    throw new Error(`Invalid regex ${label}: ${pattern}`);
  }
}
