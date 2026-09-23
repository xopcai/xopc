import { describe, expect, it } from 'vitest';

import {
  HomeAdvisorSchema,
  HomeOpportunitySchema,
  HomeOpportunityActionResponseSchema,
  HomeResponseSchema,
} from './home.js';

describe('home contract', () => {
  it('requires the server to return an explicit advisor state', () => {
    expect(() => HomeResponseSchema.parse({
      needsUser: [], background: [], backgroundCount: 0, decisions: [],
      runningConversations: [],
    })).toThrow();

    const parsed = HomeResponseSchema.parse({
      needsUser: [], background: [], backgroundCount: 0, decisions: [],
      runningConversations: [],
      advisor: { state: 'quiet', reason: 'no_change' },
    });
    expect(parsed.advisor).toEqual({ state: 'quiet', reason: 'no_change' });
  });

  it('rejects an ungrounded ready recommendation', () => {
    expect(() => HomeAdvisorSchema.parse({
      state: 'ready',
      primary: { id: 'unsupported' },
      alternatives: [], placement: 'primary', generatedAt: 1, expiresAt: 2, stale: false,
    })).toThrow();
  });

  it('accepts structured setup recovery with an explicit degraded action', () => {
    const parsed = HomeOpportunityActionResponseSchema.parse({
      outcome: 'needs_setup',
      preflight: {
        state: 'needs_setup',
        blockers: [{
          kind: 'connector',
          capability: 'composio-gmail',
          code: 'connection_missing',
          message: 'Connect Gmail before starting.',
          recoveryPath: '/connectors?connector=composio-gmail&returnTo=%2F',
        }],
        recoveryActions: [{
          capability: 'composio-gmail',
          href: '/connectors?connector=composio-gmail&returnTo=%2F',
        }],
        degradedAction: { mode: 'degraded_start' },
      },
    });

    expect(parsed.outcome).toBe('needs_setup');
    if (parsed.outcome !== 'needs_setup') throw new Error('Expected setup recovery response');
    expect(parsed.preflight.state).toBe('needs_setup');
    if (parsed.preflight.state !== 'needs_setup') throw new Error('Expected blocked preflight');
    expect(parsed.preflight.degradedAction).toEqual({ mode: 'degraded_start' });
  });

  it('keeps repeated work as a reviewable Automation continuation', () => {
    const parsed = HomeOpportunitySchema.parse({
      id: 'repeat-1', revision: 1, kind: 'automation_candidate', projectId: 'atlas',
      title: 'Prepare release checklist', outcome: 'A reviewed release checklist.',
      rationale: 'This outcome has succeeded twice.',
      evidence: [{
        id: 'project:atlas:1', sourceType: 'project', sourceRef: 'atlas', revision: '1',
        observation: 'Atlas is preparing a release.', observedAt: 1, freshUntil: 2,
      }],
      confidence: 'high', urgency: 'this_week', risk: 'analysis', proposedSteps: ['Review scope'],
      capabilities: [], verification: ['Draft is reviewable'], actionPrompt: 'Prepare the checklist.',
      continuation: {
        kind: 'automation', reason: 'repeated_success', href: '/automations?draft=review', successCount: 2,
      },
      actions: { canStart: true, canDiscuss: true, degradedStartAvailable: false },
      generatedAt: 1, expiresAt: 2,
    });

    expect(parsed.continuation).toEqual({
      kind: 'automation', reason: 'repeated_success', href: '/automations?draft=review', successCount: 2,
    });
  });
});
