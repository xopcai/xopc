import { describe, expect, it } from 'vitest';

import { buildSetupStatusSnapshot } from '@/features/settings/setup-checklist/setup-checklist-state';

const labels = {
  gatewayOnline: 'online',
  gatewayOffline: 'offline',
  providersConfigured: (count: number) => `${count} providers`,
  providersMissing: 'no providers',
  modelConfigured: (model: string) => model,
  modelMissing: 'no model',
  channelConfigured: 'channel ok',
  channelMissing: 'no channel',
  skillsConfigured: (count: number) => `${count} skills`,
  skillsMissing: 'no skills',
};

describe('buildSetupStatusSnapshot', () => {
  it('marks required steps incomplete when provider and model are missing', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: { agents: { defaults: { model: '' } }, providers: {} },
      skillCount: 0,
      labels,
    });

    expect(snapshot.requiredComplete).toBe(false);
    expect(snapshot.checklist.find((i) => i.id === 'provider')?.done).toBe(false);
    expect(snapshot.checklist.find((i) => i.id === 'defaultModel')?.done).toBe(false);
  });

  it('marks required steps complete when gateway, provider, and model are set', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: {
        agents: { defaults: { model: 'openai/gpt-4o' } },
        providers: { openai: '***' },
      },
      skillCount: 0,
      labels,
    });

    expect(snapshot.requiredComplete).toBe(true);
    expect(snapshot.defaultModel).toBe('openai/gpt-4o');
    expect(snapshot.providerCount).toBe(1);
  });
});
