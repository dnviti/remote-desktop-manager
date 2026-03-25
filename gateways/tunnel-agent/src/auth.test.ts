import { describe, it, expect } from 'vitest';
import { buildWsOptions } from './auth';
import type { TunnelConfig } from './config';

function makeConfig(overrides: Partial<TunnelConfig> = {}): TunnelConfig {
  return {
    serverUrl: 'wss://example.com/tunnel',
    token: 'test-token-abc',
    gatewayId: 'gw-001',
    agentVersion: '1.0.0',
    pingIntervalMs: 15000,
    reconnectInitialMs: 1000,
    reconnectMaxMs: 60000,
    localServiceHost: 'localhost',
    localServicePort: 4822,
    ...overrides,
  };
}

describe('buildWsOptions', () => {
  it('returns Authorization header with Bearer prefix', () => {
    const opts = buildWsOptions(makeConfig({ token: 'my-secret-token' }));
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer my-secret-token');
  });

  it('includes X-Gateway-Id header', () => {
    const opts = buildWsOptions(makeConfig({ gatewayId: 'gw-42' }));
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-Gateway-Id']).toBe('gw-42');
  });

  it('includes X-Agent-Version header', () => {
    const opts = buildWsOptions(makeConfig({ agentVersion: '2.3.4' }));
    const headers = opts.headers as Record<string, string>;
    expect(headers['X-Agent-Version']).toBe('2.3.4');
  });

  it('sets handshakeTimeout to 10 seconds', () => {
    const opts = buildWsOptions(makeConfig());
    expect(opts.handshakeTimeout).toBe(10_000);
  });

  it('includes TLS certs when all are provided', () => {
    const opts = buildWsOptions(makeConfig({
      caCert: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
      clientCert: '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
      clientKey: '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----',
    }));
    expect(opts.ca).toBe('-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----');
    expect(opts.cert).toBe('-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----');
    expect(opts.key).toBe('-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----');
  });

  it('includes only CA cert when client cert/key are absent', () => {
    const opts = buildWsOptions(makeConfig({
      caCert: '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----',
    }));
    expect(opts.ca).toBe('-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----');
    expect(opts.cert).toBeUndefined();
    expect(opts.key).toBeUndefined();
  });

  it('omits all TLS fields when no certs are provided', () => {
    const opts = buildWsOptions(makeConfig());
    expect(opts.ca).toBeUndefined();
    expect(opts.cert).toBeUndefined();
    expect(opts.key).toBeUndefined();
  });

  it('does not include client cert/key when only one of them is set', () => {
    const opts = buildWsOptions(makeConfig({
      clientCert: '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----',
      // clientKey intentionally missing
    }));
    expect(opts.cert).toBeUndefined();
    expect(opts.key).toBeUndefined();
  });
});
