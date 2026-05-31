#!/usr/bin/env node
/** Command wiring and `program.parse`; executable entry is `bin.ts` (log preset before logger init). */
import { Command } from 'commander';
import { ROOT_COMMAND_DESCRIPTION } from './command-manifest.js';
import pkg from '../../package.json' with { type: 'json' };
import { resolveCommandName, tryLoadCommand, loadAllCommands } from './command-loaders.js';

// Lazy logger flush so that pure parameter-parsing paths (--help, --version,
// `<unknown>`) never load the logger barrel. Imports `logger/shutdown.js`
// directly to bypass `logger/index.ts` (pino + 8 sub-modules) on the cold path
// — when an action did log, that import is already cached.
async function flushLoggerAndExit(code: number): Promise<never> {
  const { flushAndClose } = await import('../utils/logger/shutdown.js');
  await flushAndClose();
  process.exit(code);
}

// Re-exported from `./context.js` for backward compat. Command modules should
// import from `./context.js` directly to avoid the CLI barrel cycle.
export { parsedOpts, getContextWithOpts } from './context.js';
import { parsedOpts, getContextWithOpts } from './context.js';

// Commands whose action never resolves until an external shutdown signal.
// `tui` is intentionally omitted: `await runTui()` completes when the user exits
// the TUI and the process must call `process.exit` (interactive stdin stays open).
const LONG_RUNNING_COMMANDS = new Set(['gateway', 'agent']);

function isExtensionsDevCommand(command: Command): boolean {
  return command.name() === 'dev' && command.parent?.name() === 'extensions';
}

function buildProgram(): Command {
  const program = new Command()
    .name('xopc')
    .description(ROOT_COMMAND_DESCRIPTION)
    .version(pkg.version)
    .option('--verbose', 'Enable verbose logging', false)
    .option('--config <path>', 'Config file path')
    .option('--workspace <path>', 'Workspace directory');

  // Hook to capture parsed options before each command runs. Mutate the
  // shared object in place — `parsedOpts` is a `const` import from
  // `./context.js` so command modules see updates through the same reference.
  program.hook('preAction', (thisCommand) => {
    const next = thisCommand.opts() as Record<string, unknown>;
    for (const k of Object.keys(parsedOpts)) {
      delete (parsedOpts as Record<string, unknown>)[k];
    }
    Object.assign(parsedOpts, next);
  });

  // Hook to ensure process exits after command completion.
  // Second arg is the command whose action ran; the first is the ancestor that
  // registered the hook (often the root program), so using only the first arg
  // mis-detects the subcommand as "xopc".
  program.hook('postAction', async (_hookOwner, actionCommand) => {
    const cmd = actionCommand ?? program;
    const args = cmd.args;
    const subCommandName = args.length > 0 ? args[0] : cmd.name();

    if (LONG_RUNNING_COMMANDS.has(subCommandName) || isExtensionsDevCommand(cmd)) {
      if (subCommandName === 'agent') {
        const hasInteractiveFlag = process.argv.includes('-i') || process.argv.includes('--interactive');
        if (!hasInteractiveFlag) {
          await flushLoggerAndExit(0);
        }
      }
      return;
    }
    await flushLoggerAndExit(0);
  });

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  const ctx = getContextWithOpts(argv);

  // Filter out standalone '--' separator (passed by pnpm run -- <cmd>).
  // npm removes it automatically, pnpm passes it through. Keep '--' if it's a
  // script argument (index < 2), drop it only when it sits between the script
  // name and the actual command.
  const filteredArgv = argv.filter((arg, index) => {
    if (arg !== '--') return true;
    return index < 2;
  });

  const target = resolveCommandName(filteredArgv);
  let loaded = false;
  if (target) {
    loaded = await tryLoadCommand(program, ctx, target, getContextWithOpts);
  }
  if (!loaded) {
    // Unknown command, no command, or commander needs the full set (e.g. for
    // root help fallback). Load every command so commander can dispatch
    // properly.
    await loadAllCommands(program, ctx, getContextWithOpts);
  }

  program.parse(filteredArgv);
}
