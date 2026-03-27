import { type IpcMain } from 'electron';

/**
 * Minimal agent bridge for the Electron shell.
 * Full `AgentService` pulls the gateway/channel/extension graph and does not bundle cleanly
 * into the main process; use the gateway web UI or CLI for full agent runs, or call a
 * localhost gateway from here in a follow-up.
 */
export function registerAgentIpc(ipcMain: IpcMain): void {
  ipcMain.handle('agent:send', async (event, message: string, _sessionKey: string) => {
    const preview = message.length > 400 ? `${message.slice(0, 400)}…` : message;
    event.sender.send(
      'agent:stream-chunk',
      [
        '[Electron] Agent runs are not wired in the desktop shell yet.',
        'Use Chat in this app (gateway) or `pnpm dev -- agent` for the full agent.',
        '',
        `Your message (${message.length} chars): ${preview}`,
      ].join('\n'),
    );
    return { done: true as const };
  });
}
