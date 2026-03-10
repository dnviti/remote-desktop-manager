 
import { Command } from 'commander';
import * as sessionService from '../../services/session.service';
import * as auditService from '../../services/audit.service';
import { AuditAction } from '../../generated/prisma/client';
import { resolveTenant } from '../helpers/resolve';
import { requireConfirm } from '../helpers/confirm';
import { printJson, printTable, printError, printSuccess, printSummary } from '../helpers/output';

export function registerSessionCommands(program: Command): void {
  const session = program
    .command('session')
    .description('Active session management commands');

  session
    .command('list')
    .description('List active sessions')
    .option('--tenant-id <id>', 'Filter by tenant ID or slug')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--protocol <type>', 'Filter by protocol (SSH|RDP|VNC)')
    .option('--status <status>', 'Filter by status (ACTIVE|IDLE)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { tenantId?: string; userId?: string; protocol?: string; status?: string; format: string }) => {
      let tenantId: string | undefined;
      if (opts.tenantId) {
        const tenant = await resolveTenant(opts.tenantId);
        if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }
        tenantId = tenant.id;
      }

      const sessions = await sessionService.getActiveSessions({
        tenantId,
        userId: opts.userId,
        protocol: opts.protocol as 'SSH' | 'RDP' | 'VNC' | undefined,
        status: opts.status as 'ACTIVE' | 'IDLE' | undefined,
      });

      if (opts.format === 'json') {
        printJson(sessions);
      } else {
        printTable(
          sessions.map((s) => ({
            id: s.id,
            protocol: s.protocol,
            status: s.status,
            user: s.email ?? s.userId,
            connection: s.connectionName ?? s.connectionId,
            gateway: s.gatewayName ?? '',
            started: s.startedAt.toISOString().slice(0, 19),
          })),
          [
            { key: 'id', header: 'ID', width: 36 },
            { key: 'protocol', header: 'PROTO', width: 5 },
            { key: 'status', header: 'STATUS', width: 6 },
            { key: 'user', header: 'USER' },
            { key: 'connection', header: 'CONNECTION' },
            { key: 'gateway', header: 'GATEWAY' },
            { key: 'started', header: 'STARTED', width: 19 },
          ],
        );
        console.log(`\nTotal: ${sessions.length}`);
      }
    });

  session
    .command('count')
    .description('Count active sessions')
    .option('--tenant-id <id>', 'Filter by tenant ID or slug')
    .option('--protocol <type>', 'Filter by protocol (SSH|RDP|VNC)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { tenantId?: string; protocol?: string; format: string }) => {
      let tenantId: string | undefined;
      if (opts.tenantId) {
        const tenant = await resolveTenant(opts.tenantId);
        if (!tenant) { printError(`Tenant not found: ${opts.tenantId}`); process.exitCode = 1; return; }
        tenantId = tenant.id;
      }

      const count = await sessionService.getActiveSessionCount({
        tenantId,
        protocol: opts.protocol as 'SSH' | 'RDP' | 'VNC' | undefined,
      });

      if (opts.format === 'json') {
        printJson({ count });
      } else {
        printSummary('Active sessions', count);
      }
    });

  session
    .command('terminate')
    .description('Terminate an active session')
    .argument('<session-id>', 'Session UUID')
    .option('--confirm', 'Confirm operation')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (sessionId: string, opts: { confirm?: boolean; format: string }) => {
      if (!requireConfirm(opts.confirm, `This will terminate session ${sessionId}.`)) {
        return;
      }

      await sessionService.endSession(sessionId, 'ADMIN_TERMINATED');

      auditService.log({
        userId: null,
        action: AuditAction.SESSION_END,
        targetType: 'SESSION',
        targetId: sessionId,
        ipAddress: 'cli',
        details: { reason: 'ADMIN_TERMINATED', source: 'cli' },
      });

      if (opts.format === 'json') {
        printJson({ terminated: true, sessionId });
      } else {
        printSuccess(`Session terminated: ${sessionId}`);
      }
    });
}
