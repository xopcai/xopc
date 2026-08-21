import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, AgentMessage } from '@earendil-works/pi-agent-core';

import { AgentOrchestrator } from '../agent-orchestrator.js';
import type { InboundMessage } from '../../../infra/bus/index.js';
import type { SessionStore } from '../../../session/index.js';
import type { ModelManager } from '../../models/index.js';
import type { AgentManager } from '../../agent-manager.js';
import type { SessionConfigStore } from '../../../session/index.js';
import type { SessionContext } from '../../session/session-context.js';
import type { SessionHydrator } from '../../session/session-hydrator.js';

vi.mock('../../embedded/run-for-session.js', () => ({
  runEmbeddedTurnForSession: vi.fn().mockResolvedValue({ ok: true, lastAssistantText: 'hello' }),
}));

describe('AgentOrchestrator enqueueAutoTitle', () => {
  let mockAgent: Partial<Agent>;
  let mockAgentManager: Partial<AgentManager>;
  let mockSessionStore: Partial<SessionStore>;
  let mockModelManager: Partial<ModelManager>;
  let mockSessionConfigStore: Partial<SessionConfigStore>;
  let mockSessionHydrator: Partial<SessionHydrator>;
  let enqueueAutoTitle: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    enqueueAutoTitle = vi.fn();
    mockAgent = {
      state: {
        messages: [
          { role: 'user', content: 'hi', timestamp: 1 },
          { role: 'assistant', content: 'hello', timestamp: 2 },
        ] as AgentMessage[],
      },
      replaceMessages: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };

    mockAgentManager = {
      getOrCreateAgent: vi.fn().mockReturnValue(mockAgent),
      setThinkingLevel: vi.fn(),
      expandSkillUserText: (t: string) => t,
      getResolvedWorkspaceForSession: () => '/tmp',
      prepareUserTurnContext: vi.fn().mockImplementation(async (m) => ({
        traceId: '', modelMessage: m, items: [], rejected: [], estimatedTokens: 0,
      })),
      afterAgentTurn: vi.fn(),
      beginBackgroundReviewUserTurn: vi.fn(),
      scheduleBackgroundReviewAfterUserTurn: vi.fn(),
    };

    mockSessionStore = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    };

    mockModelManager = {
      applyModelForSession: vi.fn().mockResolvedValue(undefined),
      getModelForSession: vi.fn().mockReturnValue('openai/gpt-4'),
      getCurrentModel: vi.fn().mockReturnValue('test-model'),
      getResolvedModelForSession: vi.fn().mockReturnValue({ id: 'm' }),
      getFallbackCandidatesForSession: vi.fn().mockReturnValue([
        { provider: 'openai', model: 'gpt-4' },
      ]),
    };

    mockSessionConfigStore = {
      get: vi.fn().mockResolvedValue(undefined),
    };

    mockSessionHydrator = {
      workspace: vi.fn().mockResolvedValue(undefined),
      model: vi.fn().mockResolvedValue(undefined),
      thinking: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('calls enqueueAutoTitle once after embedded turn in process()', async () => {
    const orchestrator = new AgentOrchestrator({
      agentManager: mockAgentManager as AgentManager,
      sessionStore: mockSessionStore as SessionStore,
      modelManager: mockModelManager as ModelManager,
      sessionConfigStore: mockSessionConfigStore as SessionConfigStore,
      sessionHydrator: mockSessionHydrator as SessionHydrator,
      getThinkingDefault: () => undefined,
      workspaceRoot: '/tmp',
      enqueueAutoTitle,
    });

    const msg: InboundMessage = {
      channel: 'telegram',
      sender_id: '1',
      chat_id: '2',
      content: 'Hello',
    };

    const context: SessionContext = {
      sessionKey: 'agent:main:telegram:default:direct:999',
      channel: 'telegram',
      chatId: '999',
      senderId: '1',
      isGroup: false,
      origin: { type: 'channel', channel: 'telegram' },
    };

    await orchestrator.process(msg, context);

    expect(enqueueAutoTitle).toHaveBeenCalledTimes(1);
    expect(enqueueAutoTitle).toHaveBeenCalledWith('agent:main:telegram:default:direct:999');
  });

  it('does not require enqueueAutoTitle when omitted', async () => {
    const orchestrator = new AgentOrchestrator({
      agentManager: mockAgentManager as AgentManager,
      sessionStore: mockSessionStore as SessionStore,
      modelManager: mockModelManager as ModelManager,
      sessionConfigStore: mockSessionConfigStore as SessionConfigStore,
      sessionHydrator: mockSessionHydrator as SessionHydrator,
      getThinkingDefault: () => undefined,
      workspaceRoot: '/tmp',
    });

    const msg: InboundMessage = {
      channel: 'telegram',
      sender_id: '1',
      chat_id: '2',
      content: 'Hello',
    };

    const context: SessionContext = {
      sessionKey: 'agent:main:telegram:default:direct:999',
      channel: 'telegram',
      chatId: '999',
      senderId: '1',
      isGroup: false,
      origin: { type: 'channel', channel: 'telegram' },
    };

    await expect(orchestrator.process(msg, context)).resolves.toBeUndefined();
  });
});
