import { WECOM_DISTRIBUTIONS } from '../distributions.js';
import { actionRevision, closedSchema, object, parseJson } from '../protocol.js';
import type { CliAdapter } from '../types.js';

function localReferences(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localReferences);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (key === '$ref' && typeof item === 'string') {
      if (!/^[A-Za-z0-9_]+$/.test(item)) throw new Error('Unsupported WeCom schema reference.');
      return [key, `#/definitions/${item}`];
    }
    return [key, localReferences(item)];
  }));
}

const curatedActions: CliAdapter['curatedActions'] = { 'doc.search': 'read', 'doc.contents.get': 'read', 'contact.users.search': 'read', 'todo.get': 'read', 'todo.create': 'write' };

export const wecomAdapter: CliAdapter = {
  id: 'wecom', version: '1', binaryVersion: '1.3.0', executable: 'wecom-cli',
  distributions: WECOM_DISTRIBUTIONS, configEnvironment: 'WECOM_CLI_CONFIG_DIR', curatedActions,
  schemaArgs: id => ['schema', 'get', id],
  decodeSchema(id, value) {
    const row = object(value);
    if (!curatedActions[id] || row.method !== id) throw new Error('Unexpected WeCom action schema.');
    const definitions = row.schemas ? object(row.schemas) : {};
    const request = row.request ? object(row.request) : { type: 'object', properties: {} };
    const ref = typeof request.$ref === 'string' ? request.$ref : undefined;
    const resolved = ref ? object(definitions[ref.split('/').pop()!]) : request;
    const inputSchema = closedSchema({ ...object(localReferences(resolved)), definitions: localReferences(definitions) });
    return { id, description: String(row.description ?? id), scope: curatedActions[id]!, inputSchema, requiredScopes: [], revision: actionRevision(value) };
  },
  actionArgs: (action, input) => [...action.id.split('.'), '--json', JSON.stringify(input)],
  decodeResult(output) {
    const row = object(parseJson(output.stdout));
    if (row.error || (typeof row.errcode === 'number' && row.errcode !== 0) || output.exitCode !== 0) {
      const error = row.error && typeof row.error === 'object' ? object(row.error) : row;
      throw new Error(String(error.message ?? error.errmsg ?? 'WeCom command failed.').slice(0, 500));
    }
    return row;
  },
  statusArgs: ['auth', 'show'],
  decodeIdentity(output) {
    const botId = /^Bot ID: ([^\r\n]+)$/m.exec(output.stdout)?.[1]?.trim();
    if (output.exitCode !== 0 || !/^Status: authorized$/m.test(output.stdout) || !botId) throw new Error('WeCom authorization is unavailable.');
    return { key: `bot:${botId}`, label: botId, scopes: [], identity: { botId, kind: 'bot' } };
  },
  authorizationSteps: [{ args: ['auth', 'init', '--noninteractive', '--no-browser', '--output-qrcode', 'authorization.png'], challenge: 'qr' }],
};
