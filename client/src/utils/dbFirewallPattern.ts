export const MAX_DB_FIREWALL_REGEX_LENGTH = 500;

const NESTED_DB_FIREWALL_QUANTIFIER_RE = /(\+|\*|\{[^}]+\})\s*\)?\s*(\+|\*|\?|\{[^}]+\})/;

export function validateDbFirewallPattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) return 'Pattern is required';
  if (trimmed.length > MAX_DB_FIREWALL_REGEX_LENGTH || NESTED_DB_FIREWALL_QUANTIFIER_RE.test(trimmed)) {
    return 'Pattern is too complex or too long';
  }

  // Keep browser-side validation cheap so a malicious pattern cannot lock up the
  // admin tab before the backend performs the authoritative syntax check.
  return null;
}
