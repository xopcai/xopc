/**
 * Default the CLI console to `warn` when no log level is set, so routine `info`
 * output (extensions, diagnostics, etc.) does not clutter the terminal.
 * Opt in with `XOPC_LOG_LEVEL` or `--verbose` / `-v`.
 * This module must load before any import of `../utils/logger.js`.
 */
const env = process.env;
// MCP reserves stdout for JSON-RPC, including when verbose logging is requested.
const cliArgs = process.argv.slice(2);
let commandIndex = 0;
while (cliArgs[commandIndex]?.startsWith('-')) {
  commandIndex += ['--config', '--workspace'].includes(cliArgs[commandIndex]!) ? 2 : 1;
}
if (cliArgs[commandIndex] === 'mcp' && cliArgs[commandIndex + 1] === 'capabilities') {
  env.XOPC_LOG_CONSOLE = 'false';
}
if (
  !env.VITEST &&
  !env.TEST &&
  !env.XOPC_LOG_LEVEL &&
  !process.argv.includes('--verbose') &&
  !process.argv.includes('-v')
) {
  env.XOPC_LOG_LEVEL = 'warn';
}
