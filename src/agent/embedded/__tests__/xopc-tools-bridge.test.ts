import { describe, expect, it, vi } from 'vitest';

import { validateApplyPatchEnvelope, xopcToolsToDefinitions } from '../xopc-tools-bridge.js';
import { createDataBatchTool } from '../../tools/dataBatch.js';

it.each([true, false])('uses the launched task tool scope for batching (search allowed: %s)', async searchAllowed => {
  const search = {
    name: 'web_search', label: 'Search', description: 'Search', parameters: {},
    execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Found' }], details: {} })),
  };
  const batch = createDataBatchTool('/tmp', () => new Set(['web_search']), { getTools: () => [search] });
  const worker = xopcToolsToDefinitions(searchAllowed ? [batch, search] : [batch]);
  const [launcher] = xopcToolsToDefinitions([{
    name: 'launch_task', label: 'Launch task', description: 'Launch task', parameters: {},
    execute: async () => worker.find(tool => tool.name === 'data_batch')!.execute('batch', {
      operations: [{ id: 'search', kind: 'web_search', query: 'exhibitions' }],
    }, undefined, undefined),
  } as never]);

  const result = await launcher!.execute('launch', {}, undefined, undefined);
  expect(result.details).toMatchObject({ status: searchAllowed ? 'completed' : 'failed', sourceRequests: searchAllowed ? 1 : 0 });
  expect(search.execute).toHaveBeenCalledTimes(searchAllowed ? 1 : 0);
});

describe('validateApplyPatchEnvelope', () => {
  it('accepts an exact apply_patch envelope', () => {
    expect(validateApplyPatchEnvelope({
      patch: '*** Begin Patch\n*** Update File: example.ts\n@@\n-old\n+new\n*** End Patch',
    })).toBeNull();
  });
  it('accepts terminal Unix and Windows newlines without accepting trailing prose', () => {
    for (const ending of ['\n', '\r\n', '\n\n']) {
      expect(validateApplyPatchEnvelope({ patch: `*** Begin Patch\n*** Update File: report.md\n@@\n-old\n+new\n*** End Patch${ending}` })).toBeNull();
    }
    expect(validateApplyPatchEnvelope({ patch: '*** Begin Patch\n*** End Patch\ntrailing prose\n' })).toMatchObject({ issue: 'last_line' });
  });

  it('rejects a missing begin marker with a targeted repair hint', () => {
    expect(validateApplyPatchEnvelope({
      patch: '*** Update File: example.ts\n@@\n-old\n+new\n*** End Patch',
    })).toMatchObject({
      code: 'invalid_patch_envelope',
      issue: 'first_line',
      expected: '*** Begin Patch',
      received: '*** Update File: example.ts',
    });
  });

  it('rejects trailing stars on the begin marker', () => {
    expect(validateApplyPatchEnvelope({
      patch: '*** Begin Patch ***\n*** Update File: example.ts ***\n@@\n-old\n+new\n*** End Patch ***',
    })).toMatchObject({
      code: 'invalid_patch_envelope',
      issue: 'first_line',
      expected: '*** Begin Patch',
      received: '*** Begin Patch ***',
    });
  });

  it('rejects trailing stars on an inner patch control line', () => {
    expect(validateApplyPatchEnvelope({
      patch: '*** Begin Patch\n*** Update File: example.ts ***\n@@\n-old\n+new\n*** End Patch',
    })).toMatchObject({
      code: 'invalid_patch_envelope',
      issue: 'control_line',
      expected: '*** Update File: example.ts',
      received: '*** Update File: example.ts ***',
    });
  });

  it('rejects an invalid end marker', () => {
    expect(validateApplyPatchEnvelope({
      patch: '*** Begin Patch\n*** Update File: example.ts\n@@\n-old\n+new\n*** End Patch ***',
    })).toMatchObject({
      code: 'invalid_patch_envelope',
      issue: 'last_line',
      expected: '*** End Patch',
      received: '*** End Patch ***',
    });
  });
});

describe('xopcToolsToDefinitions apply_patch guard', () => {
  it('returns structured feedback without invoking the underlying tool', async () => {
    const execute = vi.fn();
    const [definition] = xopcToolsToDefinitions([{
      name: 'apply_patch',
      description: 'Apply a patch.',
      parameters: {},
      execute,
    } as never]);

    expect(definition).toMatchObject({
      promptSnippet: 'Apply patches using the exact apply_patch envelope',
      promptGuidelines: expect.arrayContaining([
        'The patch must start exactly with `*** Begin Patch` and end exactly with `*** End Patch`.',
      ]),
    });

    const result = await definition!.execute('call-1', {
      patch: '*** Begin Patch ***\n*** End Patch ***',
    }, undefined, undefined) as {
      content: Array<{ type: string; text: string }>;
      details: { code: string; issue: string; expected: string; received: string };
    };

    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      code: 'invalid_patch_envelope',
      issue: 'first_line',
      expected: '*** Begin Patch',
      received: '*** Begin Patch ***',
    });
    expect(result.content[0]?.text).toContain('Do not add trailing ` ***`');
  });

  it('forwards a valid patch unchanged', async () => {
    const execute = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'applied' }], details: {} });
    const [definition] = xopcToolsToDefinitions([{
      name: 'apply_patch',
      description: 'Apply a patch.',
      parameters: {},
      execute,
    } as never]);
    const params = { patch: '*** Begin Patch\n*** Update File: example.ts\n@@\n-old\n+new\n*** End Patch' };

    await definition!.execute('call-2', params, undefined, undefined);

    expect(execute).toHaveBeenCalledWith('call-2', params, undefined, undefined);
  });
});
