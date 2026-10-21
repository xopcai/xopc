/** Reuse the host runtime so desktop plugins do not require Node on PATH. */
export function pluginNodeRuntime(command: string): { command: string; env: Record<string, string> } {
  if (command !== 'node' && command !== 'node.exe') return { command, env: {} };
  return {
    command: process.execPath,
    env: process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {},
  };
}
