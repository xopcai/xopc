import type { Agent } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentManifest } from '../../../agent-manifest/index.js';
import type { Config } from '../../../config/schema.js';
import type { WorkspaceRuntime } from '../../workspace-runtime/registry.js';
import { BackgroundReviewCoordinator } from '../coordinator.js';

const runBackgroundReviewTurn = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../run-background-review.js', () => ({ runBackgroundReviewTurn }));

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

describe('BackgroundReviewCoordinator', () => {
  it('schedules understanding by cadence without a curated-memory tool dependency', async () => {
    const cfg = config({
      mode: 'confirmWrite',
      sources: ['session'],
      understanding: { reviewIntervalTurns: 2 },
    });
    const coordinator = new BackgroundReviewCoordinator({ getConfig: () => cfg });
    const agent = {
      state: {
        messages: [{ role: 'assistant', content: 'Done.', stopReason: 'stop' }],
      },
    } as unknown as Agent;
    const workspaceRuntime = {
      memoryManager: { applyUnderstandingCandidates: vi.fn() },
    } as unknown as WorkspaceRuntime;

    coordinator.beginUserTurn('main:test');
    coordinator.scheduleAfterUserTurn({
      sessionKey: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceRuntime,
    });
    await Promise.resolve();
    expect(runBackgroundReviewTurn).not.toHaveBeenCalled();

    coordinator.beginUserTurn('main:test');
    coordinator.scheduleAfterUserTurn({
      sessionKey: 'main:test',
      agent,
      lastAssistantText: 'Done.',
      workspaceRuntime,
    });
    await vi.waitFor(() => expect(runBackgroundReviewTurn).toHaveBeenCalledTimes(1));
  });
});
