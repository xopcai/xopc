// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { modelPreferenceForAgent } from '@xopcai/gateway-contract';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchConfiguredModelsCached } from '../api/registry-api';
import { fetchGatewayAgentEffectiveConfig } from '@/features/settings/agents-admin-api';
import { readNewSessionPreferences, rememberAgentModel } from '../session/new-session-preferences';
import type { ProjectSessionPreparation } from '../session/use-chat-session-init';
import { usePreparedSessionModel } from '../session/use-prepared-session-model';

vi.mock('../api/registry-api', () => ({ fetchConfiguredModelsCached: vi.fn() }));
vi.mock('@/features/settings/agents-admin-api', () => ({ fetchGatewayAgentEffectiveConfig: vi.fn() }));

describe('prepared session model', () => {
  let root: ReturnType<typeof createRoot>;
  let container: HTMLDivElement;
  let value: ReturnType<typeof usePreparedSessionModel>;
  let preparation: ProjectSessionPreparation;
  const cache = { provider: () => new Map() };
  function Harness({ source = preparation }: { source?: ProjectSessionPreparation | null }) {
    value = usePreparedSessionModel(source);
    return <span>{value.model}</span>;
  }
  const render = (source: ProjectSessionPreparation | null = preparation) => act(async () => {
    root.render(<SWRConfig value={cache}><Harness source={source} /></SWRConfig>);
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.clearAllMocks();
    localStorage.clear();
    container = document.createElement('div');
    root = createRoot(container);
    preparation = {
      project: { id: 'project', workspaceRoot: '/repo' } as ProjectSessionPreparation['project'],
      agentId: 'main', temporary: false, create: vi.fn(async () => 'created'),
    };
    vi.mocked(fetchConfiguredModelsCached).mockResolvedValue([
      { id: 'cloud/default', name: 'Default', provider: 'cloud', reasoning: true,
        thinking: { mode: 'levels', options: ['low', 'high'], initialValue: 'low', supportsAdaptive: false } },
      { id: 'cloud/other', name: 'Other', provider: 'cloud', reasoning: false,
        thinking: { mode: 'none', options: ['off'], initialValue: 'off', supportsAdaptive: false } },
    ]);
    vi.mocked(fetchGatewayAgentEffectiveConfig).mockResolvedValue({
      config: { models: { chat: { primary: 'cloud/default' } } }, sources: {},
    } as Awaited<ReturnType<typeof fetchGatewayAgentEffectiveConfig>>);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  it('shows the agent default before creation and submits the displayed model and effort', async () => {
    await render();
    expect(value.model).toBe('cloud/default');
    expect(value.thinkingLevel).toBe('low');
    expect(value.ready).toBe(true);
    expect(preparation.create).not.toHaveBeenCalled();
    await act(async () => { await value.preparation!.create('local_checkout'); });
    expect(preparation.create).toHaveBeenCalledWith('local_checkout', { model: 'cloud/default', thinkingLevel: 'low' });
    expect(modelPreferenceForAgent(readNewSessionPreferences(), 'main')).toBeUndefined();
  });

  it('prefers remembered selections and keeps preparation identity when model and effort change', async () => {
    rememberAgentModel('main', { modelRef: 'cloud/default', thinkingLevel: 'high' });
    await render();
    const identity = value.preparation;
    expect(value.thinkingLevel).toBe('high');
    expect(fetchGatewayAgentEffectiveConfig).not.toHaveBeenCalled();
    await act(async () => value.onThinkingChange('low'));
    expect(value.thinkingLevel).toBe('low');
    await act(async () => value.onModelChange('cloud/other'));
    expect(value.preparation).toBe(identity);
    expect(value.model).toBe('cloud/other');
    expect(value.thinkingLevel).toBe('off');
    expect(preparation.create).not.toHaveBeenCalled();
    await act(async () => { await identity!.create('managed_worktree'); });
    expect(preparation.create).toHaveBeenCalledWith('managed_worktree', { model: 'cloud/other', thinkingLevel: 'off' });
    expect(modelPreferenceForAgent(readNewSessionPreferences(), 'main')?.modelRef).toBe('cloud/other');
  });

  it('keeps unavailable remembered models visible until replaced', async () => {
    rememberAgentModel('main', { modelRef: 'removed/model', thinkingLevel: 'high' });
    await render();
    expect(value.model).toBe('removed/model');
    expect(value.ready).toBe(false);
    await expect(value.preparation!.create('local_checkout')).rejects.toThrow('not ready');
    await act(async () => value.onModelChange('cloud/default'));
    expect(value.ready).toBe(true);
  });

  it('rejects creation through an old preparation after navigation', async () => {
    await render();
    const stale = value.preparation!;
    await render(null);
    await expect(stale.create('local_checkout')).rejects.toThrow('not ready');
    expect(preparation.create).not.toHaveBeenCalled();
  });
});
