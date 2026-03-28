import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { generateCaCert, generateClientCertificate, verifyCertChain } from './certGenerator';
import {
  buildGatewaySpiffeId,
  buildServiceSpiffeId,
  extractSpiffeIdFromCertPem,
  parseSubjectAltNameUris,
  spiffeIdEquals,
} from './spiffe';

describe('spiffe utilities', () => {
  it('builds stable SPIFFE IDs for services and gateways', () => {
    expect(buildServiceSpiffeId('Arsenale.Local', 'server')).toBe('spiffe://arsenale.local/service/server');
    expect(buildGatewaySpiffeId('arsenale.local', 'gateway-123')).toBe('spiffe://arsenale.local/gateway/gateway-123');
  });

  it('extracts SPIFFE IDs from generated client certificates', () => {
    const ca = generateCaCert('arsenale-test-ca');
    const spiffeId = buildGatewaySpiffeId('arsenale.local', 'gateway-123');
    const client = generateClientCertificate(ca.certPem, ca.keyPem, 'gateway-123', spiffeId, 30);

    expect(verifyCertChain(client.certPem, ca.certPem)).toBe(true);
    expect(extractSpiffeIdFromCertPem(client.certPem)).toBe(spiffeId);

    const cert = new crypto.X509Certificate(client.certPem);
    expect(parseSubjectAltNameUris(cert.subjectAltName)).toContain(spiffeId);
    expect(spiffeIdEquals(extractSpiffeIdFromCertPem(client.certPem), spiffeId)).toBe(true);
  });
});
