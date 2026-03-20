#!/usr/bin/env node
 

// Load environment before anything else
import './lib/env';

if (process.env.CLI_ENABLED !== 'true') {
  console.error(
    'Arsenale CLI is disabled. Set CLI_ENABLED=true in your .env file.',
  );
  process.exit(1);
}

import { Command } from 'commander';
import { registerCommands } from './cli/index';
import prisma from './lib/prisma';

const program = new Command()
  .name('arsenale')
  .description('Arsenale server administration CLI')
  .version('1.7.0');

registerCommands(program);

program
  .parseAsync(process.argv)
  .catch((err: Error) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
