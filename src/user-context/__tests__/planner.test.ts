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
});
