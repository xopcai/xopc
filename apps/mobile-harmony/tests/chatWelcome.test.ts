import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  buildWelcomeSpotlight,
  type WelcomeSpotlightCopy,
  type WelcomeSuggestionContext,
} from '../../../packages/gateway-contract/src/welcome-suggestions';
import { buildChatWelcome } from '../entry/src/main/ets/common/chatWelcome.ets';
import type { XopcWelcomeContext } from '../entry/src/main/ets/common/chatWelcome.ets';

describe('native welcome parity with the shared recommendation model', () => {
  const contexts: WelcomeSuggestionContext[] = [
    { kind: 'empty' },
    { kind: 'project', projectId: 'p', projectName: 'Project A' },
    { kind: 'project', projectId: 'p', projectName: 'Project A', blockedReason: 'approval' },
    { kind: 'project', projectId: 'p', projectName: 'Project A', recentFailure: 'retry step' },
    { kind: 'project', projectId: 'p', projectName: 'Project A', recommendedAction: 'ship it' },
    { kind: 'task', taskId: 't', taskTitle: 'Task A', phase: 'active', operationalState: 'idle' },
    { kind: 'task', taskId: 't', taskTitle: 'Task A', phase: 'active', operationalState: 'waiting', attentionSummary: 'choose scope' },
    { kind: 'task', taskId: 't', taskTitle: 'Task A', phase: 'active', operationalState: 'idle', recentFailure: 'retry the test' },
    { kind: 'task', taskId: 't', taskTitle: 'Task A', phase: 'review', operationalState: 'idle' },
    { kind: 'task', taskId: 't', taskTitle: 'Task A', phase: 'closed', operationalState: 'idle' },
    { kind: 'task', taskId: 't', taskTitle: 'Task A', phase: 'active', operationalState: 'idle', nextAction: 'run tests' },
  ];

  for (const locale of ['en', 'zh'] as const) {
    const data = JSON.parse(readFileSync(
        new URL(`../entry/src/main/resources/rawfile/welcome-${locale}.json`, import.meta.url),
        'utf8',
      )) as { copy: WelcomeSpotlightCopy };

    it(`matches ${locale} deterministic recommendations`, () => {
      for (const context of contexts) {
        const copy = data.copy;
        const shared = buildWelcomeSpotlight(context, copy);
        expect(buildChatWelcome(context as XopcWelcomeContext, copy)).toEqual({
          headline: shared.headline,
          recommendation: shared.recommendation,
        });
      }
    });
  }
});
