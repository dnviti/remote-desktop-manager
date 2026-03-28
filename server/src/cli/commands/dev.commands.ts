import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import prisma from '../../lib/prisma';
import { completeSetup, isSetupRequired } from '../../services/setup.service';
import * as tenantService from '../../services/tenant.service';
import * as sshKeyService from '../../services/sshkey.service';
import * as gatewayService from '../../services/gateway.service';
import { encryptWithServerKey } from '../../services/crypto.service';
import { certFingerprint } from '../../utils/certGenerator';
import { printError, printSuccess } from '../helpers/output';

type DevGatewaySpec = {
  id: string;
  name: string;
  type: 'MANAGED_SSH' | 'GUACD' | 'DB_PROXY';
  host: string;
  port: number;
  apiPort?: number;
  token: string;
  certDir: string;
  description: string;
};

const DEFAULT_ADMIN_EMAIL = process.env.DEV_BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com';
const DEFAULT_ADMIN_PASSWORD = process.env.DEV_BOOTSTRAP_ADMIN_PASSWORD || 'DevAdmin123!';
const DEFAULT_ADMIN_USERNAME = process.env.DEV_BOOTSTRAP_ADMIN_USERNAME || 'admin';
const DEFAULT_TENANT_NAME = process.env.DEV_BOOTSTRAP_TENANT_NAME || 'Development Environment';
const DEFAULT_CERT_DIR = process.env.DEV_TUNNEL_CERT_DIR || path.resolve(process.cwd(), 'dev-certs');

function requiredEnv(name: string, fallback: string): string {
  return (process.env[name] || fallback).trim();
}

function buildGatewaySpecs(certDir: string): DevGatewaySpec[] {
  return [
    {
      id: requiredEnv('DEV_TUNNEL_MANAGED_SSH_GATEWAY_ID', '11111111-1111-4111-8111-111111111111'),
      name: 'Dev Tunnel Managed SSH',
      type: 'MANAGED_SSH',
      host: 'dev-tunnel-ssh-gateway',
      port: 2222,
      apiPort: 9022,
      token: requiredEnv('DEV_TUNNEL_MANAGED_SSH_TOKEN', 'dev-tunnel-managed-ssh-token'),
      certDir: path.join(certDir, 'tunnel-managed-ssh'),
      description: 'Development managed SSH gateway registered through the zero-trust tunnel',
    },
    {
      id: requiredEnv('DEV_TUNNEL_GUACD_GATEWAY_ID', '22222222-2222-4222-8222-222222222222'),
      name: 'Dev Tunnel GUACD',
      type: 'GUACD',
      host: 'dev-tunnel-guacd',
      port: 4822,
      token: requiredEnv('DEV_TUNNEL_GUACD_TOKEN', 'dev-tunnel-guacd-token'),
      certDir: path.join(certDir, 'tunnel-guacd'),
      description: 'Development guacd gateway registered through the zero-trust tunnel',
    },
    {
      id: requiredEnv('DEV_TUNNEL_DB_PROXY_GATEWAY_ID', '33333333-3333-4333-8333-333333333333'),
      name: 'Dev Tunnel DB Proxy',
      type: 'DB_PROXY',
      host: 'dev-tunnel-db-proxy',
      port: 5432,
      token: requiredEnv('DEV_TUNNEL_DB_PROXY_TOKEN', 'dev-tunnel-db-proxy-token'),
      certDir: path.join(certDir, 'tunnel-db-proxy'),
      description: 'Development database proxy gateway registered through the zero-trust tunnel',
    },
  ];
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function readRequiredFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').trim();
}

function readCertBundle(certDir: string): { certPem: string; keyPem: string; expiry: Date } {
  const certPem = readRequiredFile(path.join(certDir, 'client-cert.pem'));
  const keyPem = readRequiredFile(path.join(certDir, 'client-key.pem'));
  const expiry = new Date(new crypto.X509Certificate(certPem).validTo);
  return { certPem, keyPem, expiry };
}

