import { parsePluginAuthorizationCheck, pluginAuthorizations } from './setup-contract.js';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import { CredentialResolver } from '../../auth/credentials.js';
import { spawnProcess } from '../../process/run-process.js';
import { containedPath, expandPluginVariables, resolvePluginCwd, validatePluginServer } from './validation.js';
import { expandUserConfig, readPluginUserConfig } from './user-config.js';
import { safeAuthorizationUrl, type PluginAuthorization, type SetupCommand } from './setup-contract.js';
import type { AgentPluginStore, InstalledAgentPlugin } from './store.js';

type CliMethod = Extract<PluginAuthorization['methods'][number], { type: 'cli' }>;
export type PluginCliAuthorization = {
  id: string; state: 'preparing' | 'awaiting_user' | 'connected' | 'error' | 'cancelled';
  expiresAt: number; challenge?: { type: 'url' | 'qr'; url: string; message?: string }; error?: string;
};
type Attempt = { owner: string; pluginId: string; revision: string; authorization: string; view: PluginCliAuthorization; controller: AbortController };
const attempts = new Map<string, Attempt>();
async function execute(store: AgentPluginStore, plugin: InstalledAgentPlugin, authorization: string, command: SetupCommand, signal: AbortSignal, timeoutMs: number, onLine?: (line: string) => void) {
  validatePluginServer({ type: 'stdio', ...command }, plugin.rootDir, store.dataDir(plugin.id));
  const data = store.dataDir(plugin.id), home = join(data, 'accounts', plugin.receipt.revision, authorization);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const values = { ...Object.fromEntries(Object.entries(plugin.layout?.userConfig ?? {}).filter(([, field]) => field.default !== undefined).map(([key, field]) => [key, field.default])), ...readPluginUserConfig(store, plugin.id, plugin.receipt.revision) };
  const expand = (value: string) => expandUserConfig(expandPluginVariables(value.replace(/\$\{PLUGIN_RESOURCES\}/g, join(data, 'resources', plugin.receipt.revision)), plugin.rootDir, data), values);
  const environment: NodeJS.ProcessEnv = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG'].flatMap(key => process.env[key] === undefined ? [] : [[key, process.env[key]!]]));
  Object.assign(environment, { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, 'config'), PLUGIN_HOST_HOME: homedir(), PLUGIN_ACCOUNT_HOME: home, PLUGIN_ROOT: plugin.rootDir, PLUGIN_DATA: data, PLUGIN_RESOURCES: join(data, 'resources', plugin.receipt.revision) });
  const resolver = new CredentialResolver({ stateDir: store.stateDir });
  for (const [key, value] of Object.entries(command.env)) {
    const expanded = expand(value);
    if (typeof expanded === 'string') environment[key] = expanded;
    else {
      const reference = expanded as { xopcSecretRef?: { provider: string; prefix: string } };
      if (!reference.xopcSecretRef) throw new Error('Invalid login credential reference');
      const secret = await resolver.resolveApiKey(reference.xopcSecretRef.provider);
      if (!secret) throw new Error('Login credential is unavailable');
      environment[key] = reference.xopcSecretRef.prefix + secret;
    }
  }
  const program = command.command.startsWith('./') ? containedPath(plugin.rootDir, resolve(plugin.rootDir, command.command)) : command.command.startsWith('${PLUGIN_RESOURCES}/') ? containedPath(data, join(data, 'resources', plugin.receipt.revision, command.command.slice('${PLUGIN_RESOURCES}/'.length))) : command.command;
  let pending = '';
  const handle = spawnProcess({ program, args: command.args.map(arg => { const value = expand(arg); if (typeof value !== 'string') throw new Error('Use environment variables for login secrets'); return value; }),
    cwd: resolvePluginCwd(command.cwd, plugin.rootDir, data), env: environment, signal, timeoutMs, maxOutputBytes: 65536, terminationPolicy: 'tree', shell: false,
    onOutput(stream, chunk) {
      if (stream !== 'stdout' || !onLine) return;
      pending = (pending + chunk.toString('utf8')).slice(-65536);
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) { const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1); onLine(line); }
    },
  });
  const result = await handle.completion;
  if (result.exitCode !== 0 || result.timedOut || result.aborted || result.outputTruncated) throw new Error('CLI login or account check failed. Retry authorization.');
  return result.stdout;
}
export async function inspectPluginCliAuthorization(store: AgentPluginStore, plugin: InstalledAgentPlugin, authorization: string, method: CliMethod, signal: AbortSignal) {
  try {
    const output = await execute(store, plugin, authorization, method.check, signal, 15000);
    return parsePluginAuthorizationCheck(output, pluginAuthorizations(plugin.manifest).find(value => value.id === authorization)?.methods.map(value => value.id) ?? []);
  } catch { signal.throwIfAborted(); return { authenticated: false, issues: [] }; }
}
export async function checkPluginCliAuthorization(store: AgentPluginStore, plugin: InstalledAgentPlugin, authorization: string, method: CliMethod, signal: AbortSignal): Promise<boolean> {
  return (await inspectPluginCliAuthorization(store, plugin, authorization, method, signal)).authenticated;
}
export function startPluginCliAuthorization(store: AgentPluginStore, plugin: InstalledAgentPlugin, authorization: string, method: CliMethod, owner: string): PluginCliAuthorization {
  for (const [key, attempt] of attempts) {
    if (attempt.view.expiresAt < Date.now()) { attempt.controller.abort(); attempts.delete(key); }
    else if (attempt.pluginId === plugin.id && attempt.authorization === authorization) {
      if (attempt.owner !== owner) throw new Error('Authorization belongs to another principal');
      attempt.controller.abort(); attempt.view.state = 'cancelled';
    }
  }
  const controller = new AbortController();
  const view: PluginCliAuthorization = { id: randomUUID(), state: 'preparing', expiresAt: Date.now() + method.timeoutSeconds * 1000 };
  const attempt: Attempt = { owner, pluginId: plugin.id, revision: plugin.receipt.revision, authorization, view, controller };
  attempts.set(view.id, attempt);
  const watcher = setInterval(() => {
    try {
      const current = store.pendingReceipt(plugin.id) ?? store.receipt(plugin.id);
      const job = JSON.parse(readFileSync(join(store.stateDir, 'plugin-setup', `${plugin.id}.json`), 'utf8'));
      const target = job.authorizations?.find((value: { id: string }) => value.id === authorization);
      if (current?.revision !== plugin.receipt.revision || job.packageRevision !== plugin.receipt.revision || target?.attemptId !== view.id || ['cancelled', 'completed'].includes(job.state)) controller.abort();
    } catch { controller.abort(); }
  }, 500);
  watcher.unref();
  void (async () => {
    try {
      await execute(store, plugin, authorization, method.login, controller.signal, method.timeoutSeconds * 1000, line => {
        try {
          const value = JSON.parse(line);
          if (value.type === 'challenge' && ['qr', 'url'].includes(value.kind) && typeof value.url === 'string' && value.url.length <= 8192) {
            view.challenge = { type: value.kind, url: safeAuthorizationUrl(value.url), ...(typeof value.message === 'string' && value.message.length <= 300 ? { message: value.message } : {}) }; view.state = 'awaiting_user';
          }
        } catch { /* Process output is untrusted; expose only validated challenge fields. */ }
      });
      controller.signal.throwIfAborted();
      if ((store.pending(plugin.id) ?? store.get(plugin.id))?.receipt.revision !== plugin.receipt.revision) throw new Error('Plugin revision changed');
      if (!await checkPluginCliAuthorization(store, plugin, authorization, method, controller.signal)) throw new Error('Account verification failed');
      view.state = 'connected'; delete view.challenge;
    } catch {
      view.state = controller.signal.aborted ? 'cancelled' : 'error';
      view.error = controller.signal.aborted ? 'Sign-in cancelled.' : 'Sign-in or account verification failed. Retry authorization.';
      delete view.challenge;
    } finally { clearInterval(watcher); }
  })();
  return view;
}
export function getPluginCliAuthorization(id: string, owner: string, revision: string): PluginCliAuthorization | undefined {
  const attempt = attempts.get(id);
  if (!attempt) return;
  if (attempt.owner !== owner || attempt.revision !== revision) throw new Error('Authorization does not match this installation');
  if (attempt.view.expiresAt <= Date.now() && !['connected', 'error', 'cancelled'].includes(attempt.view.state)) { attempt.controller.abort(); attempt.view.state = 'error'; attempt.view.error = 'Sign-in expired. Try again.'; delete attempt.view.challenge; }
  return attempt.view;
}
export function cancelPluginCliAuthorizations(pluginId: string, owner?: string): void {
  for (const attempt of attempts.values()) if (attempt.pluginId === pluginId && (owner === undefined || attempt.owner === owner)) { attempt.controller.abort(); attempt.view.state = 'cancelled'; delete attempt.view.challenge; }
}

export function cancelAllPluginCliAuthorizations(): void {
  for (const attempt of attempts.values()) { attempt.controller.abort(); if (!['connected', 'error', 'cancelled'].includes(attempt.view.state)) attempt.view.state = 'cancelled'; delete attempt.view.challenge; }
}
