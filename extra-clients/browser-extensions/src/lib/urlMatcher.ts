/**
 * URL / domain matching for credential autofill.
 *
 * Matches the current page URL against secret metadata (url, domain) to find
 * relevant LOGIN-type credentials that can be offered for autofill.
 */

/** Lightweight credential index entry built from SecretListItem + LoginData. */
export interface CredentialIndexEntry {
  secretId: string;
  name: string;
  url?: string;
  domain?: string;
  accountId: string;
}

/**
 * Extract the registrable domain from a hostname.
 *
 * Handles common two-part TLDs (e.g. co.uk, com.au). For simplicity this uses
 * a short heuristic rather than the full Public Suffix List.
 *
 * Examples:
 *   "login.example.com"      -> "example.com"
 *   "app.service.co.uk"      -> "service.co.uk"
 *   "localhost"               -> "localhost"
 */
export function extractDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return hostname.toLowerCase();

  // Common two-part TLDs
  const twoPartTlds = new Set([
    'co.uk', 'co.jp', 'co.kr', 'co.nz', 'co.za', 'co.in',
    'com.au', 'com.br', 'com.cn', 'com.mx', 'com.tw', 'com.sg',
    'org.uk', 'net.au', 'ac.uk', 'gov.uk', 'edu.au',
  ]);

  const lastTwo = parts.slice(-2).join('.');
  if (twoPartTlds.has(lastTwo) && parts.length > 2) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
}

/**
 * Normalize a URL for prefix matching.
 *
 * Strips trailing slashes and normalizes protocol for comparison.
 */
function normalizeForMatch(url: string): string {
  let normalized = url.trim().toLowerCase();
  // Remove trailing slashes
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Check if a credential entry matches the given page URL.
 *
 * Match strategy (ordered by specificity):
 * 1. URL prefix match: secret.url is a prefix of the page URL (most specific)
 * 2. Domain match: extractDomain(secret.domain) === extractDomain(pageHostname)
 *
 * Returns a score: 2 for URL match, 1 for domain match, 0 for no match.
 */
export function matchScore(entry: CredentialIndexEntry, pageUrl: string): number {
  let parsedPage: URL;
  try {
    parsedPage = new URL(pageUrl);
  } catch {
    return 0;
  }

  // 1. URL prefix match
  if (entry.url) {
    const normalizedEntryUrl = normalizeForMatch(entry.url);
    const normalizedPageUrl = normalizeForMatch(pageUrl);
    if (normalizedPageUrl.startsWith(normalizedEntryUrl)) {
      return 2;
    }
    // Also try matching just the origin + pathname prefix
    try {
      const entryParsed = new URL(entry.url);
      if (
        parsedPage.hostname.toLowerCase() === entryParsed.hostname.toLowerCase() &&
        parsedPage.pathname.startsWith(entryParsed.pathname.replace(/\/$/, '') || '/')
      ) {
        return 2;
      }
    } catch {
      // Entry URL is not a valid URL, skip
    }
  }

  // 2. Domain match
  if (entry.domain) {
    const pageDomain = extractDomain(parsedPage.hostname);
    const entryDomain = extractDomain(entry.domain);
    if (pageDomain === entryDomain) {
      return 1;
    }
  }

  // 3. Fallback: try domain extraction from entry.url
  if (entry.url) {
    try {
      const entryParsed = new URL(entry.url);
      const pageDomain = extractDomain(parsedPage.hostname);
      const entryDomain = extractDomain(entryParsed.hostname);
      if (pageDomain === entryDomain) {
        return 1;
      }
    } catch {
      // Not a valid URL, skip
    }
  }

  return 0;
}

/**
 * Find all matching credentials for a page URL, sorted by match quality.
 */
export function findMatchingCredentials(
  index: CredentialIndexEntry[],
  pageUrl: string,
): CredentialIndexEntry[] {
  const scored = index
    .map((entry) => ({ entry, score: matchScore(entry, pageUrl) }))
    .filter(({ score }) => score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map(({ entry }) => entry);
}
