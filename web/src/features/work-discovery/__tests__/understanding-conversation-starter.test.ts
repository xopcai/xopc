import { describe, expect, it } from 'vitest';

import type { WorkDiscoveryRun } from '../api';
import { understandingConversationStarter } from '../understanding-conversation-starter';

function run(result: WorkDiscoveryRun['result']): WorkDiscoveryRun {
  return {
    id: 'run-1',
    status: 'completed',
    rootPath: '/work/xopc',
    projectId: 'project-1',
    sessionKey: 'session-1',
    result,
  };
}

describe('understandingConversationStarter', () => {
  it('prefers the generated project-aware starter', () => {
    expect(understandingConversationStarter(run({
      projectSummary: 'A software project.',
      currentState: 'Onboarding is changing.',
      uncertainties: [],
      suggestions: [],
      conversationStarter: '  Explain the onboarding changes and the best next step.  ',
    }), 'en')).toBe('Explain the onboarding changes and the best next step.');
  });

  it('falls back to the primary suggestion action prompt', () => {
    expect(understandingConversationStarter(run({
      projectSummary: 'A software project.',
      currentState: 'Tests are changing.',
      uncertainties: [],
      primarySuggestionId: 'suggestion-2',
      suggestions: [
        { id: 'suggestion-1', actionType: 'plan_next_step', title: 'One', rationale: '', evidence: [], actionPrompt: 'First', confidence: 'medium', expectedTask: '', estimatedMinutes: 5, risk: 'analysis', verification: [] },
        { id: 'suggestion-2', actionType: 'inspect_related_tests', title: 'Two', rationale: '', evidence: [], actionPrompt: 'Inspect the onboarding tests.', confidence: 'high', expectedTask: '', estimatedMinutes: 5, risk: 'analysis', verification: [] },
      ],
    }), 'en')).toBe('Inspect the onboarding tests.');
  });

  it('creates a localized folder-aware fallback without asking the user to invent input', () => {
    expect(understandingConversationStarter(run({
      projectSummary: 'A software project.',
      currentState: 'The objective is unclear.',
      uncertainties: [],
      suggestions: [],
    }), 'zh')).toContain('xopc');
  });
});
