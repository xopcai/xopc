import type { ConnectorDefinition } from '../../types.js';
import { registerCliAdapter } from '../adapterRegistry.js';
import { actionRevision, closedSchema, object, parseJson } from '../protocol.js';
import type { CliAdapter } from '../types.js';

export const fixtureAdapter: CliAdapter = {
  id: 'fixture', version: '1', binaryVersion: '1.0.0', executable: 'fixture-cli',
  distributions: {}, configEnvironment: 'FIXTURE_CLI_CONFIG_DIR',
  curatedActions: { 'records.read': 'read', 'records.create': 'write' },
  schemaArgs: id => ['schema', id],
  decodeSchema(id, value) {
    if (!this.curatedActions[id]) throw new Error('Unknown fixture action');
    const row = object(value);
    return { id, description: id, scope: this.curatedActions[id]!, inputSchema: closedSchema(object(row.request)), requiredScopes: [], revision: actionRevision(value) };
  },
  actionArgs: (action, input) => [...action.id.split('.'), '--json', JSON.stringify(input)],
  decodeResult(output) {
    const row = object(parseJson(output.stdout));
    if (output.exitCode !== 0 || row.error) throw new Error('Fixture request failed');
    return row;
  },
  statusArgs: ['auth', 'status'],
  decodeIdentity(output) {
    const row = object(parseJson(output.stdout));
    if (row.identity !== 'user') throw new Error('Fixture identity is not verified');
    return { key: 'fixture-user', label: 'Fixture', scopes: [], identity: { kind: 'user' } };
  },
  authorizationSteps: [{ args: ['auth', 'login'], challenge: 'url', urlHosts: ['auth.example.test'] }],
};
registerCliAdapter(fixtureAdapter);

export const fixtureDefinition: ConnectorDefinition = {
  id: 'fixture-cli', version: '1.0.0', displayName: 'Fixture CLI', description: 'Generic test fixture',
  category: 'custom', kind: 'cli', source: 'custom', capabilities: ['tools'], auth: { mode: 'cli' }, setup: {},
  runtime: { type: 'cli', adapterId: 'fixture', adapterVersion: '1', binaryVersion: '1.0.0' },
};
