
import { Command } from 'commander';
import prisma from '../../lib/prisma';
import { printJson, printTable } from '../helpers/output';

export function registerStatsCommands(program: Command): void {
  program
    .command('stats')
    .description('Show global instance statistics')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { format: string }) => {
      const [users, tenants, connections, activeSessions, gateways, recordings] = await Promise.all([
        prisma.user.count(),
        prisma.tenant.count(),
        prisma.connection.count(),
        prisma.activeSession.count({ where: { status: 'ACTIVE' } }),
        prisma.gateway.count(),
        prisma.sessionRecording.aggregate({ _sum: { fileSize: true } }),
      ]);

      const recordingBytes = recordings._sum.fileSize ?? 0;
      const recordingMB = (recordingBytes / (1024 * 1024)).toFixed(2);

      const stats = {
        users,
        tenants,
        connections,
        activeSessions,
        gateways,
        recordingDiskUsageMB: parseFloat(recordingMB),
      };

      if (opts.format === 'json') {
        printJson(stats);
      } else {
        printTable(
          [
            { metric: 'Total users', value: String(users) },
            { metric: 'Total tenants', value: String(tenants) },
            { metric: 'Total connections', value: String(connections) },
            { metric: 'Active sessions', value: String(activeSessions) },
            { metric: 'Total gateways', value: String(gateways) },
            { metric: 'Recording disk usage', value: `${recordingMB} MB` },
          ],
          [
            { key: 'metric', header: 'METRIC', width: 25 },
            { key: 'value', header: 'VALUE', width: 15 },
          ],
        );
      }
    });
}
