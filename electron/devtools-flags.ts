export function shouldAutoOpenDevTools(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env['XOPC_ELECTRON_DEVTOOLS'] === '1') return true;
  return argv.some((arg) => arg === '--devtools' || arg === '--debug-ui');
}

export function devToolsGlobalShortcutAccelerator(platform: NodeJS.Platform = process.platform): string {
  return platform === 'darwin' ? 'Command+Shift+Alt+I' : 'Control+Shift+Alt+I';
}
