import { requireXopcDatabase as openFixtureDatabase } from '../../../storage/sqlite/connection.js';
import { ensureSessionRecord as ensureFixtureConversation } from '../../../storage/sqlite/session-repository.js';
function seedConversationFixtures(): void {
  openFixtureDatabase();
  ensureFixtureConversation("be278b62-65c6-4b8d-8876-363c0a155a5a", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"wf_run-1","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"wf_run-1"}});
  ensureFixtureConversation("0beb9c69-d789-4c8d-87be-22e9abe391a5", '', {"agentId":"main","sourceChannel":"webchat","sourceChatId":"parent","sessionType":"chat","routing":{"agentId":"main","source":"webchat","accountId":"default","peerKind":"direct","peerId":"parent"}});
  ensureFixtureConversation("6e2dd79d-484c-4566-8ee5-3ab23daa50a0", '', {"agentId":"main","sourceChannel":"workflow","sourceChatId":"run-1","sessionType":"workflow-run","routing":{"agentId":"main","source":"workflow","accountId":"default","peerKind":"direct","peerId":"run-1"}});
}
import { describe, expect, it, vi } from 'vitest';

import { createWorkflowTool } from '../workflow-tool.js';

describe('workflow tool async run start', () => {
  it('starts a persisted run and returns runId + conversationId immediately', async () => {
    seedConversationFixtures();
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      conversationId: "be278b62-65c6-4b8d-8876-363c0a155a5a",
    }));
    const catalog = {
      load: vi.fn(),
      save: vi.fn(),
    };

    const tool = createWorkflowTool({
      catalog: catalog as never,
      getConfig: () => ({}) as never,
      getCurrentConversationId: () => "0beb9c69-d789-4c8d-87be-22e9abe391a5",
      startWorkflowRun,
    });

    const result = await tool.execute('tool-call-1', { name: 'audit_repo', goal: 'Check repo' });

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: 'audit_repo',
        goal: 'Check repo',
        parentConversationId: "0beb9c69-d789-4c8d-87be-22e9abe391a5",
        source: { kind: 'chat', conversationId: "0beb9c69-d789-4c8d-87be-22e9abe391a5" },
      }),
    );
    expect(result.details).toMatchObject({
      runId: 'run-1',
      conversationId: "be278b62-65c6-4b8d-8876-363c0a155a5a",
      delivery: {
        operation: 'started',
        primary: {
          kind: 'workflow_run',
          id: 'run-1',
        },
      },
    });
    expect(result.content[0]?.type).toBe('text');
  });

  it('returns unavailable when workflow run service is missing', async () => {
    seedConversationFixtures();
    const tool = createWorkflowTool({
      catalog: { load: vi.fn() } as never,
      getConfig: () => ({}) as never,
    });

    const result = await tool.execute('tool-call-1', { name: 'audit_repo' });
    expect(result.details).toMatchObject({ error: 'workflow_run_unavailable' });
  });

  it('uses an explicit workflow and otherwise uses the default', async () => {
    seedConversationFixtures();
    const startWorkflowRun = vi.fn(async () => ({
      ok: true as const,
      runId: 'run-1',
      conversationId: "6e2dd79d-484c-4566-8ee5-3ab23daa50a0",
    }));
    const catalog = { load: vi.fn() };
    const config = {
      agents: {
        default: 'main',
        defaults: {
          models: { chat: { primary: 'openai/gpt-4.1', fallbacks: [] }, intents: {} },
          workflows: { default: 'general', allowed: ['general', 'review-code'] },
        },
        list: [{
          id: 'main',
          enabled: true,
          profile: { name: 'Main' },
          workspace: '/tmp/main',
        }],
      },
    };
    const tool = createWorkflowTool({
      catalog: catalog as never,
      getConfig: () => config as never,
      getCurrentConversationId: () => "0beb9c69-d789-4c8d-87be-22e9abe391a5",
      startWorkflowRun,
    });

    await tool.execute('explicit', { name: 'review-code' });
    await tool.execute('default', {});

    expect(startWorkflowRun.mock.calls[0]?.[0].definitionId).toBe('review-code');
    expect(startWorkflowRun.mock.calls[1]?.[0].definitionId).toBe('general');
  });
});
