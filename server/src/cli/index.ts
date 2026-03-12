import { Command } from 'commander';
import { registerHealthCommands } from './commands/health.commands';
import { registerDbCommands } from './commands/db.commands';
import { registerUserCommands } from './commands/user.commands';
import { registerTenantCommands } from './commands/tenant.commands';
import { registerAuditCommands } from './commands/audit.commands';
import { registerGatewayCommands } from './commands/gateway.commands';
import { registerSessionCommands } from './commands/session.commands';
import { registerConfigCommands } from './commands/config.commands';
import { registerDemoCommands } from './commands/demo.commands';
import { registerSecretCommands } from './commands/secret.commands';
import { registerConnectionCommands } from './commands/connection.commands';
import { registerStatsCommands } from './commands/stats.commands';

export function registerCommands(program: Command): void {
  registerHealthCommands(program);
  registerDbCommands(program);
  registerUserCommands(program);
  registerTenantCommands(program);
  registerAuditCommands(program);
  registerGatewayCommands(program);
  registerSessionCommands(program);
  registerConfigCommands(program);
  registerDemoCommands(program);
  registerSecretCommands(program);
  registerConnectionCommands(program);
  registerStatsCommands(program);
}
