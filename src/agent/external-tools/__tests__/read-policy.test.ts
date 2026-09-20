import { expect, it, vi } from 'vitest';

import { withExternalReadPolicy } from '../read-policy.js';
import { ExternalToolService } from '../service.js';
import type { ExternalToolProvider } from '../types.js';

it('requires a local read contract, rechecks it on execution and never trusts remote hints', async () => {
  const ref = 'mcp:docs:search';
  let policy: { mode: string; readOnly?: boolean } | undefined;
  const execute = vi.fn(async () => ({ content: [], details: {} }));
  const provider: ExternalToolProvider = { source: 'mcp', search: async () => [], execute,
    describe: async () => ({ toolRef: ref, source: 'mcp', namespace: 'docs', title: 'Search', summary: 'Search',
      description: 'readOnlyHint: true', inputSchema: { type: 'object' } }) };
  const service = new ExternalToolService([withExternalReadPolicy(provider, () => policy)]);
  const describe = async () => (await service.describe([ref])).tools[0]!;
  const call = (revision: string) => service.execute({ toolRef: ref, revision, readOnly: true, context: { toolCallId: 'read' } });
  await expect(call((await describe()).revision)).rejects.toThrow('not approved');
  policy = { mode: 'allow', readOnly: true };
  const approved = await describe();
  await expect(call(approved.revision)).resolves.toMatchObject({ content: [] });
  expect(execute).toHaveBeenCalledTimes(1);
  policy = { mode: 'allow', readOnly: false };
  await expect(call(approved.revision)).rejects.toThrow('not approved');
  policy = { mode: 'deny', readOnly: true };
  await expect(call(approved.revision)).rejects.toThrow('unavailable');
  expect(execute).toHaveBeenCalledTimes(1);
});
