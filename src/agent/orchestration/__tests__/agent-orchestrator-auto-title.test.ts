import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';

import { AgentOrchestrator } from '../agent-orchestrator.js';
import type { InboundMessage } from '../../../infra/bus/index.js';
import type { SessionStore } from '../../../session/index.js';
import type { ModelManager } from '../../models/index.js';
import type { AgentEventHandler } from '../agent-event-handler.js';
import type { FeedbackCoordinator } from '../../feedback/feedback-coordinator.js';
import type { AgentManager } from '../../agent-manager.js';
import type { SessionConfigStore } from '../../../session/index.js';
import type { SessionContext } from '../../session/session-context.js';

vi.mock('../run-agent-turn-with-fallbacks.js', () => ({
  runAgentTurnWithModelFallbacks: vi.fn().mockResolvedValue(undefined),
}));

describe('AgentOrchestrator enqueueAutoTitle', () => {
  let mockAgent: Partial<Agent>;
  let mockAgentManager: Partial<AgentManager>;
  let mockSessionStore: Partial<SessionStore>;
  let mockModelManager: Partial<ModelManager>;
  let mockEventHandler: Partial<AgentEventHandler>;
  let mockFeedbackCoordinator: Partial<FeedbackCoordinator>;
  let mockSessionConfigStore: Partial<SessionConfigStore>;
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
    };

    mockSessionStore = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    };

    mockModelManager = {
      applyModelForSession: vi.fn().mockResolvedValue(undefined),
      getCurrentModel: vi.fn().mockReturnValue('test-model'),
      getResolvedModelForSession: vi.fn().mockReturnValue({ id: 'm' }),
      getFallbackCandidatesForSession: vi.fn().mockReturnValue([
        { provider: 'openai', model: 'gpt-4' },
      ]),
    };

    mockEventHandler = { handle: vi.fn() };

    mockFeedbackCoordinator = {
      startTask: vi.fn(),
      endTask: vi.fn(),
      setContext: vi.fn(),
      clearContext: vi.fn(),
    };

    mockSessionConfigStore = {
      get: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('calls enqueueAutoTitle once after final saveSessionSnapshot in process()', async () => {
    const orchestrator = new AgentOrchestrator({
      agentManager: mockAgentManager as AgentManager,
      sessionStore: mockSessionStore as SessionStore,
      modelManager: mockModelManager as ModelManager,
      eventHandler: mockEventHandler as AgentEventHandler,
      feedbackCoordinator: mockFeedbackCoordinator as FeedbackCoordinator,
      sessionConfigStore: mockSessionConfigStore as SessionConfigStore,
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
      sessionKey: 'main:telegram:default:dm:999',
      channel: 'telegram',
      chatId: '999',
      senderId: '1',
      isGroup: false,
    };

    await orchestrator.process(msg, context);

    expect(enqueueAutoTitle).toHaveBeenCalledTimes(1);
    expect(enqueueAutoTitle).toHaveBeenCalledWith('main:telegram:default:dm:999');
    expect(mockSessionStore.save).toHaveBeenCalled();
  });

  it('does not require enqueueAutoTitle when omitted', async () => {
    const orchestrator = new AgentOrchestrator({
      agentManager: mockAgentManager as AgentManager,
      sessionStore: mockSessionStore as SessionStore,
      modelManager: mockModelManager as ModelManager,
      eventHandler: mockEventHandler as AgentEventHandler,
      feedbackCoordinator: mockFeedbackCoordinator as FeedbackCoordinator,
      sessionConfigStore: mockSessionConfigStore as SessionConfigStore,
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
      sessionKey: 'main:telegram:default:dm:999',
      channel: 'telegram',
      chatId: '999',
      senderId: '1',
      isGroup: false,
    };

    await expect(orchestrator.process(msg, context)).resolves.toBeUndefined();
  });
});
