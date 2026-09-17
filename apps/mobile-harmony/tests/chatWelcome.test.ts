import { describe, expect, it } from 'vitest';
import { en } from '../../mobile-expo/src/i18n/locales/en';
import { zh } from '../../mobile-expo/src/i18n/locales/zh';
import { buildWelcomeSpotlight, type WelcomeSuggestionContext, type WelcomeSpotlightCopy } from '../../../packages/gateway-contract/src/welcome-suggestions';
import { buildChatWelcome, welcomeAgentName } from '../entry/src/main/ets/common/chatWelcome.ets';
import type { XopcWelcomeContext } from '../entry/src/main/ets/common/chatWelcome.ets';
import { readFileSync } from 'node:fs';

describe('native welcome parity with the shared mobile spotlight', () => {
  const contexts: WelcomeSuggestionContext[] = [
    { kind: 'empty' }, { kind: 'workingDirectory', path: '/repo/项目' },
    ...[{}, { blockedReason: 'approval' }, { recentFailure: 'retry step' }, { recommendedAction: 'ship it' }]
      .map(extra => ({ kind: 'generalProject' as const, projectId: 'p', projectName: 'Project A', ...extra })),
    ...[{}, { attentionSummary: 'choose scope' }, { recentFailure: 'retry the test' }, { phase: 'review' }, { phase: 'closed' }, { nextAction: 'run tests' }, { operationalState: 'verifying' }]
      .map(extra => ({ kind: 'task' as const, taskId: 't', taskTitle: 'Task A', phase: 'active' as const, operationalState: 'idle' as const, ...extra } as WelcomeSuggestionContext)),
  ];
  for (const [locale, messages] of [['en', en], ['zh', zh]] as const) {
    it(`keeps generated ${locale} copy current`, () => {
      const data = JSON.parse(readFileSync(new URL(`../entry/src/main/resources/rawfile/welcome-${locale}.json`, import.meta.url), 'utf8'));
      expect(data).toEqual({ copy: messages.chat.welcomeSpotlight, names: messages.agentsPage.builtInAgents });
    });
    it(`matches ${locale} task/project/directory/agent ordering and dynamic prompts`, () => {
      for (const id of ['main', 'coder', 'writer', 'researcher', 'data-analyst', 'creative', 'custom']) {
        for (const context of contexts) {
          for (const seed of ['2026-09-17', '2026-09-18']) {
            const agent = { id, name: 'Custom name', description: id === 'custom' ? '代码审查' : '', skills: [] };
            const copy = messages.chat.welcomeSpotlight;
            const shared = buildWelcomeSpotlight(context, copy as WelcomeSpotlightCopy, agent, {
              affinity: context.kind === 'empty' ? { 'explore-ai-news:0': 35 } : undefined, explorationSeed: seed,
            });
            expect(buildChatWelcome(context as XopcWelcomeContext, copy, agent, seed)).toEqual({
              headline: shared.headline, tagline: shared.tagline,
              starters: shared.categories.map(card => ({ id: card.scenarios[0].id ?? card.id + ':0', title: card.title, description: card.description, icon: card.icon, prompt: card.scenarios[0].prompt })).slice(0, 3),
            });
          }
        }
      }
    });
    it(`localizes shipped ${locale} agent names but preserves custom names`, () => {
      const data = { copy: messages.chat.welcomeSpotlight, names: messages.agentsPage.builtInAgents };
      expect(welcomeAgentName({ id: 'coder', name: 'Coding Expert' }, data)).toBe(messages.agentsPage.builtInAgents.coding.name);
      expect(welcomeAgentName({ id: 'coder', name: 'My coder' }, data)).toBe('My coder');
    });
  }
});
