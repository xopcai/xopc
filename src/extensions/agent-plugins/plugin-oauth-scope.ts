import { pluginServerId } from './validation.js';

export function pluginOAuthScope(raw: unknown): string | undefined {
  const plugin = (raw as { xopcPlugin?: { id: string; serverName: string } } | undefined)?.xopcPlugin;
  return plugin ? `owner:${pluginServerId(plugin.id, plugin.serverName)}` : undefined;
}
