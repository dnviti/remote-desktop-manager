 
import { Command } from 'commander';
import prisma from '../../lib/prisma';
import * as tenantService from '../../services/tenant.service';
import * as auditService from '../../services/audit.service';
import * as secretService from '../../services/secret.service';
import { AuditAction } from '../../generated/prisma/client';
import { resolveUser, resolveTenant } from '../helpers/resolve';
import { requireConfirm } from '../helpers/confirm';
import { unlockUserVault } from '../helpers/vault';
import { printJson, printTable, printError, printSuccess } from '../helpers/output';

export function registerTenantCommands(program: Command): void {
  const tenant = program
    .command('tenant')
    .description('Tenant (organization) management commands');

  tenant
    .command('list')
    .description('List all tenants')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .option('--limit <n>', 'Max results', '100')
    .action(async (opts: { format: string; limit: string }) => {
      const tenants = await prisma.tenant.findMany({
        take: parseInt(opts.limit, 10),
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { members: true, teams: true } } },
      });

      if (opts.format === 'json') {
        printJson(tenants.map((t) => ({
          id: t.id,
          name: t.name,
          slug: t.slug,
          members: t._count.members,
          teams: t._count.teams,
          createdAt: t.createdAt.toISOString(),
        })));
      } else {
        printTable(
          tenants.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            members: t._count.members,
            teams: t._count.teams,
            created: t.createdAt.toISOString().slice(0, 10),
          })),
          [
            { key: 'id', header: 'ID', width: 36 },
            { key: 'name', header: 'NAME' },
            { key: 'slug', header: 'SLUG' },
            { key: 'members', header: 'MEMBERS', width: 7 },
            { key: 'teams', header: 'TEAMS', width: 5 },
            { key: 'created', header: 'CREATED', width: 10 },
          ],
        );
        console.log(`\nTotal: ${tenants.length}`);
      }
    });

  tenant
    .command('get')
    .description('Get tenant details by ID or slug')
    .argument('<identifier>', 'Tenant UUID or slug')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const details = await tenantService.getTenant(t.id);

      if (opts.format === 'json') {
        printJson(details);
      } else {
        console.log(`ID:        ${details.id}`);
        console.log(`Name:      ${details.name}`);
        console.log(`Slug:      ${details.slug}`);
        console.log(`Users:     ${details.userCount}`);
        console.log(`Teams:     ${details.teamCount}`);
        console.log(`MFA req:   ${details.mfaRequired ? 'yes' : 'no'}`);
        console.log(`Created:   ${details.createdAt}`);
      }
    });

  tenant
    .command('create')
    .description('Create a new tenant')
    .requiredOption('--name <name>', 'Tenant name')
    .requiredOption('--owner-email <email>', 'Owner user email (must exist)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { name: string; ownerEmail: string; format: string }) => {
      const owner = await resolveUser(opts.ownerEmail);
      if (!owner) { printError(`Owner not found: ${opts.ownerEmail}`); process.exitCode = 1; return; }

      const result = await tenantService.createTenant(owner.id, opts.name);

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_CREATE,
        targetType: 'TENANT',
        targetId: result.id,
        ipAddress: 'cli',
        details: { name: opts.name, owner: opts.ownerEmail, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson(result);
      } else {
        printSuccess(`Tenant created: ${result.name} (${result.id})`);
        console.log(`Slug: ${result.slug}`);
      }
    });

  tenant
    .command('delete')
    .description('Delete a tenant and all its data')
    .argument('<identifier>', 'Tenant UUID or slug')
    .option('--confirm', 'Confirm destructive operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { confirm?: boolean; format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const [members, teams] = await Promise.all([
        prisma.tenantMember.count({ where: { tenantId: t.id } }),
        prisma.team.count({ where: { tenantId: t.id } }),
      ]);

      if (!requireConfirm(opts.confirm, `This will permanently delete tenant "${t.name}" (${t.id}).\n  Members: ${members}\n  Teams: ${teams}`)) {
        return;
      }

      await tenantService.deleteTenant(t.id);

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_DELETE,
        targetType: 'TENANT',
        targetId: t.id,
        ipAddress: 'cli',
        details: { name: t.name, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson({ deleted: true, id: t.id, name: t.name });
      } else {
        printSuccess(`Tenant deleted: ${t.name} (${t.id})`);
      }
    });

  tenant
    .command('list-members')
    .description('List members of a tenant')
    .argument('<identifier>', 'Tenant UUID or slug')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const users = await tenantService.listTenantUsers(t.id);

      if (opts.format === 'json') {
        printJson(users);
      } else {
        printTable(
          users.map((u) => ({
            id: u.id,
            email: u.email,
            username: u.username ?? '',
            role: u.role,
            enabled: u.enabled ? 'yes' : 'no',
          })),
          [
            { key: 'id', header: 'ID', width: 36 },
            { key: 'email', header: 'EMAIL' },
            { key: 'username', header: 'USERNAME' },
            { key: 'role', header: 'ROLE', width: 8 },
            { key: 'enabled', header: 'ENABLED', width: 7 },
          ],
        );
        console.log(`\nTotal: ${users.length}`);
      }
    });

  tenant
    .command('add-member')
    .description('Add an existing user to a tenant')
    .argument('<identifier>', 'Tenant UUID or slug')
    .requiredOption('--email <email>', 'User email to add')
    .option('--role <role>', 'Role (ADMIN|MEMBER)', 'MEMBER')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { email: string; role: string; format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const result = await tenantService.inviteUser(t.id, opts.email, opts.role as 'ADMIN' | 'MEMBER');

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_INVITE_USER,
        targetType: 'USER',
        targetId: result.userId,
        ipAddress: 'cli',
        details: { email: opts.email, role: opts.role, tenantId: t.id, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson(result);
      } else {
        printSuccess(`Added ${opts.email} to ${t.name} as ${opts.role}`);
      }
    });

  tenant
    .command('remove-member')
    .description('Remove a user from a tenant')
    .argument('<identifier>', 'Tenant UUID or slug')
    .requiredOption('--email <email>', 'User email to remove')
    .option('--confirm', 'Confirm operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { email: string; confirm?: boolean; format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const u = await resolveUser(opts.email);
      if (!u) { printError(`User not found: ${opts.email}`); process.exitCode = 1; return; }

      if (!requireConfirm(opts.confirm, `This will remove ${u.email} from tenant "${t.name}".`)) {
        return;
      }

      await tenantService.removeUser(t.id, u.id, 'cli');

      auditService.log({
        userId: null,
        action: AuditAction.TENANT_REMOVE_USER,
        targetType: 'USER',
        targetId: u.id,
        ipAddress: 'cli',
        details: { email: u.email, tenantId: t.id, source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson({ removed: true, email: u.email, tenant: t.name });
      } else {
        printSuccess(`Removed ${u.email} from ${t.name}`);
      }
    });

  tenant
    .command('update')
    .description('Update tenant configuration')
    .argument('<identifier>', 'Tenant UUID or slug')
    .option('--name <name>', 'New tenant name')
    .option('--mfa-required', 'Require MFA for all members')
    .option('--no-mfa-required', 'Do not require MFA')
    .option('--session-timeout <seconds>', 'Default session timeout in seconds')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { name?: string; mfaRequired?: boolean; sessionTimeout?: string; format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const data: { name?: string; mfaRequired?: boolean; defaultSessionTimeoutSeconds?: number } = {};
      if (opts.name !== undefined) data.name = opts.name;
      if (opts.mfaRequired !== undefined) data.mfaRequired = opts.mfaRequired;
      if (opts.sessionTimeout !== undefined) data.defaultSessionTimeoutSeconds = parseInt(opts.sessionTimeout, 10);

      if (Object.keys(data).length === 0) {
        printError('No updates specified. Use --name, --mfa-required/--no-mfa-required, or --session-timeout.');
        process.exitCode = 1;
        return;
      }

      try {
        const result = await tenantService.updateTenant(t.id, data);

        auditService.log({
          userId: null,
          action: AuditAction.TENANT_UPDATE,
          targetType: 'TENANT',
          targetId: t.id,
          ipAddress: 'cli',
          details: { changes: data, source: 'cli' },
        });

        if (opts.format === 'json') {
          printJson(result);
        } else {
          printSuccess(`Tenant updated: ${result.name} (${result.id})`);
          if (data.name) console.log(`  Name: ${result.name}`);
          if (data.mfaRequired !== undefined) console.log(`  MFA required: ${result.mfaRequired ? 'yes' : 'no'}`);
          if (data.defaultSessionTimeoutSeconds !== undefined) console.log(`  Session timeout: ${result.defaultSessionTimeoutSeconds}s`);
        }
      } catch (err) {
        printError(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  tenant
    .command('init-vault')
    .description('Initialize a tenant vault (org keychain)')
    .argument('<identifier>', 'Tenant UUID or slug')
    .requiredOption('--user-email <email>', 'User email to execute action as (must be member)')
    .requiredOption('--password <password>', 'User password to unlock vault')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (identifier: string, opts: { userEmail: string; password: string; format: string }) => {
      const t = await resolveTenant(identifier);
      if (!t) { printError(`Tenant not found: ${identifier}`); process.exitCode = 1; return; }

      const user = await unlockUserVault(opts.userEmail, opts.password);
      if (!user) { process.exitCode = 1; return; }

      try {
        await secretService.initTenantVault(t.id, user.id);
        
        auditService.log({
          userId: user.id,
          action: AuditAction.TENANT_VAULT_INIT,
          targetType: 'TENANT',
          targetId: t.id,
          ipAddress: 'cli',
          details: { tenantId: t.id, source: 'cli' },
        });

        if (opts.format === 'json') {
          printJson({ success: true, tenantId: t.id, tenantName: t.name });
        } else {
          printSuccess(`Initialized vault for tenant: ${t.name}`);
        }
      } catch (err) {
        printError(`Failed to initialize vault: ${err instanceof Error ? err.message : err}`);
        process.exitCode = 1;
      }
    });
}
