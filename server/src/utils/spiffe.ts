import crypto from 'crypto';

const SPIFFE_SCHEME = 'spiffe://';

function encodePathSegment(segment: string): string {
  const value = segment.trim();
  if (!value) {
    throw new Error('SPIFFE path segments cannot be empty');
  }
  return encodeURIComponent(value);
}

export function normalizeTrustDomain(trustDomain: string): string {
  const value = trustDomain.trim().toLowerCase();
  if (!value || value.includes('/')) {
    throw new Error(`Invalid SPIFFE trust domain: ${trustDomain}`);
  }
  return value;
}

export function buildSpiffeId(trustDomain: string, ...pathSegments: string[]): string {
  const domain = normalizeTrustDomain(trustDomain);
  const path = pathSegments.map(encodePathSegment).join('/');
  if (!path) {
    throw new Error('SPIFFE IDs require at least one path segment');
  }
  return `${SPIFFE_SCHEME}${domain}/${path}`;
}

export function buildServiceSpiffeId(trustDomain: string, serviceName: string): string {
  return buildSpiffeId(trustDomain, 'service', serviceName);
}

export function buildGatewaySpiffeId(trustDomain: string, gatewayId: string): string {
  return buildSpiffeId(trustDomain, 'gateway', gatewayId);
}

export function parseSubjectAltNameUris(subjectAltName?: string): string[] {
  if (!subjectAltName) return [];
  const matches = subjectAltName.matchAll(/(?:^|,\s*)URI:([^,]+)/g);
  return Array.from(matches, (match) => match[1].trim()).filter(Boolean);
}

export function extractSpiffeIdFromCertificate(cert: crypto.X509Certificate): string | null {
  const uris = parseSubjectAltNameUris(cert.subjectAltName);
  return uris.find((uri) => uri.startsWith(SPIFFE_SCHEME)) ?? null;
}

export function extractSpiffeIdFromCertPem(certPem: string): string | null {
  try {
    return extractSpiffeIdFromCertificate(new crypto.X509Certificate(certPem));
  } catch {
    return null;
  }
}

export function spiffeIdEquals(actual: string | null | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBuf = Buffer.from(actual, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return actualBuf.length === expectedBuf.length && crypto.timingSafeEqual(actualBuf, expectedBuf);
}
