/**
 * Quieter console for full-screen chat UIs (`xopc agent -m` / `-i`, `xopc tui`): use `warn`
 * when no log level env is set, so `info` chatter stays off the terminal.
 * This module must load before `../utils/logger.js` (imported from `cli/index.ts`).
 */
function argvHasAgentMessageOrInteractive(argv: string[]): boolean {
  const agentIndex = argv.findIndex((a) => a === 'agent');
  if (agentIndex < 0) return false;
  for (let i = agentIndex + 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-i' || a === '--interactive') return true;
    if (a === '-m' || a === '--message') return true;
  }
  return false;
}

function argvHasTuiCommand(argv: string[]): boolean {
  return argv.includes('tui');
}

const env = process.env;
if (
  !env.VITEST &&
  !env.TEST &&
  !env.XOPC_LOG_LEVEL &&
  !env.LOG_LEVEL &&
  !env.DEBUG &&
  !process.argv.includes('--verbose') &&
  !process.argv.includes('-v') &&
  (argvHasAgentMessageOrInteractive(process.argv) || argvHasTuiCommand(process.argv))
) {
  env.XOPC_LOG_LEVEL = 'warn';
}
