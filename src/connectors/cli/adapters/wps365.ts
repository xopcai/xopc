import type { ProcessResult } from '../../../process/process-spec.js';
import { WPS365_DISTRIBUTIONS } from '../distributions.js';
import { actionRevision, closedSchema, CliProtocolError, object, parseJson } from '../protocol.js';
import type { CliAction, CliAdapter } from '../types.js';
import bundle from './wps365/bundle.json' with { type: 'json' };

function decodeAuthorization(output: ProcessResult): void {
  if (output.exitCode !== 0) decodeResult(output);
}

const contracts = new Map(bundle.actions.map(action => [action.id, action]));
const staticActions: Record<string, CliAction> = Object.fromEntries(bundle.actions.map(action => [action.id, {
  id: action.id, description: `WPS 365: ${action.description}`, scope: 'read', requiredScopes: [],
  inputSchema: closedSchema(action.inputSchema),
  revision: actionRevision({ action, specs: bundle.assets.map(asset => asset.sha256), version: bundle.version }),
}]));

function decodeResult(output: ProcessResult): unknown {
  if (output.exitCode !== 0) {
    // Provider diagnostics may contain credentials; expose only known failure categories.
    const diagnostic = `${output.stdout}\n${output.stderr}`;
    if (/403000001|ErrPrivileges|interface_company_doc/.test(diagnostic)) throw new Error('WPS enterprise subscription does not include this capability. Contact the enterprise administrator; reconnecting will not resolve it.');
    if (/not logged in|invalid_grant|expired|revoked/i.test(diagnostic)) throw new Error('WPS user authorization is unavailable or expired. Reconnect this account.');
    if (/scope|permission|forbidden/i.test(diagnostic)) throw new Error('WPS permission is missing. Check application publication, administrator approval and data access scope.');
    throw new Error(`WPS command failed (exit ${output.exitCode}). Check connection and enterprise permissions.`);
  }
  const row = object(parseJson(output.stdout));
  if (typeof row.code !== 'number') throw new CliProtocolError('Missing WPS response status.');
  if (row.code !== 0) {
    if (row.code === 403000001) throw new Error('WPS enterprise subscription does not include this capability. Contact the enterprise administrator.');
    throw new Error(`WPS rejected the request (code ${row.code}). Check enterprise permissions.`);
  }
  if (!('data' in row)) throw new CliProtocolError('Missing WPS response data.');
  return row.data;
}

export const wps365Adapter: CliAdapter = {
  id: 'wps365', version: '1', binaryVersion: bundle.version, executable: 'wps365-cli',
  distributions: WPS365_DISTRIBUTIONS,
  configEnvironment: 'WPS365_CONFIG_DIR', environment: { WPS365_KEYRING_BACKEND: 'file' },
  configAssets: bundle.assets, staticActions,
  curatedActions: Object.fromEntries(bundle.actions.map(action => [action.id, 'read' as const])),
  schemaArgs: () => { throw new Error('WPS uses packaged action contracts.'); },
  decodeSchema: () => { throw new Error('WPS uses packaged action contracts.'); },
  actionArgs(action, input) {
    const contract = contracts.get(action.id);
    if (!contract) throw new Error('WPS action is not enabled.');
    const args = [...contract.command, '--token-type', 'delegated', '--output', 'json'];
    for (const [name, value] of Object.entries(input)) {
      if (!(name in contract.inputSchema.properties) || name === 'token_type') throw new Error('Unsupported WPS argument.');
      if (!contract.positionals.includes(name)) args.push(`--${name}=${Array.isArray(value) ? value.join(',') : String(value)}`);
    }
    if (contract.positionals.length) args.push('--', ...contract.positionals.map(name => String(input[name])));
    return args;
  },
  decodeResult,
  statusArgs: ['user', 'me', '--token-type', 'delegated', '--output', 'json'],
  decodeIdentity(output) {
    if (output.timedOut || output.aborted || output.outputTruncated) throw new Error('WPS identity verification did not complete.');
    const user = object(decodeResult(output));
    if (typeof user.id !== 'string' || !user.id || typeof user.company_id !== 'string' || !user.company_id) throw new CliProtocolError('Missing WPS user or enterprise identity.');
    return { key: `${user.company_id}:${user.id}`, label: typeof user.user_name === 'string' ? user.user_name : user.id,
      scopes: [], identity: { userId: user.id, companyId: user.company_id, name: user.user_name, kind: 'user' } };
  },
  authorizationSteps: [
    { decodeResult: decodeAuthorization, initialOnly: true, args: ['config', 'init'], challenge: 'url', urlHosts: ['open.wps.cn', 'openapi.wps.cn'] },
    { decodeResult: decodeAuthorization, args: ['auth', 'login', '--device'], challenge: 'url', urlHosts: ['open.wps.cn', 'openapi.wps.cn'] },
  ],
};
