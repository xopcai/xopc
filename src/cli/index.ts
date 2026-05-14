#!/usr/bin/env node
/** Command wiring and `program.parse`; executable entry is `bin.ts` (log preset before logger init). */
import { Command } from 'commander';
import { registry, createDefaultContext, type CLIContext } from './registry.js';
import pkg from '../../package.json' with { type: 'json' };
import { flushAndClose } from '../utils/logger.js'; // Import flushAndClose for graceful shutdown
import { registerExtensionCliCommands } from './extension-cli-register.js';

// Import order determines display order in help
import './commands/setup.js';
import './commands/onboard.js';
import './commands/agent.js';
import './commands/tui.js';
import './commands/gateway.js';
import './commands/session.js';
import './commands/cron.js';
import './commands/config.js';
import './commands/doctor/index.js';
import './commands/image.js';
import './commands/channels.js';
import './commands/models.js';
import { registerExtensionCommands } from './commands/extension.js';
import './commands/auth.js';
import './commands/skills.js';
import './commands/browser.js';
import './commands/update.js';
import './commands/logs.js';
import { registerAgentsCli } from './commands/agents.js';

// Global parsed options - updated before each command
export let parsedOpts: { config?: string; workspace?: string; verbose?: boolean } = {};

export function getContextWithOpts(argv: string[] = process.argv): CLIContext {
  return createDefaultContext(argv, parsedOpts);
}

// Long-running commands that should not auto-exit
const LONG_RUNNING_COMMANDS = new Set(['gateway', 'agent', 'tui', 'extension:dev']);

const program = new Command()
  .name('xopc')
  .description('Ultra-Lightweight Personal AI Assistant')
  .version(pkg.version)
  .option('--verbose', 'Enable verbose logging', false)
  .option('--config <path>', 'Config file path')
  .option('--workspace <path>', 'Workspace directory');

// Hook to capture parsed options before each command runs
program.hook('preAction', (thisCommand) => {
  parsedOpts = thisCommand.opts();
});

// Hook to ensure process exits after command completion
// Second arg is the command whose action ran; the first is the ancestor that registered the hook
// (often the root program), so using only the first arg mis-detects the subcommand as "xopc".
program.hook('postAction', async (_hookOwner, actionCommand) => {
  const cmd = actionCommand ?? program;
  const args = cmd.args;
  const subCommandName = args.length > 0 ? args[0] : cmd.name();

  // Skip long-running commands (gateway foreground, agent interactive mode)
  if (LONG_RUNNING_COMMANDS.has(subCommandName)) {
    // For agent command, only skip exit if interactive mode (-i) is used
    if (subCommandName === 'agent') {
      const hasInteractiveFlag = process.argv.includes('-i') || process.argv.includes('--interactive');
      if (!hasInteractiveFlag) {
        // Agent in non-interactive mode should exit normally
        await flushAndClose();
        process.exit(0);
      }
    }
    // Gateway or agent -i: don't exit
    return;
  }
  // For all other commands, flush logs and exit
  await flushAndClose();
  process.exit(0);
});

// Create initial context (will use env vars and defaults)
const ctx = getContextWithOpts(process.argv);
registry.install(program, ctx);
registerAgentsCli(program);
registerExtensionCommands(program);

// Only parse if this is the main module being executed directly
// Skip parsing when imported as module (e.g., in tests)
const isTestEnv = !!process.env.VITEST || !!process.env.TEST || !!process.env.NODE_ENV?.includes('test');
const isMainModule = !isTestEnv && import.meta.url.startsWith('file:');

if (isMainModule) {
  // Filter out standalone '--' separator (passed by pnpm run -- <cmd>)
  // npm removes it automatically, pnpm passes it through
  const argv = process.argv.filter((arg, index) => {
    if (arg !== '--') return true;
    // Only filter '--' if it's the separator between script and command
    // (i.e., comes after the script name and before actual args)
    return index < 2; // Keep '--' if it's a script argument (index 0 or 1)
  });
  void registerExtensionCliCommands(program).then(() => {
    program.parse(argv);
  });
}
