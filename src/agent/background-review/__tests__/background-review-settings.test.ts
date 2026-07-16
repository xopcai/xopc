import { describe, expect, it } from 'vitest';

import type { AgentManifest } from '../../../agent-manifest/index.js';
import type { Config } from '../../../config/schema.js';
import { resolveBackgroundReviewSettings } from '../settings.js';

function config(memory: AgentManifest['memory']): Config {
  return {
    agents: {
      default: 'main',
      defaultPreset: 'default',
      capabilityPresets: {},
      list: [{
        id: 'main',
        enabled: true,
        identity: { name: 'main', role: 'Assistant', language: 'en', tone: 'direct' },
        responsibilities: { primary: ['Help'] },
        workspace: { root: '/tmp/xopc' },
        models: { defaultRole: 'main', roles: { main: { model: 'openai/gpt-4.1' } } },
        tools: { builtin: {} },
        skills: { mode: 'all' },
        memory,
        workflows: {},
        boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
      }],
    },
  } as Config;
}

describe('resolveBackgroundReviewSettings', () => {
  it('stays disabled without a resolvable agent manifest', () => {
    expect(resolveBackgroundReviewSettings(undefined)).toMatchObject({
      enabled: false,
      reviewIntervalTurns: 10,
    });
  });

  it('enables low-frequency understanding reviews for write-capable memory', () => {
    expect(resolveBackgroundReviewSettings(config({
      mode: 'confirmWrite',
      sources: ['session'],
    }))).toEqual({
      enabled: true,
      agentId: 'main',
      adaptiveCadence: true,
      reviewIntervalTurns: 10,
      maxHistoryMessages: 80,
      maxDurationMs: 120_000,
    });
  });

  it('respects per-agent overrides and memory access mode', () => {
    const overridden = resolveBackgroundReviewSettings(config({
      mode: 'auto',
      sources: ['session'],
      understanding: {
        enabled: true,
        adaptiveCadence: false,
        reviewIntervalTurns: 3,
        maxHistoryMessages: 40,
        maxDurationMs: 45_000,
      },
    }));
    expect(overridden).toMatchObject({
      enabled: true,
      adaptiveCadence: false,
      reviewIntervalTurns: 3,
      maxHistoryMessages: 40,
      maxDurationMs: 45_000,
    });
    expect(resolveBackgroundReviewSettings(config({
      mode: 'readOnly',
      sources: ['session'],
    })).enabled).toBe(false);
    expect(resolveBackgroundReviewSettings(config({
      mode: 'confirmWrite',
      sources: ['session'],
      understanding: { enabled: false },
    })).enabled).toBe(false);
  });
});
