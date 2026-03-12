
import { Command } from 'commander';
import prisma from '../../lib/prisma';
import * as tenantService from '../../services/tenant.service';
import * as auditService from '../../services/audit.service';
import { AuditAction, Prisma } from '../../generated/prisma/client';
import { resolveUser, resolveTenant } from '../helpers/resolve';
import { requireConfirm } from '../helpers/confirm';
import { printJson, printTable, printError, printSuccess } from '../helpers/output';

export function registerUserCommands(program: Command): void {
  const user = program
    .command('user')
    .description('User management commands');

  user
    .command('list')
    .description('List users (global or per-tenant)')
    .option('--tenant-id <id>', 'Tenant ID or slug (omit for global listing)')
    .option('--enabled', 'Show only enabled users')
    .option('--disabled', 'Show only disabled users')
    .option('--no-tenant', 'Show only users without any tenant membership')
    .option('--search <term>', 'Search by email or username')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .option('--limit <n>', 'Max results', '100')
    .action(async (opts: { tenantId?: string; enabled?: boolean; disabled?: boolean; tenant?: boolean; search?: string; format: string; limit: string }) => {
      const limit = parseInt(opts.limit, 10);

      if (opts.tenantId) {
        // Tenant-scoped listing (existing behavior)
        const tenant = await resolveTenant(opts.tenantId);
        if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

        const users = await tenantService.listTenantUsers(tenant.id);
        const limited = users.slice(0, limit);

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
        return;
      }

      // Global listing
      const where: Prisma.UserWhereInput = {};

      if (opts.enabled) where.enabled = true;
      if (opts.disabled) where.enabled = false;
      // Commander parses --no-tenant as opts.tenant = false
      if (opts.tenant === false) where.tenantMemberships = { none: {} };
      if (opts.search) {
        where.OR = [
          { email: { contains: opts.search, mode: 'insensitive' } },
          { username: { contains: opts.search, mode: 'insensitive' } },
        ];
      }

      const users = await prisma.user.findMany({
        where,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tenantMemberships: {
            include: { tenant: { select: { slug: true } } },
          },
        },
      });

      if (opts.format === 'json') {
        printJson(users.map((u) => ({
          id: u.id,
          email: u.email,
          username: u.username,
          enabled: u.enabled,
          tenants: u.tenantMemberships.map((m) => ({ slug: m.tenant.slug, role: m.role })),
        })));
      } else {
        printTable(
          users.map((u) => ({
            id: u.id,
            email: u.email,
            username: u.username ?? '',
            enabled: u.enabled ? 'yes' : 'no',
            tenants: u.tenantMemberships.map((m) => `${m.tenant.slug}(${m.role})`).join(', ') || '(none)',
          })),
          [
            { key: 'id', header: 'ID', width: 36 },
            { key: 'email', header: 'EMAIL' },
            { key: 'username', header: 'USERNAME' },
            { key: 'enabled', header: 'ENABLED', width: 7 },
            { key: 'tenants', header: 'TENANTS' },
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
    .command('list-tenants')
    .description('List all tenant memberships for a user')
    .argument('<identifier>', 'User email or UUID')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { format: string }) => {
      const u = await resolveUser(identifier);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }

      const memberships = await tenantService.listUserTenants(u.id);

      if (opts.format === 'json') {
        printJson(memberships);
      } else {
        if (memberships.length === 0) {
          console.log('No tenant memberships found.');
          return;
        }
        printTable(
          memberships.map((m) => ({
            tenantId: m.tenantId,
            name: m.name,
            slug: m.slug,
            role: m.role,
            active: m.isActive ? 'yes' : 'no',
            joined: m.joinedAt.toISOString().slice(0, 10),
          })),
          [
            { key: 'tenantId', header: 'TENANT ID', width: 36 },
            { key: 'name', header: 'NAME' },
            { key: 'slug', header: 'SLUG' },
            { key: 'role', header: 'ROLE', width: 8 },
            { key: 'active', header: 'ACTIVE', width: 6 },
            { key: 'joined', header: 'JOINED', width: 10 },
          ],
        );
        console.log(`\nTotal: ${memberships.length}`);
      }
    });

  user
    .command('set-role')
    .description('Change a user\'s role in a tenant')
    .argument('<identifier>', 'User email or UUID')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .requiredOption('--role <role>', 'New role (OWNER|ADMIN|MEMBER)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { tenantId: string; role: string; format: string }) => {
      const [u, tenant] = await Promise.all([resolveUser(identifier), resolveTenant(opts.tenantId)]);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      const validRoles = ['OWNER', 'ADMIN', 'MEMBER'];
      if (!validRoles.includes(opts.role)) {
        printError(`Invalid role: ${opts.role}. Must be one of: ${validRoles.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      try {
        const result = await tenantService.updateUserRole(
          tenant.id, u.id, opts.role as 'OWNER' | 'ADMIN' | 'MEMBER', 'cli-admin',
        );

        auditService.log({
          userId: null,
          action: AuditAction.TENANT_UPDATE_USER_ROLE,
          targetType: 'USER',
          targetId: u.id,
          ipAddress: 'cli',
          details: { tenantId: tenant.id, newRole: opts.role, source: 'cli' },
        });

        if (opts.format === 'json') {
          printJson(result);
        } else {
          printSuccess(`Updated role for ${result.email} to ${result.role} in ${tenant.name}`);
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  user
    .command('set-email')
    .description('Change a user\'s email (bypasses verification)')
    .argument('<identifier>', 'User email or UUID')
    .requiredOption('--new-email <email>', 'New email address')
    .option('--confirm', 'Confirm operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { newEmail: string; confirm?: boolean; format: string }) => {
      const u = await resolveUser(identifier);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }

      const existing = await prisma.user.findUnique({ where: { email: opts.newEmail } });
      if (existing && existing.id !== u.id) {
        printError(`Email already in use by another user: ${opts.newEmail}`);
        process.exitCode = 1;
        return;
      }

      if (!requireConfirm(opts.confirm, `This will change the email for user ${u.email} (${u.id}) to ${opts.newEmail}.\nEmail will be marked as verified.`)) {
        return;
      }

      const oldEmail = u.email;
      const updated = await prisma.user.update({
        where: { id: u.id },
        data: { email: opts.newEmail, emailVerified: true },
        select: { id: true, email: true, username: true },
      });

      auditService.log({
        userId: null,
        action: AuditAction.ADMIN_EMAIL_CHANGE,
        targetType: 'USER',
        targetId: u.id,
        ipAddress: 'cli',
        details: { oldEmail, newEmail: opts.newEmail, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson(updated);
      } else {
        printSuccess(`Email changed: ${oldEmail} → ${updated.email}`);
      }
    });

  user
    .command('move-tenant')
    .description('Move a user from one tenant to another')
    .argument('<identifier>', 'User email or UUID')
    .requiredOption('--from <id>', 'Source tenant ID or slug')
    .requiredOption('--to <id>', 'Target tenant ID or slug')
    .option('--role <role>', 'Role in target tenant (ADMIN|MEMBER)', 'MEMBER')
    .option('--confirm', 'Confirm destructive operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { from: string; to: string; role: string; confirm?: boolean; format: string }) => {
      const [u, fromTenant, toTenant] = await Promise.all([
        resolveUser(identifier),
        resolveTenant(opts.from),
        resolveTenant(opts.to),
      ]);
      if (!u) { printError(`User not found: ${identifier}`); process.exitCode = 1; return; }
      if (!fromTenant) { printError(`Source tenant not found: ${opts.from}`); process.exitCode = 1; return; }
      if (!toTenant) { printError(`Target tenant not found: ${opts.to}`); process.exitCode = 1; return; }

      const validRoles = ['ADMIN', 'MEMBER'];
      if (!validRoles.includes(opts.role)) {
        printError(`Invalid role: ${opts.role}. Must be one of: ${validRoles.join(', ')}`);
        process.exitCode = 1;
        return;
      }

      // Verify membership in source
      const sourceMembership = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: fromTenant.id, userId: u.id } },
      });
      if (!sourceMembership) {
        printError(`User ${u.email} is not a member of tenant "${fromTenant.name}"`);
        process.exitCode = 1;
        return;
      }

      // Verify no existing membership in target
      const targetMembership = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId: toTenant.id, userId: u.id } },
      });
      if (targetMembership) {
        printError(`User ${u.email} is already a member of tenant "${toTenant.name}"`);
        process.exitCode = 1;
        return;
      }

      if (!requireConfirm(opts.confirm, `This will move user ${u.email} from "${fromTenant.name}" to "${toTenant.name}" with role ${opts.role}.\nPrivate connections in the source tenant will remain as orphans.`)) {
        return;
      }

      await prisma.$transaction(async (tx) => {
        // Remove from teams in source tenant
        const sourceTeams = await tx.team.findMany({
          where: { tenantId: fromTenant.id },
          select: { id: true },
        });
        if (sourceTeams.length > 0) {
          await tx.teamMember.deleteMany({
            where: {
              userId: u.id,
              teamId: { in: sourceTeams.map((t) => t.id) },
            },
          });
        }

        // Remove from source tenant
        await tx.tenantMember.delete({
          where: { tenantId_userId: { tenantId: fromTenant.id, userId: u.id } },
        });

        // Add to target tenant
        await tx.tenantMember.create({
          data: {
            tenantId: toTenant.id,
            userId: u.id,
            role: opts.role as 'ADMIN' | 'MEMBER',
          },
        });
      });

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_REMOVE_USER,
        targetType: 'USER',
        targetId: u.id,
        ipAddress: 'cli',
        details: { tenantId: fromTenant.id, tenantName: fromTenant.name, moveTenant: true, source: 'cli' },
      });

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_INVITE_USER,
        targetType: 'USER',
        targetId: u.id,
        ipAddress: 'cli',
        details: { tenantId: toTenant.id, tenantName: toTenant.name, role: opts.role, moveTenant: true, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson({ moved: true, user: u.email, from: fromTenant.name, to: toTenant.name, role: opts.role });
      } else {
        printSuccess(`Moved ${u.email} from "${fromTenant.name}" to "${toTenant.name}" as ${opts.role}`);
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
