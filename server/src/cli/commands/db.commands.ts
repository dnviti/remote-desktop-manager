 
import { Command } from 'commander';
import { execSync } from 'child_process';
import { checkDatabase } from '../../services/health.service';
import { printJson } from '../helpers/output';

export function registerDbCommands(program: Command): void {
  const db = program
    .command('db')
    .description('Database management commands');

  db.command('status')
    .description('Check database connectivity')
    .option('--format <format>', 'Output format (json|table)', 'table')
    .action(async (opts: { format: string }) => {
      const result = await checkDatabase();
      if (opts.format === 'json') {
        printJson(result);
      } else {
        const status = result.ok ? 'OK' : 'FAIL';
        console.log(`Database: ${status}  (${result.latencyMs}ms)`);
        if (result.error) console.log(`Error: ${result.error}`);
      }
      if (!result.ok) process.exitCode = 1;
    });

  db.command('migrate')
    .description('Run pending database migrations (prisma migrate deploy)')
    .action(() => {
      console.log('Running database migrations...');
      try {
        execSync('npx prisma migrate deploy', {
          stdio: 'inherit',
          cwd: process.cwd(),
        });
        console.log('Migrations completed.');
      } catch {
        console.error('Migration failed.');
        process.exitCode = 1;
      }
    });
}
