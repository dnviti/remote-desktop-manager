 
import { Command } from 'commander';
import { checkDatabase, checkGuacd } from '../../services/health.service';
import { printJson } from '../helpers/output';

export function registerHealthCommands(program: Command): void {
  program
    .command('health')
    .description('Check server health (database and guacd connectivity)')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { format: string }) => {
      const [db, guacd] = await Promise.all([checkDatabase(), checkGuacd()]);
      const result = { database: db, guacd };

      if (opts.format === 'json') {
        printJson(result);
      } else {
        const dbStatus = db.ok ? 'OK' : 'FAIL';
        const guacdStatus = guacd.ok ? 'OK' : 'FAIL';
        console.log(`Database:  ${dbStatus}  (${db.latencyMs}ms)${db.error ? `  ${db.error}` : ''}`);
        console.log(`Guacd:     ${guacdStatus}  (${guacd.latencyMs}ms)${guacd.error ? `  ${guacd.error}` : ''}`);
      }

      if (!db.ok || !guacd.ok) process.exitCode = 1;
    });
}
