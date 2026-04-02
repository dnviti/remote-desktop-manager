import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Clean tunnel vars before each test
    delete process.env.TUNNEL_SERVER_URL;
    delete process.env.TUNNEL_TOKEN;
    delete process.env.TUNNEL_GATEWAY_ID;
    delete process.env.TUNNEL_LOCAL_PORT;
    delete process.env.TUNNEL_LOCAL_HOST;
    delete process.env.TUNNEL_CA_CERT;
    delete process.env.TUNNEL_CA_CERT_FILE;
    delete process.env.TUNNEL_CLIENT_CERT;
    delete process.env.TUNNEL_CLIENT_CERT_FILE;
    delete process.env.TUNNEL_CLIENT_KEY;
    delete process.env.TUNNEL_CLIENT_KEY_FILE;
    delete process.env.TUNNEL_PING_INTERVAL_MS;
    delete process.env.TUNNEL_RECONNECT_INITIAL_MS;
    delete process.env.TUNNEL_RECONNECT_MAX_MS;
    delete process.env.TUNNEL_AGENT_VERSION;
  });

  afterEach(() => {
    // Restore env — delete any TUNNEL_ vars added during the test
    const tunnelKeys = [
      'TUNNEL_SERVER_URL', 'TUNNEL_TOKEN', 'TUNNEL_GATEWAY_ID', 'TUNNEL_LOCAL_PORT',
      'TUNNEL_LOCAL_HOST', 'TUNNEL_CA_CERT', 'TUNNEL_CA_CERT_FILE', 'TUNNEL_CLIENT_CERT',
      'TUNNEL_CLIENT_CERT_FILE', 'TUNNEL_CLIENT_KEY', 'TUNNEL_CLIENT_KEY_FILE',
      'TUNNEL_PING_INTERVAL_MS', 'TUNNEL_RECONNECT_INITIAL_MS', 'TUNNEL_RECONNECT_MAX_MS',
      'TUNNEL_AGENT_VERSION',
    ] as const;
    for (const key of tunnelKeys) {
      if (!(key in ORIGINAL_ENV)) {
        process.env[key] = undefined;
      }
    }
  });

  it('returns null when no tunnel env vars are set (dormant mode)', () => {
    const cfg = loadConfig();
    expect(cfg).toBeNull();
  });

  it('returns a valid config when all required vars are set', () => {
    process.env.TUNNEL_SERVER_URL = 'wss://example.com/tunnel';
    process.env.TUNNEL_TOKEN = 'abc123';
    process.env.TUNNEL_GATEWAY_ID = 'gw-uuid-001';
    process.env.TUNNEL_LOCAL_PORT = '4822';

    const cfg = loadConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.serverUrl).toBe('wss://example.com/tunnel');
    expect(cfg!.token).toBe('abc123');
    expect(cfg!.gatewayId).toBe('gw-uuid-001');
    expect(cfg!.localServicePort).toBe(4822);
    expect(cfg!.localServiceHost).toBe('127.0.0.1');
  });

  it('uses default values for optional settings', () => {
    process.env.TUNNEL_SERVER_URL = 'wss://example.com/tunnel';
    process.env.TUNNEL_TOKEN = 'abc123';
    process.env.TUNNEL_GATEWAY_ID = 'gw-uuid-001';
    process.env.TUNNEL_LOCAL_PORT = '2222';

    const cfg = loadConfig();
    expect(cfg!.pingIntervalMs).toBe(15000);
    expect(cfg!.reconnectInitialMs).toBe(1000);
    expect(cfg!.reconnectMaxMs).toBe(60000);
    expect(cfg!.localServiceHost).toBe('127.0.0.1');
    expect(cfg!.caCert).toBeUndefined();
    expect(cfg!.clientCert).toBeUndefined();
    expect(cfg!.clientKey).toBeUndefined();
  });

  it('includes optional TLS values when set', () => {
    process.env.TUNNEL_SERVER_URL = 'wss://example.com/tunnel';
    process.env.TUNNEL_TOKEN = 'tok';
    process.env.TUNNEL_GATEWAY_ID = 'gw-1';
    process.env.TUNNEL_LOCAL_PORT = '4822';
    process.env.TUNNEL_CA_CERT = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
    process.env.TUNNEL_CLIENT_CERT = '-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----';
    process.env.TUNNEL_CLIENT_KEY = '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----';

    const cfg = loadConfig();
    expect(cfg!.caCert).toBeDefined();
    expect(cfg!.clientCert).toBeDefined();
    expect(cfg!.clientKey).toBeDefined();
  });

  it('reads optional TLS values from files when *_FILE vars are set', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tunnel-agent-config-'));
    const caPath = path.join(tempDir, 'ca.pem');
    const certPath = path.join(tempDir, 'client.pem');
    const keyPath = path.join(tempDir, 'client.key');

    // Controlled temp files created by the test harness.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(caPath, 'ca-pem\n');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(certPath, 'client-pem\n');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.writeFileSync(keyPath, 'key-pem\n');

    process.env.TUNNEL_SERVER_URL = 'wss://example.com/tunnel';
    process.env.TUNNEL_TOKEN = 'tok';
    process.env.TUNNEL_GATEWAY_ID = 'gw-1';
    process.env.TUNNEL_LOCAL_PORT = '4822';
    process.env.TUNNEL_CA_CERT_FILE = caPath;
    process.env.TUNNEL_CLIENT_CERT_FILE = certPath;
    process.env.TUNNEL_CLIENT_KEY_FILE = keyPath;

    const cfg = loadConfig();
    expect(cfg!.caCert).toBe('ca-pem');
    expect(cfg!.clientCert).toBe('client-pem');
    expect(cfg!.clientKey).toBe('key-pem');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
