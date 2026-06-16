import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../agent-orchestrator.js';
import type { SessionStore, SessionConfigStore } from '../../../session/index.js';
import type { ModelManager } from '../../models/index.js';
import type { AgentEventHandler } from '../agent-event-handler.js';
import type { FeedbackCoordinator } from '../../feedback/feedback-coordinator.js';
import type { AgentManager } from '../../agent-manager.js';
import type { SessionHydrator } from '../../session/index.js';

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    const mockSessionStore: Partial<SessionStore> = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    };
    const mockModelManager: Partial<ModelManager> = {
      applyModelForSession: vi.fn().mockResolvedValue(undefined),
      getCurrentModel: vi.fn().mockReturnValue('openai/gpt-4o'),
      getModelForSession: vi.fn().mockReturnValue('openai/gpt-4o'),
    };
    const mockEventHandler: Partial<AgentEventHandler> = { handle: vi.fn() };
    const mockFeedbackCoordinator: Partial<FeedbackCoordinator> = {
      startTask: vi.fn(),
      endTask: vi.fn(),
      setContext: vi.fn(),
      clearContext: vi.fn(),
    };
    const mockAgentManager: Partial<AgentManager> = {
      expandSkillUserText: vi.fn((t: string) => t),
    };
    const mockSessionConfigStore: Partial<SessionConfigStore> = {
      get: vi.fn().mockResolvedValue(undefined),
    };
    const mockSessionHydrator: Partial<SessionHydrator> = {
      workspace: vi.fn().mockResolvedValue(undefined),
      model: vi.fn().mockResolvedValue(undefined),
    };

    orchestrator = new AgentOrchestrator({
      agentManager: mockAgentManager as AgentManager,
      sessionStore: mockSessionStore as SessionStore,
      modelManager: mockModelManager as ModelManager,
      eventHandler: mockEventHandler as AgentEventHandler,
      feedbackCoordinator: mockFeedbackCoordinator as FeedbackCoordinator,
      sessionConfigStore: mockSessionConfigStore as SessionConfigStore,
      sessionHydrator: mockSessionHydrator as SessionHydrator,
      getThinkingDefault: () => undefined,
      workspaceRoot: '/tmp/xopc-test-workspace',
    });
  });

  it('constructs with required dependencies', () => {
    expect(orchestrator).toBeDefined();
  });
});
