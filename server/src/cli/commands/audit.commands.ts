 
import { Command } from 'commander';
import * as auditService from '../../services/audit.service';
import { AuditAction } from '../../generated/prisma/client';
import { resolveTenant } from '../helpers/resolve';
import { printJson, printTable, printError } from '../helpers/output';

function toDate(value?: string): Date | undefined {
  return value ? new Date(value) : undefined;
}

export function registerAuditCommands(program: Command): void {
  const audit = program
    .command('audit')
    .description('Audit log commands');

  audit
    .command('list')
    .description('Query audit logs')
    .option('--tenant-id <id>', 'Tenant ID or slug (required for tenant-scoped queries)')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--action <action>', 'Filter by action type')
    .option('--since <date>', 'Start date (ISO 8601)')
    .option('--until <date>', 'End date (ISO 8601)')
    .option('--search <query>', 'Free text search')
    .option('--ip <address>', 'Filter by IP address')
    .option('--limit <n>', 'Max results per page', '50')
    .option('--page <n>', 'Page number', '1')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: {
      tenantId?: string; userId?: string; action?: string;
      since?: string; until?: string; search?: string; ip?: string;
      limit: string; page: string; format: string;
    }) => {
      if (opts.tenantId) {
        const tenant = await resolveTenant(opts.tenantId);
        if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

        const result = await auditService.getTenantAuditLogs({
          tenantId: tenant.id,
          userId: opts.userId,
          action: opts.action as AuditAction | undefined,
          startDate: toDate(opts.since),
          endDate: toDate(opts.until),
          search: opts.search,
          ipAddress: opts.ip,
          limit: parseInt(opts.limit, 10),
          page: parseInt(opts.page, 10),
        });

        if (opts.format === 'json') {
          printJson(result);
        } else {
          printTable(
            result.data.map((l) => ({
              id: l.id,
              action: l.action,
              user: l.userEmail ?? '',
              target: l.targetType ?? '',
              ip: l.ipAddress ?? '',
              time: l.createdAt.toISOString().slice(0, 19),
            })),
            [
              { key: 'id', header: 'ID', width: 36 },
              { key: 'action', header: 'ACTION' },
              { key: 'user', header: 'USER' },
              { key: 'target', header: 'TARGET', width: 12 },
              { key: 'ip', header: 'IP', width: 15 },
              { key: 'time', header: 'TIME', width: 19 },
            ],
          );
          console.log(`\nPage ${result.page}/${result.totalPages} (${result.total} total)`);
        }
      } else if (opts.userId) {
        const result = await auditService.getAuditLogs({
          userId: opts.userId,
          action: opts.action as AuditAction | undefined,
          startDate: toDate(opts.since),
          endDate: toDate(opts.until),
          search: opts.search,
          ipAddress: opts.ip,
          limit: parseInt(opts.limit, 10),
          page: parseInt(opts.page, 10),
        });

        if (opts.format === 'json') {
          printJson(result);
        } else {
          printTable(
            result.data.map((l) => ({
              id: l.id,
              action: l.action,
              target: l.targetType ?? '',
              ip: l.ipAddress ?? '',
              time: l.createdAt.toISOString().slice(0, 19),
            })),
            [
              { key: 'id', header: 'ID', width: 36 },
              { key: 'action', header: 'ACTION' },
              { key: 'target', header: 'TARGET', width: 12 },
              { key: 'ip', header: 'IP', width: 15 },
              { key: 'time', header: 'TIME', width: 19 },
            ],
          );
          console.log(`\nPage ${result.page}/${result.totalPages} (${result.total} total)`);
        }
      } else {
        printError('Either --tenant-id or --user-id is required.');
        process.exitCode = 1;
      }
    });

  audit
    .command('actions')
    .description('List all available audit action types')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action((opts: { format: string }) => {
      const actions = Object.values(AuditAction);
      if (opts.format === 'json') {
        printJson(actions);
      } else {
        for (const a of actions) {
          console.log(a);
        }
        console.log(`\nTotal: ${actions.length} actions`);
      }
    });

  audit
    .command('export')
    .description('Export audit logs as NDJSON (one JSON object per line)')
    .requiredOption('--tenant-id <id>', 'Tenant ID or slug')
    .option('--since <date>', 'Start date (ISO 8601)')
    .option('--until <date>', 'End date (ISO 8601)')
    .option('--limit <n>', 'Max records per page', '500')
    .action(async (opts: { tenantId: string; since?: string; until?: string; limit: string }) => {
      const tenant = await resolveTenant(opts.tenantId);
      if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }

      const pageSize = parseInt(opts.limit, 10);
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const result = await auditService.getTenantAuditLogs({
          tenantId: tenant.id,
          startDate: toDate(opts.since),
          endDate: toDate(opts.until),
          limit: pageSize,
          page,
        });

        for (const entry of result.data) {
          console.log(JSON.stringify(entry));
        }

        hasMore = page < result.totalPages;
        page++;
      }
    });
}
