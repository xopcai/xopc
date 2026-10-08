import { describe, expect, it, vi } from 'vitest';

import { TaskJudgeService } from '../task-judge-service.js';

const { completeRun } = vi.hoisted(() => ({ completeRun: vi.fn() }));
vi.mock('../../../tasks/task-application-service.js', () => ({ TaskApplicationService: class { completeRun = completeRun; } }));
vi.mock('../../../tasks/task-conversation-repository.js', () => ({ TaskConversationRepository: class {
  resolveActiveExecutionSession() { return { taskId: 'task' }; }
} }));
vi.mock('../../../tasks/task-repository.js', () => ({ TaskRepository: class {
  get() { return { contract: { objective: 'Write a report', acceptanceCriteria: ['Complete report'] } }; }
} }));
vi.mock('../../../tasks/task-run-repository.js', () => ({ TaskRunRepository: class {
  getActiveRoot() { return { id: 'run', version: 1, status: 'running', conversationId: 'conversation' }; }
} }));
vi.mock('../../../providers/index.js', () => ({
  resolveModel: () => ({ provider: 'test' }),
  getApiKey: async () => undefined,
}));
vi.mock('../../../providers/model-call.js', () => ({ completeWithResolvedCredentials: async () => ({
  role: 'assistant', content: [{ type: 'text', text: '{"completedCriteria":[0],"needsUser":false,"reasons":["Verified"]}' }],
}) }));

describe('task judge result storage', () => {
  it('preserves the beginning and end of a long Markdown report in the receipt', async () => {
    const service = new TaskJudgeService({
      sessionStore: { loadMessages: async () => [], loadTranscriptRows: async () => [] },
      modelManager: { getModelForSession: () => 'test/model' },
      getConfig: () => undefined,
    } as unknown as ConstructorParameters<typeof TaskJudgeService>[0]);
    const report = `# Full report\n\n${'Detailed findings.\n'.repeat(300)}\n## Conclusion\nDone.`;
    await service.reviewTurn({ conversationId: 'conversation', channel: 'webchat', chatId: 'chat', assistantPlainText: report, aborted: false });
    expect(completeRun).toHaveBeenCalledWith(expect.objectContaining({
      receipt: expect.objectContaining({ summary: report }),
    }));
  });
});