async function ensureSetup(): Promise<{ userId: string; tenantId: string }> {
  if (await isSetupRequired()) {
    await completeSetup({
      admin: {
        email: DEFAULT_ADMIN_EMAIL,
        username: DEFAULT_ADMIN_USERNAME,
        password: DEFAULT_ADMIN_PASSWORD,
      },
      tenant: {
        name: DEFAULT_TENANT_NAME,
      },
      settings: {
        selfSignupEnabled: false,
      },
    });
  }

  let user = await prisma.user.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL },
    select: { id: true },
  });
  if (!user) {
    user = await prisma.user.findFirst({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
  }
  if (!user) {
    throw new Error('No user available for development bootstrap');
  }

  let tenant = await prisma.tenant.findFirst({
    where: { name: DEFAULT_TENANT_NAME },
    select: { id: true },
  });
  if (!tenant) {
    const created = await tenantService.createTenant(user.id, DEFAULT_TENANT_NAME);
    tenant = { id: created.id };
  }

  await prisma.tenantMember.updateMany({
    where: { userId: user.id, isActive: true, tenantId: { not: tenant.id } },
    data: { isActive: false },
  });
  await prisma.tenantMember.upsert({
    where: {
      tenantId_userId: {
        tenantId: tenant.id,
        userId: user.id,
      },
    },
    update: {
      role: 'OWNER',
      status: 'ACCEPTED',
      isActive: true,
    },
    create: {
      tenantId: tenant.id,
      userId: user.id,
      role: 'OWNER',
      status: 'ACCEPTED',
      isActive: true,
    },
  });

  const sshKeyPair = await prisma.sshKeyPair.findUnique({ where: { tenantId: tenant.id } });
  if (!sshKeyPair) {
    await sshKeyService.generateKeyPair(tenant.id);
  }

  return { userId: user.id, tenantId: tenant.id };
}

async function syncTenantTunnelCa(tenantId: string, certDir: string): Promise<void> {
  const caCertPem = readRequiredFile(path.join(certDir, 'ca.pem'));
  const caKeyPem = readRequiredFile(path.join(certDir, 'ca-key.pem'));
  const encryptedCaKey = encryptWithServerKey(caKeyPem);

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      tunnelCaCert: caCertPem,
      tunnelCaKey: encryptedCaKey.ciphertext,
      tunnelCaKeyIV: encryptedCaKey.iv,
      tunnelCaKeyTag: encryptedCaKey.tag,
      tunnelCaCertFingerprint: certFingerprint(caCertPem),
    },
  });
}

async function upsertGateway(userId: string, tenantId: string, spec: DevGatewaySpec): Promise<void> {
  const encryptedToken = encryptWithServerKey(spec.token);
  const { certPem, keyPem, expiry } = readCertBundle(spec.certDir);
  const encryptedClientKey = encryptWithServerKey(keyPem);

  await prisma.gateway.upsert({
    where: { id: spec.id },
    update: {
      name: spec.name,
      type: spec.type,
      host: spec.host,
      port: spec.port,
      apiPort: spec.apiPort ?? null,
      description: spec.description,
      tenantId,
      createdById: userId,
      isDefault: true,
      isManaged: true,
      publishPorts: false,
      desiredReplicas: 1,
      tunnelEnabled: true,
      encryptedTunnelToken: encryptedToken.ciphertext,
      tunnelTokenIV: encryptedToken.iv,
      tunnelTokenTag: encryptedToken.tag,
      tunnelTokenHash: hashToken(spec.token),
      tunnelClientCert: certPem,
      tunnelClientCertExp: expiry,
      tunnelClientKey: encryptedClientKey.ciphertext,
      tunnelClientKeyIV: encryptedClientKey.iv,
      tunnelClientKeyTag: encryptedClientKey.tag,
      monitoringEnabled: true,
      monitorIntervalMs: 5000,
      inactivityTimeoutSeconds: 3600,
    },
    create: {
      id: spec.id,
      name: spec.name,
      type: spec.type,
      host: spec.host,
      port: spec.port,
      apiPort: spec.apiPort ?? null,
      description: spec.description,
      tenantId,
      createdById: userId,
      isDefault: true,
      isManaged: true,
      publishPorts: false,
      desiredReplicas: 1,
      tunnelEnabled: true,
      encryptedTunnelToken: encryptedToken.ciphertext,
      tunnelTokenIV: encryptedToken.iv,
      tunnelTokenTag: encryptedToken.tag,
      tunnelTokenHash: hashToken(spec.token),
      tunnelClientCert: certPem,
      tunnelClientCertExp: expiry,
      tunnelClientKey: encryptedClientKey.ciphertext,
      tunnelClientKeyIV: encryptedClientKey.iv,
      tunnelClientKeyTag: encryptedClientKey.tag,
      monitoringEnabled: true,
      monitorIntervalMs: 5000,
      inactivityTimeoutSeconds: 3600,
    },
  });
}

export function registerDevCommands(program: Command): void {
  const dev = program.command('dev').description('Development environment bootstrap commands');

  dev
    .command('bootstrap')
    .description('Bootstrap development users, tenant, and tunnel-backed managed gateways')
    .action(async () => {
      try {
        const certDir = DEFAULT_CERT_DIR;
        const { userId, tenantId } = await ensureSetup();
        await syncTenantTunnelCa(tenantId, certDir);

        const specs = buildGatewaySpecs(certDir);
        for (const spec of specs) {
          await upsertGateway(userId, tenantId, spec);
        }

        try {
          await gatewayService.pushKeyToAllManagedGateways(tenantId);
        } catch (err) {
          printError(`Managed SSH key push did not complete cleanly: ${err instanceof Error ? err.message : err}`);
        }

        printSuccess(`Development bootstrap complete for tenant ${tenantId}`);
        for (const spec of specs) {
          printSuccess(`  ${spec.type} gateway: ${spec.name} (${spec.id})`);
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : 'Development bootstrap failed');
        process.exitCode = 1;
      }
    });
}
