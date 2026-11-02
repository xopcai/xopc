import { afterEach, beforeEach, expect, it } from 'vitest';

import { CapabilityDispatcher, type CapabilityContext } from '../../capabilities/runtime/dispatcher.js';
import { closeXopcDatabase, openXopcDatabase } from '../../storage/sqlite/index.js';
import { registerAgentCapabilities } from '../capabilities.js';
import { seedTestAgentCatalog } from '../test-support.js';
import { AgentCatalogRepository } from '../repository.js';

beforeEach(() => { openXopcDatabase({ path: ':memory:' }); seedTestAgentCatalog({ agents: [{ id: 'main', enabled: true, runtime: { actionApprovalMode: 'ask' } }] }); });
afterEach(() => closeXopcDatabase());
it('does not allow an agent to change its approval mode or erase it by replacing runtime settings', async () => {
  const dispatcher = new CapabilityDispatcher(); registerAgentCapabilities(dispatcher);
  const context: CapabilityContext = { surface: 'agent', principalId: 'agent:main', scopes: ['gateway.admin'], actor: { kind: 'agent', id: 'main' }, authorize: () => true };
  const repository = new AgentCatalogRepository();
  const operation = 'xopc.agents.update';
  const expected = () => ({ ...dispatcher.describe(operation, context), idempotencyKey: crypto.randomUUID() });
  await expect(dispatcher.call(operation, { id: 'main', expectedRevision: repository.get('main')!.revision, patch: { runtime: { actionApprovalMode: 'full' } } }, context, expected())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await dispatcher.call(operation, { id: 'main', expectedRevision: repository.get('main')!.revision, patch: { runtime: { maxTurns: 4 } } }, context, expected());
  expect(repository.get('main')?.runtime).toEqual({ actionApprovalMode: 'ask', maxTurns: 4 });
});
