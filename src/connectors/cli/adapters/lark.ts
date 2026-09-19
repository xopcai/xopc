import type { ProcessResult } from '../../../process/process-spec.js';

import { larkShortcuts, larkShortcutArgs } from './larkShortcuts.js';
import { LARK_DISTRIBUTIONS } from '../distributions.js';
import { CliProtocolError, actionRevision, closedSchema, object, parseJson } from '../protocol.js';
import type { CliAdapter } from '../types.js';

const curatedActions: CliAdapter['curatedActions'] = {
  'docs.search': 'read',
  'docs.fetch': 'read',
  'calendar.calendars.list': 'read',
  'calendar.events.instance_view': 'read',
  'calendar.events.get': 'read',
  'calendar.events.create': 'write',
  'drive.files.list': 'read',
  'drive.metas.batch_query': 'read',
  'contact.user_profiles.batch_query': 'read',
};

function decodeLoginResult(output: ProcessResult): void {
  const events: Record<string, unknown>[] = [];
  for (const text of [output.stdout, output.stderr]) {
    try { events.push(object(JSON.parse(text))); } catch {
      for (const line of text.split('\n')) {
        try { events.push(object(JSON.parse(line))); } catch { /* Ignore non-JSON diagnostics. */ }
      }
    }
  }
  const complete = events.find(event => event.event === 'authorization_complete');
  // Exit 3 also means login succeeded with only a subset of requested scopes.
  if (output.exitCode === 0 || (output.exitCode === 3 && complete &&
    typeof complete.user_open_id === 'string' && complete.user_open_id.length > 0 &&
    (complete.warning && typeof complete.warning === 'object' ? object(complete.warning).type : undefined) === 'missing_scope' && Array.isArray(complete.missing) &&
    complete.missing.length > 0 && Array.isArray(complete.granted))) return;
  const failure = events.find(event => event.event === 'authorization_failed') ??
    events.find(event => event.ok === false);
  const error = failure?.error;
  const message = typeof error === 'string' ? error : error && typeof error === 'object' ? object(error).message : undefined;
  // Never persist raw process output, authorization URLs, or credential fields.
  const detail = typeof message === 'string' ? message
    .replace(/https?:\/\/[^\s"'<>]+/g, '[URL]')
    .replace(/((?:[a-z_]*(?:token|secret|password|code)|authorization)\s*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\x00-\x1f]+/g, ' ').slice(0, 500) : 'No structured error was returned.';
  throw new Error(`Lark login failed (exit ${output.exitCode}): ${detail}`);
}

export const larkAdapter: CliAdapter = {
  id: 'lark', version: '1', binaryVersion: '1.0.96', executable: 'lark-cli',
  distributions: LARK_DISTRIBUTIONS,
  configEnvironment: 'LARKSUITE_CLI_CONFIG_DIR', dataEnvironment: 'LARKSUITE_CLI_DATA_DIR',
  curatedActions, staticActions: larkShortcuts,
  schemaArgs: id => ['schema', id],
  decodeSchema(id, value) {
    const row = object(value);
    const meta = object(row._meta);
    if (!curatedActions[id] || typeof row.name !== 'string' || row.name.replaceAll(' ', '.') !== id) throw new Error('Unexpected Lark action schema.');
    if (!Array.isArray(meta.access_tokens) || !meta.access_tokens.includes('user')) throw new Error('Lark action does not support user identity.');
    const inputSchema = closedSchema(row.inputSchema);
    return { id, description: String(row.description ?? id), scope: curatedActions[id]!, inputSchema,
      anyScopes: Array.isArray(meta.scopes) ? meta.scopes.filter((x): x is string => typeof x === 'string') : [],
      requiredScopes: Array.isArray(meta.required_scopes) ? meta.required_scopes.filter((x): x is string => typeof x === 'string') : [], revision: actionRevision(value) };
  },
  actionArgs(action, input) {
    if (larkShortcuts[action.id]) return larkShortcutArgs(action, input);
    const [service, ...segments] = action.id.split('.');
    const method = segments.pop()!;
    const args = [service!, segments.join('.'), method, '--as', 'user', '--format', 'json'];
    for (const [key, value] of Object.entries(input)) {
      if (!['params', 'data'].includes(key)) throw new Error(`Unsupported Lark argument section: ${key}`);
      args.push(`--${key}`, JSON.stringify(value));
    }
    return args;
  },
  decodeResult(output) {
    const row = object(parseJson(output.exitCode === 0 ? output.stdout : output.stderr));
    if (typeof row.ok !== 'boolean') throw new CliProtocolError('Missing Lark result status.');
    if (row.ok !== true) {
      const error = row.error && typeof row.error === 'object' ? object(row.error) : {};
      throw new Error(String(error.message ?? 'Lark command failed.').slice(0, 500));
    }
    return row.data;
  },
  statusArgs: ['auth', 'status', '--json', '--verify'],
  decodeIdentity(output) {
    const row = object(parseJson(output.stdout));
    const user = object(object(row.identities).user);
    if (output.exitCode !== 0 || user.available !== true || user.verified !== true || typeof user.openId !== 'string' || typeof row.appId !== 'string') throw new Error('Lark user authorization is not verified.');
    return { key: `${row.appId}:${user.openId}`, label: String(user.userName ?? user.openId), scopes: String(user.scope ?? '').split(/\s+/).filter(Boolean), identity: { appId: row.appId, openId: user.openId, name: user.userName, kind: 'user' } };
  },
  authorizationSteps: [
    { initialOnly: true, args: ['config', 'init', '--new'], challenge: 'url', urlHosts: ['accounts.feishu.cn', 'open.feishu.cn', 'accounts.larksuite.com', 'open.larksuite.com'] },
    { decodeResult: decodeLoginResult, urlField: 'verification_uri_complete', args: ['auth', 'login', '--domain', 'calendar,drive,contact,docs', '--json'], challenge: 'url', urlHosts: ['accounts.feishu.cn', 'open.feishu.cn', 'accounts.larksuite.com', 'open.larksuite.com'] },
  ],
};
