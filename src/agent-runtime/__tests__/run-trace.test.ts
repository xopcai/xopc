import { describe, expect, it } from 'vitest';

import type { EffectiveAgentManifest } from '../../agent-manifest/index.js';
import {
  appendAgentRunEvent,
  createAgentRunTrace,
  finishAgentRunTrace,
  hashEffectiveManifest,
} from '../index.js';

const manifest: EffectiveAgentManifest = {
  id: 'researcher',
  enabled: true,
  identity: {
    name: 'Researcher',
    role: 'Research agent',
    language: 'en',
    tone: 'direct',
  },
  responsibilities: {
    primary: ['Research topics'],
  },
  workspace: { root: '/tmp/workspace' },
  models: {
    defaultRole: 'deep',
    roles: {
      deep: { model: 'openai/gpt-4.1' },
    },
  },
  tools: { builtin: { web_search: { mode: 'allow' } } },
  skills: { mode: 'off' },
  memory: { mode: 'off', sources: ['session'] },
  workflows: {},
  boundaries: { requiresConfirmation: [], forbidden: [], escalation: [] },
};

describe('agent run trace', () => {
  it('hashes effective manifests deterministically', () => {
    const reordered: EffectiveAgentManifest = {
      ...manifest,
      identity: {
        tone: 'direct',
        language: 'en',
        role: 'Research agent',
        name: 'Researcher',
      },
    };

    expect(hashEffectiveManifest(manifest)).toBe(hashEffectiveManifest(reordered));
  });

  it('creates appends and finishes traces', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const trace = createAgentRunTrace({ agentId: 'researcher', manifest, now: start });
    const withModel = appendAgentRunEvent(
      trace,
      'model.selected',
      { role: 'deep', model: 'openai/gpt-4.1' },
      new Date('2026-01-01T00:00:01.000Z'),
    );
    const finished = finishAgentRunTrace(
      withModel,
      'completed',
      { message: 'done' },
      new Date('2026-01-01T00:00:02.000Z'),
    );

    expect(finished.status).toBe('completed');
    expect(finished.endedAt).toBe('2026-01-01T00:00:02.000Z');
    expect(finished.events.map((event) => event.type)).toEqual([
      'run.started',
      'model.selected',
      'run.completed',
    ]);
  });

  it('does not mutate closed traces', () => {
    const trace = finishAgentRunTrace(createAgentRunTrace({ agentId: 'researcher', manifest }), 'cancelled');

    expect(() => appendAgentRunEvent(trace, 'tool.called', {})).toThrow('Cannot append event');
    expect(() => finishAgentRunTrace(trace, 'completed')).toThrow('Cannot finish');
  });
});
