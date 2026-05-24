/**
 * Minimal TUI demo for the hello extension (Phase 4).
 * Registers a footer widget and `/hello-tui` slash command when `xopc tui --local` starts.
 */
import type { ExtensionApi } from 'xopc/extension-sdk';

export function registerHelloTui(api: ExtensionApi): void {
  api.registerTui((host) => {
    host.setFooterWidget('greeting', ['Hello extension · TUI host active']);
    host.registerSlashCommand('hello-tui', 'Say hello from the TUI extension host', async (args) => {
      const name = args.trim() || 'World';
      const greeting = (api.extensionConfig.greeting as string) || 'Hello';
      host.notify(`${greeting}, ${name}! (from TUI host)`);
    });
  });
}
