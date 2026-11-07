import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentCatalogRepository } from '../../../agent-catalog/repository.js';
import { ConfigSchema } from '../../../config/schema.js';
import { PersonalPromptContext } from '../../../personal-agent/prompt-context.js';
import { personalAgentId } from '../../../personal-agent/repository.js';
import { createConversation } from '../../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, setSessionConfig } from '../../../storage/sqlite/index.js';
import { getSqliteDatabase } from '../../../storage/sqlite/transaction.js';
import { applyUserProfilePatch } from '../../../user-model/profile.js';
import { voiceConversationInstructions, voicePersonaBudget } from '../conversation-context.js';
import { buildVoiceUserContext } from '../user-context.js';

const config = () => structuredClone(ConfigSchema.parse({}));
let conversationId: string;
let current = config();
const build = () => buildVoiceUserContext({ getConfig: () => current, conversationId });

beforeEach(() => {
  resetXopcDatabaseSingletonForTest(); openXopcDatabase({ path: ':memory:' });
  const catalog = new AgentCatalogRepository(); catalog.ensureInitialized();
  const agentId = personalAgentId('local-owner');
  catalog.create({ id: agentId, profile: { name: 'Ada' } }, { ready: true });
  conversationId = createConversation({ agentId, sourceChannel: 'webchat', sourceChatId: '', customData: { personalAgent: true } }).key;
  current = config();
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

describe('pinned voice user context', () => {
  it('shares the confirmed profile with text Chat independently of retrieval and optional planning', () => {
    applyUserProfilePatch({ callName: 'Alice', role: 'Engineer', locale: 'zh-CN' });
    current.userContext.contextPlanning.enabled = false;
    const user = build()!;
    expect(new PersonalPromptContext().build(current, conversationId)).toContain('Alice');
    const saved = JSON.parse(user.block).currentUser;
    expect(saved).toMatchObject({ relationship: 'conversation_owner', nameKnown: true,
      profile: { callName: 'Alice', role: 'Engineer', locale: 'zh-CN' } });
    const personaBudget = voicePersonaBudget('', undefined, true, user);
    const instructions = voiceConversationInstructions('', { identity: 'p'.repeat(personaBudget), user, actions: true,
      history: Array.from({ length: 100 }, (_, index) => ({ role: 'user' as const,
        content: [{ type: 'text' as const, text: `${index}: ${'unrelated topic '.repeat(300)}` }], timestamp: index })) });
    expect(instructions).toContain('Alice');
    expect(instructions.length).toBeLessThanOrEqual(8000);
  });

  it('marks an unknown name explicitly rather than promoting an assistant guess to user identity', () => {
    const user = build()!;
    expect(JSON.parse(user.block).currentUser).toMatchObject({ nameKnown: false, profile: {} });
    const instructions = voiceConversationInstructions('', { identity: 'Ada', user, history: [], actions: true });
    expect(instructions).toContain('Assistant guesses');
    expect(instructions).toContain('user questions about a name');
    expect(instructions).toContain('recall missing personal details');
    expect(instructions).toContain('never invent an identity');
  });

  it('detects first-time profile creation, correction and deletion across calls', () => {
    const empty = build()!;
    applyUserProfilePatch({ callName: 'Alice' });
    expect(empty.isCurrent()).toBe(false);
    const first = build()!;
    applyUserProfilePatch({ callName: 'Bob' });
    expect(first.isCurrent()).toBe(false);
    const corrected = build()!;
    expect(corrected.block).toContain('Bob'); expect(corrected.block).not.toContain('Alice');
    applyUserProfilePatch({ callName: '' });
    expect(corrected.isCurrent()).toBe(false);
    expect(JSON.parse(build()!.block).currentUser.nameKnown).toBe(false);
  });

  it('uses a newer explicit correction without rewriting the saved profile or reviving a cleared one', () => {
    applyUserProfilePatch({ callName: 'Alice' });
    const history = [{ role: 'user' as const, content: '以后叫我小夏。', timestamp: Date.now() + 1 }];
    const corrected = buildVoiceUserContext({ getConfig: () => current, conversationId, history })!;
    expect(corrected.preferredCallName).toBe('小夏');
    expect(build()!.preferredCallName).toBe('Alice');
    applyUserProfilePatch({ callName: '' });
    expect(buildVoiceUserContext({ getConfig: () => current, conversationId, history })!.preferredCallName).toBeUndefined();
  });

  it('honors disabled personalization and per-agent restrictions', () => {
    applyUserProfilePatch({ callName: 'Alice' });
    const user = build()!;
    setSessionConfig(conversationId, { userContextMode: 'off' });
    expect(user.isCurrent()).toBe(false); expect(build()).toBeUndefined();
    setSessionConfig(conversationId, { userContextMode: 'enabled' });
    getSqliteDatabase().prepare("UPDATE user_assertions SET allowed_agent_ids_json = '[\"other\"]' WHERE kind = 'identity'").run();
    expect(JSON.parse(build()!.block).currentUser.nameKnown).toBe(false);
    current.userContext.userModel.enabled = false; expect(build()).toBeUndefined();
  });

  it('does not promote inferred or expired profile values to confirmed identity', () => {
    applyUserProfilePatch({ callName: 'Guessed' });
    getSqliteDatabase().prepare("UPDATE user_assertions SET authority='system_inferred' WHERE kind='identity'").run();
    expect(JSON.parse(build()!.block).currentUser.nameKnown).toBe(false);
    getSqliteDatabase().prepare("UPDATE user_assertions SET authority='user_explicit', valid_to=1 WHERE kind='identity'").run();
    expect(JSON.parse(build()!.block).currentUser.nameKnown).toBe(false);
  });

  it('never reveals owner profile in group or unverified channel calls', () => {
    applyUserProfilePatch({ callName: 'Private owner name' });
    for (const [source, peerKind] of [['webchat', 'group'], ['telegram', 'direct']] as const) {
      const id = createConversation({ agentId: personalAgentId('local-owner'), sourceChannel: source,
        routing: { source, agentId: personalAgentId('local-owner'), accountId: 'default', peerKind, peerId: 'unverified' } }).key;
      expect(buildVoiceUserContext({ getConfig: () => current, conversationId: id })).toBeUndefined();
    }
  });

  it('omits oversized fields individually while retaining other confirmed fields', () => {
    applyUserProfilePatch({ callName: 'x'.repeat(2000), role: 'Engineer' });
    const user = build()!;
    expect(user.block.length).toBeLessThanOrEqual(800);
    expect(JSON.parse(user.block).currentUser).toMatchObject({ nameKnown: false, profile: { role: 'Engineer' }, omittedFields: ['callName'] });
  });
});
