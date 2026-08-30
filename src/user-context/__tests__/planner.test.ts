import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  closeXopcDatabase, createCollaborationRule, createUnderstanding,
  decideContextConsent, getTurnPersonalization, openXopcDatabase, resetXopcDatabaseSingletonForTest,
  updateUserProfile,
} from '../../storage/sqlite/index.js';
import { UserContextPlanner } from '../planner.js';
import { upsertUserFocus } from '../sources/repository.js';

function message(text: string): AgentMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as AgentMessage;
}

function textOf(value: AgentMessage): string {
  const content = (value as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((item) => item.text ?? '').join('');
}

describe('structured user context planner', () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'xopc-context-planner-'));
    resetXopcDatabaseSingletonForTest();
    openXopcDatabase({ path: join(stateDir, 'xopc.db') });
  });

  afterEach(() => {
    closeXopcDatabase();
    resetXopcDatabaseSingletonForTest();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it('injects profile, active rules, and relevant understanding with an audit run', () => {
    updateUserProfile({ callName: 'Mic', timezone: 'Asia/Shanghai' });
    createCollaborationRule({
      category: 'communication', priority: 10, scope: { type: 'global' }, conditions: {},
      statement: 'Lead with the conclusion.',
    });
    const understanding = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:xopc', status: 'active',
      scope: { type: 'workspace', id: '/repo/xopc' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'The xopc repository uses pnpm.', createdBy: 'user', changeReason: 'test',
    });
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-1', workspaceId: '/repo/xopc', turnId: 'turn-1',
      query: 'Update the xopc repository dependencies', userMessage: message('Please update dependencies'),
    });
    const prompt = textOf(plan.modelMessage);
    expect(prompt).toContain('Preferred name: Mic');
    expect(prompt).toContain('Lead with the conclusion.');
    expect(prompt).toContain('The xopc repository uses pnpm.');
    expect(plan.items.map((item) => item.recordId)).toContain(understanding.id);
    expect(getTurnPersonalization('turn-1')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'profile', decision: 'selected' }),
      expect.objectContaining({ objectType: 'rule', decision: 'selected' }),
      expect.objectContaining({ objectType: 'understanding', objectId: understanding.id, decision: 'selected' }),
    ]));
  });

  it('keeps scope mismatches and consent-gated understanding out of the prompt', () => {
    const scoped = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:private', status: 'active',
      scope: { type: 'workspace', id: '/other' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'Private project uses a special deploy key.', createdBy: 'user', changeReason: 'test',
    });
    const gated = createUnderstanding({
      kind: 'relationship', canonicalKey: 'relationship:alex', status: 'active', scope: { type: 'global' },
      explicitness: 'inferred', durability: 'recurring', sensitivity: 'personal',
      disclosurePolicy: 'ask_before_reference', confidence: 0.9,
      statement: 'Alex is a frequent collaborator.', createdBy: 'connector', changeReason: 'test',
    });
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-2', workspaceId: '/repo/xopc', turnId: 'turn-2',
      query: 'Alex is a frequent collaborator', userMessage: message('Tell me about Alex'),
    });
    expect(textOf(plan.modelMessage)).not.toContain(scoped.statement);
    expect(textOf(plan.modelMessage)).not.toContain(gated.statement);
    expect(plan.consentRequests).toEqual([expect.objectContaining({ recordId: gated.id })]);
    expect(plan.rejected).toEqual(expect.arrayContaining([
      { recordId: scoped.id, reason: 'scope_mismatch' },
      { recordId: gated.id, reason: 'requires_consent' },
    ]));
    decideContextConsent(plan.consentRequests[0]!.id, 'once');
    const authorized = new UserContextPlanner().plan({
      sessionKey: 'session-2', workspaceId: '/repo/xopc', turnId: 'turn-2-authorized',
      query: 'Alex is a frequent collaborator', userMessage: message('Tell me about Alex'),
    });
    expect(textOf(authorized.modelMessage)).toContain(gated.statement);
    const consumed = new UserContextPlanner().plan({
      sessionKey: 'session-2', workspaceId: '/repo/xopc', turnId: 'turn-2-consumed',
      query: 'Alex is a frequent collaborator', userMessage: message('Tell me about Alex again'),
    });
    expect(textOf(consumed.modelMessage)).not.toContain(gated.statement);
    expect(consumed.consentRequests).toEqual([expect.objectContaining({ recordId: gated.id })]);
  });

  it('reviews active non-sensitive understanding across scopes only for an explicit self-review', () => {
    const projectItem = createUnderstanding({
      kind: 'project_context', canonicalKey: 'project:role', status: 'active',
      scope: { type: 'project', id: 'project-xopc' }, explicitness: 'explicit', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 1,
      statement: 'Maintains the xopc gateway.', createdBy: 'user', changeReason: 'test',
    });
    const candidate = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:unconfirmed', status: 'candidate',
      scope: { type: 'global' }, explicitness: 'inferred', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 0.9,
      statement: 'May prefer weekly summaries.', createdBy: 'runtime', changeReason: 'test',
    });
    const planner = new UserContextPlanner();
    const ordinary = planner.plan({
      sessionKey: 'session-review', workspaceId: '/other', turnId: 'turn-ordinary',
      query: 'Help me plan today', userMessage: message('Help me plan today'),
    });
    const review = planner.plan({
      sessionKey: 'session-review', workspaceId: '/other', turnId: 'turn-review',
      query: '介绍下你认识的我', userMessage: message('介绍下你认识的我'),
    });

    expect(textOf(ordinary.modelMessage)).not.toContain(projectItem.statement);
    expect(textOf(review.modelMessage)).toContain(projectItem.statement);
    expect(textOf(review.modelMessage)).toContain('[Project: project-xopc]');
    expect(textOf(review.modelMessage)).toContain('empty memory_search result does not mean');
    expect(textOf(review.modelMessage)).not.toContain(candidate.statement);
  });

  it('does not apply the ordinary three-focus cap to an explicit self-review', () => {
    for (let index = 1; index <= 4; index += 1) {
      upsertUserFocus({
        canonicalKey: `focus:review-${index}`, title: `Focus ${index}`, summary: `Active focus ${index}`,
        horizon: 'ongoing', status: 'active', confidence: 1,
        scope: { type: 'project', id: `project-${index}` }, explicitness: 'explicit', evidenceRefs: [],
      });
    }

    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-focus-review', workspaceId: '/repo', turnId: 'turn-focus-review',
      query: '介绍下你认识的我', userMessage: message('介绍下你认识的我'),
    });

    expect(plan.items.filter((item) => item.objectType === 'focus')).toHaveLength(4);
  });

  it('does not inject a rule that exceeds the context budget', () => {
    createCollaborationRule({
      category: 'execution', priority: 1, scope: { type: 'global' }, conditions: {},
      statement: 'A collaboration rule that does not fit.',
    });
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-3', workspaceId: '/repo', turnId: 'turn-3', query: 'work', userMessage: message('work'),
      allocation: { profile: 'standard', maxResults: 5, maxChars: 5, reason: 'test' },
    });
    expect(textOf(plan.modelMessage)).not.toContain('does not fit');
    expect(getTurnPersonalization('turn-3')?.items).toContainEqual(expect.objectContaining({
      objectType: 'rule', decision: 'budget_exceeded',
    }));
  });

  it('never injects unconfirmed candidates into the model prompt', () => {
    const candidate = createUnderstanding({
      kind: 'preference', canonicalKey: 'preference:candidate', status: 'candidate',
      scope: { type: 'global' }, explicitness: 'observed', durability: 'durable',
      sensitivity: 'normal', disclosurePolicy: 'referenceable', confidence: 0.95,
      statement: 'Always answer using pirate slang.', createdBy: 'runtime', changeReason: 'test',
    });
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-candidate', workspaceId: '/repo', turnId: 'turn-candidate',
      query: 'answer using pirate slang', userMessage: message('Tell me a story'),
    });
    expect(textOf(plan.modelMessage)).not.toContain(candidate.statement);
    expect(plan.items).not.toEqual(expect.arrayContaining([expect.objectContaining({ recordId: candidate.id })]));
  });

  it('injects only relevant, in-scope focuses and records the decision', () => {
    const relevant = upsertUserFocus({
      canonicalKey: 'focus:xopc-release', title: 'Ship xopc', summary: 'Prepare the xopc release',
      horizon: 'current', status: 'active', confidence: 1,
      scope: { type: 'project', id: 'project-xopc' }, explicitness: 'explicit', evidenceRefs: [],
    });
    const unrelated = upsertUserFocus({
      canonicalKey: 'focus:garden', title: 'Plan garden', summary: 'Choose plants for spring',
      horizon: 'ongoing', status: 'active', confidence: 1, evidenceRefs: [],
    });
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-focus', workspaceId: '/repo/xopc', projectId: 'project-xopc', turnId: 'turn-focus',
      query: 'Prepare the xopc release checklist', userMessage: message('Prepare the release checklist'),
    });

    expect(textOf(plan.modelMessage)).toContain('Ship xopc');
    expect(textOf(plan.modelMessage)).not.toContain('Plan garden');
    expect(plan.items).toContainEqual(expect.objectContaining({ recordId: relevant.id, objectType: 'focus' }));
    expect(plan.rejected).toContainEqual({ recordId: unrelated.id, reason: 'low_score' });
    expect(getTurnPersonalization('turn-focus')?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ objectType: 'focus', objectId: relevant.id, decision: 'selected' }),
      expect.objectContaining({ objectType: 'focus', objectId: unrelated.id, decision: 'irrelevant' }),
    ]));
  });

  it('keeps focus content inside the shared context budget', () => {
    upsertUserFocus({
      canonicalKey: 'focus:oversized', title: 'Release', summary: 'A focus that cannot fit',
      horizon: 'current', status: 'active', confidence: 1,
      scope: { type: 'project', id: 'project-xopc' }, evidenceRefs: [],
    });
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-focus-budget', workspaceId: '/repo/xopc', projectId: 'project-xopc',
      turnId: 'turn-focus-budget', query: 'release', userMessage: message('release'),
      allocation: { profile: 'standard', maxResults: 2, maxChars: 5, reason: 'test' },
    });

    expect(textOf(plan.modelMessage)).not.toContain('cannot fit');
    expect(getTurnPersonalization('turn-focus-budget')?.items).toContainEqual(expect.objectContaining({
      objectType: 'focus', decision: 'budget_exceeded',
    }));
  });

  it('budgets the complete injected block without duplicating focuses', () => {
    updateUserProfile({ callName: 'Mic' });
    const focus = upsertUserFocus({
      canonicalKey: 'focus:exact-budget', title: 'Ship release', summary: 'Prepare the release',
      horizon: 'current', status: 'active', confidence: 1, evidenceRefs: [],
    });
    const maxChars = 800;
    const plan = new UserContextPlanner().plan({
      sessionKey: 'session-exact-budget', workspaceId: '/repo', turnId: 'turn-exact-budget',
      query: 'prepare release', userMessage: message('prepare release'),
      allocation: { profile: 'standard', maxResults: 5, maxChars, reason: 'test' },
    });
    const prompt = textOf(plan.modelMessage);
    const block = prompt.slice(0, prompt.lastIndexOf('\n\nprepare release'));
    const selected = getTurnPersonalization('turn-exact-budget')!.items
      .filter((item) => item.decision === 'selected');

    expect(block.length).toBeLessThanOrEqual(maxChars);
    expect(selected.reduce((sum, item) => sum + item.injectedChars, 0)).toBe(block.length);
    expect(prompt.match(new RegExp(focus.title, 'g'))).toHaveLength(1);
  });

  it('applies collaboration rules only on their configured channel', () => {
    createCollaborationRule({
      category: 'communication', priority: 1, scope: { type: 'global' },
      conditions: { channel: 'telegram' }, statement: 'Use short mobile-friendly paragraphs.',
    });
    const planner = new UserContextPlanner();
    const web = planner.plan({
      sessionKey: 'agent:main:webchat:default:direct:1', channel: 'webchat', workspaceId: '/repo',
      turnId: 'turn-web', query: 'write an update', userMessage: message('Write an update'),
    });
    const telegram = planner.plan({
      sessionKey: 'agent:main:telegram:default:direct:1', channel: 'telegram', workspaceId: '/repo',
      turnId: 'turn-telegram', query: 'write an update', userMessage: message('Write an update'),
    });
    expect(textOf(web.modelMessage)).not.toContain('mobile-friendly');
    expect(textOf(telegram.modelMessage)).toContain('mobile-friendly');
  });

  it('applies collaboration rules only to their configured agent', () => {
    createCollaborationRule({
      category: 'execution', priority: 1, scope: { type: 'global' },
      conditions: { agentId: 'coder' }, statement: 'Always run the repository typecheck.',
    });
    const planner = new UserContextPlanner();
    const main = planner.plan({
      sessionKey: 'agent:main:webchat:default:direct:1', workspaceId: '/repo',
      turnId: 'turn-main-agent', query: 'update code', userMessage: message('Update code'),
    });
    const coder = planner.plan({
      sessionKey: 'agent:coder:webchat:default:direct:1', workspaceId: '/repo',
      turnId: 'turn-coder-agent', query: 'update code', userMessage: message('Update code'),
    });
    expect(textOf(main.modelMessage)).not.toContain('repository typecheck');
    expect(textOf(coder.modelMessage)).toContain('repository typecheck');
  });
});
