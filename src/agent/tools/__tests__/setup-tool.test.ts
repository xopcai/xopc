import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../cli/commands/setup-shared/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../cli/commands/setup-shared/index.js')>();
  return {
    ...actual,
    ensureSetupHandlersLoaded: vi.fn().mockResolvedValue(undefined),
    getSetupHandler: vi.fn(),
    serializeSetupManifest: vi.fn(() => ({
      version: 1 as const,
      domains: [{ domain: 'providers', description: 'test', actions: [], fields: {} }],
    })),
  };
});

import {
  ensureSetupHandlersLoaded,
  getSetupHandler,
  serializeSetupManifest,
} from '../../../cli/commands/setup-shared/index.js';
import { createSetupTool } from '../setup-tool.js';

describe('setup tool', () => {
  beforeEach(() => {
    vi.mocked(getSetupHandler).mockReset();
    vi.mocked(ensureSetupHandlersLoaded).mockClear();
  });

  it('returns manifest on op manifest', async () => {
    const tool = createSetupTool({ getConfigPath: () => '/tmp/xopc.json' });
    const result = await tool.execute!('id', { op: 'manifest' }, undefined);
    expect(ensureSetupHandlersLoaded).toHaveBeenCalled();
    expect(serializeSetupManifest).toHaveBeenCalled();
    expect(result.details?.manifest?.version).toBe(1);
    expect(result.content[0]?.type).toBe('text');
  });

  it('requires domain and action for invoke', async () => {
    const tool = createSetupTool({ getConfigPath: () => '/tmp/xopc.json' });
    const result = await tool.execute!('id', { op: 'invoke' }, undefined);
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('"ok": false');
    expect(result.details?.outcome?.errors?.[0]?.message).toMatch(/domain and action/);
  });

  it('returns error when handler missing', async () => {
    vi.mocked(getSetupHandler).mockReturnValue(undefined);
    const tool = createSetupTool({ getConfigPath: () => '/tmp/xopc.json' });
    const result = await tool.execute!(
      'id',
      { op: 'invoke', domain: 'missing', action: 'noop' },
      undefined,
    );
    expect(result.details?.outcome?.ok).toBe(false);
  });

  it('invokes handler and calls onSetupApplied after write', async () => {
    const handler = vi.fn().mockResolvedValue({
      ok: true,
      action: 'set',
      domain: 'providers',
      target: 'openai',
      changedPaths: ['profiles.openai:default.key'],
      dryRun: false,
    });
    vi.mocked(getSetupHandler).mockReturnValue({
      domain: 'providers',
      action: 'set-key',
      handler,
    });
    const onSetupApplied = vi.fn().mockResolvedValue(undefined);
    const tool = createSetupTool({
      getConfigPath: () => '/cfg/xopc.json',
      onSetupApplied,
    });
    const result = await tool.execute!(
      'id',
      {
        op: 'invoke',
        domain: 'providers',
        action: 'set-key',
        fields: { provider: 'openai', key: 'sk-test-secret-key-value' },
      },
      undefined,
    );
    expect(handler).toHaveBeenCalledWith({
      configPath: '/cfg/xopc.json',
      fields: { provider: 'openai', key: 'sk-test-secret-key-value' },
      options: { dryRun: false, json: true },
    });
    expect(onSetupApplied).toHaveBeenCalledOnce();
    expect(result.details?.outcome?.ok).toBe(true);
  });

  it('skips onSetupApplied for dry-run', async () => {
    vi.mocked(getSetupHandler).mockReturnValue({
      domain: 'providers',
      action: 'set-key',
      handler: vi.fn().mockResolvedValue({
        ok: true,
        action: 'set',
        domain: 'providers',
        changedPaths: ['profiles.openai:default.key'],
        dryRun: true,
      }),
    });
    const onSetupApplied = vi.fn();
    const tool = createSetupTool({
      getConfigPath: () => '/cfg/xopc.json',
      onSetupApplied,
    });
    await tool.execute!(
      'id',
      { op: 'invoke', domain: 'providers', action: 'set-key', dryRun: true },
      undefined,
    );
    expect(onSetupApplied).not.toHaveBeenCalled();
  });
});
