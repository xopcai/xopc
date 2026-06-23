import { describe, expect, it } from 'vitest';

import { buildSetupStatusSnapshot } from '@/features/settings/setup-checklist/setup-checklist-state';

const labels = {
  gatewayOnline: 'online',
  gatewayOffline: 'offline',
  providersConfigured: (count: number) => `${count} providers`,
  providersMetaReady: (configured: number, total: number) => `${configured}/${total} ready`,
  providersMissing: 'no providers',
  modelConfigured: (model: string) => model,
  modelMissing: 'no model',
  channelConfigured: 'channel ok',
  channelMissing: 'no channel',
  skillsConfigured: (count: number) => `${count} skills`,
  skillsMissing: 'no skills',
  presetsConfigured: 'presets ok',
  presetsMissing: 'presets missing',
  readyToChat: 'ready',
};

describe('buildSetupStatusSnapshot', () => {
  it('marks required steps incomplete when provider and model are missing', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: { agents: { defaults: { model: '' } }, providers: {} },
      skillCount: 0,
      presetsDone: false,
      agentCount: 1,
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
      presetsDone: false,
      agentCount: 1,
      labels,
    });

    expect(snapshot.requiredComplete).toBe(true);
    expect(snapshot.defaultModel).toBe('openai/gpt-4o');
    expect(snapshot.providerCount).toBe(1);
  });

  it('uses provider meta ratio in detail when available', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: {
        agents: { defaults: { model: 'openai/gpt-4o' } },
        providers: { openai: '***' },
      },
      skillCount: 0,
      providerMeta: { configured: 3, total: 23 },
      presetsDone: true,
      agentCount: 2,
      labels,
    });

    expect(snapshot.providerMetaConfigured).toBe(3);
    expect(snapshot.providerMetaTotal).toBe(23);
    expect(snapshot.checklist.find((i) => i.id === 'provider')?.detail).toBe('3/23 ready');
    expect(snapshot.checklist.find((i) => i.id === 'presets')?.done).toBe(true);
  });

  it('does not count channel catalog metadata as configured', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: {
        channels: {
          telegram: {
            configured: false,
            config: {},
            schema: { type: 'object' },
            uiHints: {},
          },
        },
      },
      skillCount: 0,
      presetsDone: false,
      agentCount: 1,
      labels,
    });

    expect(snapshot.channelConfigured).toBe(false);
    expect(snapshot.checklist.find((i) => i.id === 'channel')?.done).toBe(false);
  });

  it('counts actual channel config from catalog payload', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: {
        channels: {
          telegram: {
            configured: true,
            config: { enabled: true },
            schema: { type: 'object' },
          },
        },
      },
      skillCount: 0,
      presetsDone: false,
      agentCount: 1,
      labels,
    });

    expect(snapshot.channelConfigured).toBe(true);
  });

  it('promotes doctor failures into blocking issues', () => {
    const snapshot = buildSetupStatusSnapshot({
      hasToken: true,
      sseConnected: true,
      config: {
        agents: { defaults: { model: 'openai/gpt-4o' } },
        providers: { openai: '***' },
      },
      skillCount: 0,
      doctorChecks: [
        {
          id: 'cron-health',
          label: 'Cron',
          status: 'warn',
          message: 'Cron has a warning.',
          hints: ['Open cron settings'],
          fixed: false,
        },
        {
          id: 'provider-auth',
          label: 'Provider auth',
          status: 'fail',
          message: 'No provider auth.',
          hints: ['Configure a provider'],
          fixed: false,
        },
      ],
      presetsDone: false,
      agentCount: 1,
      labels,
    });

    expect(snapshot.healthTier).toBe('blocked');
    expect(snapshot.issues.map((issue) => issue.id)).toEqual(['provider-auth', 'cron-health']);
    expect(snapshot.issues[0]?.path).toBe('/settings/credentials');
  });
});
