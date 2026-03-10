 
import { Command } from 'commander';
import prisma from '../../lib/prisma';
import * as tenantService from '../../services/tenant.service';
import * as auditService from '../../services/audit.service';
import { AuditAction } from '../../generated/prisma/client';
import { resolveUser, resolveTenant } from '../helpers/resolve';
import { requireConfirm } from '../helpers/confirm';
import { printJson, printTable, printError, printSuccess } from '../helpers/output';

export function registerUserCommands(program: Command): void {
  const user = program
    .command('user')
    .description('User management commands');

  user
    .command('list')
    .description('List users in a tenant')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .option('--limit <n>', 'Max results', '100')
    .action(async (opts: { tenantId: string; format: string; limit: string }) => {
      const tenant = await resolveTenant(opts.tenantId);
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      const users = await tenantService.listTenantUsers(tenant.id);
      const limited = users.slice(0, parseInt(opts.limit, 10));

      if (opts.format === 'json') {
        printJson(limited);
      } else {
        printTable(
          limited.map((u) => ({
            id: u.id,
            email: u.email,
            username: u.username ?? '',
            role: u.role,
            enabled: u.enabled ? 'yes' : 'no',
            mfa: u.totpEnabled || u.smsMfaEnabled ? 'yes' : 'no',
          })),
          [
            { key: 'id', header: 'ID', width: 36 },
            { key: 'email', header: 'EMAIL' },
            { key: 'username', header: 'USERNAME' },
            { key: 'role', header: 'ROLE', width: 8 },
            { key: 'enabled', header: 'ENABLED', width: 7 },
            { key: 'mfa', header: 'MFA', width: 3 },
          ],
        );
        console.log(`\nTotal: ${users.length}`);
      }
    });

  user
    .command('get')
    .description('Get user details by email or ID')
    .argument('<identifier>', 'User email or UUID')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { format: string }) => {
      const u = await resolveUser(identifier);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }

      const memberships = await prisma.tenantMember.findMany({
        where: { userId: u.id },
        include: { tenant: { select: { name: true, slug: true } } },
      });

      const data = {
        id: u.id,
        email: u.email,
        username: u.username,
        createdAt: u.createdAt.toISOString(),
        vaultSetupComplete: u.vaultSetupComplete,
        totpEnabled: u.totpEnabled,
        smsMfaEnabled: u.smsMfaEnabled,
        tenants: memberships.map((m) => ({
          tenantId: m.tenantId,
          name: m.tenant.name,
          slug: m.tenant.slug,
          role: m.role,
        })),
      };

      if (opts.format === 'json') {
        printJson(data);
      } else {
        console.log(`ID:       ${data.id}`);
        console.log(`Email:    ${data.email}`);
        console.log(`Username: ${data.username ?? '(none)'}`);
        console.log(`Created:  ${data.createdAt}`);
        console.log(`Vault:    ${data.vaultSetupComplete ? 'setup' : 'not setup'}`);
        console.log(`TOTP:     ${data.totpEnabled ? 'enabled' : 'disabled'}`);
        console.log(`SMS MFA:  ${data.smsMfaEnabled ? 'enabled' : 'disabled'}`);
        if (data.tenants.length > 0) {
          console.log('\nTenant memberships:');
          printTable(
            data.tenants.map((t) => ({ ...t })),
            [
              { key: 'name', header: 'TENANT' },
              { key: 'slug', header: 'SLUG' },
              { key: 'role', header: 'ROLE', width: 8 },
            ],
          );
        }
      }
    });

  user
    .command('create')
    .description('Create a new user in a tenant')
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--password <password>', 'User password')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .option('--username <name>', 'Display name')
    .option('--role <role>', 'Tenant role (ADMIN|MEMBER)', 'MEMBER')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { email: string; password: string; tenantId: string; username?: string; role: string; format: string }) => {
      const tenant = await resolveTenant(opts.tenantId);
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      const result = await tenantService.createUser(
        tenant.id,
        {
          email: opts.email,
          username: opts.username,
          password: opts.password,
          role: opts.role as 'ADMIN' | 'MEMBER',
        },
        'cli',
      );

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_CREATE_USER,
        targetType: 'USER',
        targetId: result.user.id,
        ipAddress: 'cli',
        details: { email: opts.email, role: opts.role, tenantId: tenant.id, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson(result);
      } else {
        printSuccess(`User created: ${result.user.email} (${result.user.id})`);
        console.log(`Role: ${result.user.role}`);
        console.log(`Recovery key: ${result.recoveryKey}`);
      }
    });

  user
    .command('disable')
    .description('Disable a user account')
    .argument('<identifier>', 'User email or UUID')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { tenantId: string; format: string }) => {
      const [u, tenant] = await Promise.all([resolveUser(identifier), resolveTenant(opts.tenantId)]);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      const result = await tenantService.toggleUserEnabled(tenant.id, u.id, false, 'cli');

      if (opts.format === 'json') {
        printJson(result);
      } else {
        printSuccess(`User disabled: ${result.email}`);
      }
    });

  user
    .command('enable')
    .description('Enable a user account')
    .argument('<identifier>', 'User email or UUID')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { tenantId: string; format: string }) => {
      const [u, tenant] = await Promise.all([resolveUser(identifier), resolveTenant(opts.tenantId)]);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      const result = await tenantService.toggleUserEnabled(tenant.id, u.id, true, 'cli');

      if (opts.format === 'json') {
        printJson(result);
      } else {
        printSuccess(`User enabled: ${result.email}`);
      }
    });

  user
    .command('reset-password')
    .description('Reset a user password (wipes encrypted data, disables TOTP)')
    .argument('<identifier>', 'User email or UUID')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .requiredOption('--new-password <password>', 'New password')
    .option('--confirm', 'Confirm destructive operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { tenantId: string; newPassword: string; confirm?: boolean; format: string }) => {
      const [u, tenant] = await Promise.all([resolveUser(identifier), resolveTenant(opts.tenantId)]);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      if (!requireConfirm(opts.confirm, `This will reset the password for ${u.email} (${u.id}).\nAll encrypted data will be wiped and TOTP will be disabled.`)) {
        return;
      }

      const result = await tenantService.adminResetPasswordDirect(tenant.id, u.id, opts.newPassword);

      auditService.log({
        userId: null,
        action: AuditAction.ADMIN_PASSWORD_CHANGE,
        targetType: 'USER',
        targetId: u.id,
        ipAddress: 'cli',
        details: { source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson(result);
      } else {
        printSuccess(`Password reset for: ${u.email}`);
        console.log(`Recovery key: ${result.recoveryKey}`);
      }
    });

  user
    .command('delete')
    .description('Delete a user permanently')
    .argument('<identifier>', 'User email or UUID')
    .option('--confirm', 'Confirm destructive operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { confirm?: boolean; format: string }) => {
      const u = await resolveUser(identifier);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }

      const [connections, memberships] = await Promise.all([
        prisma.connection.count({ where: { userId: u.id } }),
        prisma.tenantMember.count({ where: { userId: u.id } }),
      ]);

      if (!requireConfirm(opts.confirm, `This will permanently delete user ${u.email} (${u.id}).\n  Connections: ${connections}\n  Tenant memberships: ${memberships}`)) {
        return;
      }

      await prisma.user.delete({ where: { id: u.id } });

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_REMOVE_USER,
        targetType: 'USER',
        targetId: u.id,
        ipAddress: 'cli',
        details: { email: u.email, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson({ deleted: true, id: u.id, email: u.email });
      } else {
        printSuccess(`User deleted: ${u.email} (${u.id})`);
      }
    });
}
