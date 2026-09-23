import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStateDir } from '../../config/paths-state.js';
import { writeTextAtomicSync } from '../../infra/write-file-atomic.js';
import { createLogger } from '../../utils/logger.js';
import { pluginName } from './validation.js';

const log = createLogger('PluginMcpHealth');
export type PluginMcpHealth = 'ready' | 'authorization_required' | 'error' | 'not_tested';
function pathFor(id: string, name: string, stateDir: string) {
  return join(stateDir, 'plugin-health', pluginName.parse(id), `${createHash('sha256').update(name).digest('hex')}.json`);
}
export function readPluginMcpHealth(id: string, name: string, revision: string, stateDir = resolveStateDir()): PluginMcpHealth {
  try {
    const value = JSON.parse(readFileSync(pathFor(id, name, stateDir), 'utf8'));
    return value.revision === revision && ['ready', 'authorization_required', 'error'].includes(value.status) ? value.status : 'not_tested';
  } catch { return 'not_tested'; }
}
export function clearPluginMcpHealth(id: string, name: string, stateDir = resolveStateDir()): void {
  rmSync(pathFor(id, name, stateDir), { force: true });
}
export function recordPluginMcpHealth(raw: unknown, status: Exclude<PluginMcpHealth, 'not_tested'>): void {
  const plugin = (raw as { xopcPlugin?: { id: string; serverName: string; revision: string } })?.xopcPlugin;
  if (!plugin) return;
  try { writeTextAtomicSync(pathFor(plugin.id, plugin.serverName, resolveStateDir()), JSON.stringify({ revision: plugin.revision, status })); }
  catch (error) { log.warn({ err: error, pluginId: plugin.id }, 'Could not persist MCP connection status'); }
}
