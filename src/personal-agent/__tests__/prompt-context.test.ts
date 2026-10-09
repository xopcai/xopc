import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentCatalogRepository } from '../../agent-catalog/repository.js';
import { ConfigSchema } from '../../config/schema.js';
import { writeKnowledgeItem } from '../../knowledge-memory/index.js';
import { ProjectStore } from '../../projects/project-store.js';
import { createConversation } from '../../storage/sqlite/conversation-repository.js';
import { closeXopcDatabase, openXopcDatabase, resetXopcDatabaseSingletonForTest, setSessionConfig } from '../../storage/sqlite/index.js';
import { applyUserProfilePatch } from '../../user-model/profile.js';
import { personalAgentId } from '../repository.js';
import { PersonalPromptContext, packPersonalSnapshot } from '../prompt-context.js';

vi.mock('../../providers/index.js', () => ({ resolveModel: () => ({ provider: 'test' }), isProviderConfiguredSync: () => true }));

let catalog: AgentCatalogRepository;
let conversationId: string;
const config = ConfigSchema.parse({});

beforeEach(() => {
  resetXopcDatabaseSingletonForTest();
  openXopcDatabase({ path: ':memory:' });
  catalog = new AgentCatalogRepository();
  catalog.ensureInitialized();
  catalog.create({ id: personalAgentId('local-owner'), profile: { name: 'Personal AI' } }, { ready: true });
  conversationId = createConversation({ agentId: personalAgentId('local-owner'), customData: { personalAgent: true },
    routing: { agentId: personalAgentId('local-owner'), source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } }).key;
});
afterEach(() => { closeXopcDatabase(); resetXopcDatabaseSingletonForTest(); });

describe('personal prompt snapshot', () => {
  it('refreshes Agent changes without reloading the unchanged catalog', () => {
    catalog.create({ id: 'researcher', toolAllowlist: ['web_search'], profile: { name: 'Researcher', description: 'Research current facts' } }, { ready: true });
    const list = vi.spyOn(AgentCatalogRepository.prototype, 'list');
    const builder = new PersonalPromptContext();
    const first = builder.build(config, conversationId)!;
    expect(first).toContain('researcher');
    expect(first).toContain('web_search');
    expect(first.length).toBeLessThanOrEqual(2000);
    expect(builder.build(config, conversationId)).toBe(first);
    expect(list).toHaveBeenCalledTimes(1);
    catalog.update('researcher', catalog.get('researcher')!.revision, { id: 'researcher', enabled: false });
    expect(builder.build(config, conversationId)).not.toContain('researcher');
    expect(list).toHaveBeenCalledTimes(2);
    list.mockRestore();
  });

  it('refreshes explicit user data and honors a disabled session immediately', () => {
    const builder = new PersonalPromptContext();
    applyUserProfilePatch({ callName: 'Alice' });
    expect(builder.build(config, conversationId)).toContain('Alice');
    applyUserProfilePatch({ callName: 'Bob' });
    expect(builder.build(config, conversationId)).toContain('Bob');
    expect(builder.build(config, conversationId)).not.toContain('Alice');
    setSessionConfig(conversationId, { userContextMode: 'off' });
    expect(builder.build(config, conversationId)).not.toContain('Bob');
  });

  it('includes only current project decisions allowed by memory policy', () => {
    const project = new ProjectStore().create({ name: 'Atlas', outcome: 'Ship Atlas' });
    const scopedId = createConversation({ agentId: personalAgentId('local-owner'), projectId: project.id, customData: { personalAgent: true },
      routing: { agentId: personalAgentId('local-owner'), source: 'webchat', accountId: 'default', peerKind: 'direct', peerId: 'owner' } }).key;
    for (const [scope, content] of [[{ type: 'project', id: project.id }, 'Ship on Monday'], [{ type: 'project', id: 'other' }, 'Other project secret']] as const) {
      writeKnowledgeItem({ kind: 'decision', scope, content, canonicalKey: content,
        confidence: 1, importance: 0.9, originClass: 'owner', status: 'active' });
    }
    const builder = new PersonalPromptContext();
    expect(builder.build(config, scopedId)).toContain('Ship on Monday');
    expect(builder.build(config, scopedId)).not.toContain('Other project secret');
    setSessionConfig(scopedId, { userContextMode: 'off' });
    expect(builder.build(config, scopedId)).not.toContain('Ship on Monday');
    expect(builder.build(config, scopedId)).toContain('Atlas');
    new ProjectStore().update(project.id, { outcome: 'Ship next month' });
    expect(builder.build(config, scopedId)).toContain('Ship next month');
  });

  it('keeps complete identifiers and marks omitted oversized records', () => {
    const packed = packPersonalSnapshot([{ id: 'first', role: 'small' }, { id: 'second', role: 'x'.repeat(2000) }], 100);
    expect(JSON.parse(packed)).toEqual({ items: [{ id: 'first', role: 'small' }], omitted: 1 });
    expect(packed.length).toBeLessThanOrEqual(100);
  });
});
