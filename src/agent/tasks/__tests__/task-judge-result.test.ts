import { describe, expect, it, vi } from 'vitest';

import { TaskJudgeService } from '../task-judge-service.js';

const { completeRun, complete, createWait, setStatus } = vi.hoisted(() => ({ completeRun: vi.fn(), complete: vi.fn(), createWait: vi.fn(), setStatus: vi.fn() }));
vi.mock('../../../tasks/task-application-service.js', () => ({ TaskApplicationService: class { completeRun = completeRun; } }));
vi.mock('../../../tasks/task-conversation-repository.js', () => ({ TaskConversationRepository: class {
  resolveActiveExecutionSession() { return { taskId: 'task' }; }
} }));
vi.mock('../../../tasks/task-repository.js', () => ({ TaskRepository: class {
  get() { return { title: 'Write a report', locale: 'zh', contract: { objective: 'Write a report', acceptanceCriteria: ['Complete report'] } }; }
} }));
vi.mock('../../../tasks/task-collaboration-repository.js', () => ({ TaskCollaborationRepository: class {
  coordination() { return [{ kind: 'instruction', body: 'Double the amounts', deliveryStatus: 'confirmed' },
    { kind: 'ack', body: 'Will double the amounts' }]; }
} }));
vi.mock('../../../tasks/task-run-repository.js', () => ({ TaskRunRepository: class {
  createWait = createWait;
  setStatus = setStatus;
  getActiveRoot() { return { id: 'run', version: 1, status: 'running', conversationId: 'conversation' }; }
} }));
vi.mock('../../../providers/index.js', () => ({
  resolveModel: () => ({ provider: 'test' }),
  getApiKey: async () => undefined,
}));
vi.mock('../../../providers/model-call.js', () => ({ completeWithResolvedCredentials: complete }));


describe('task judge result storage', () => {
  it('preserves the beginning and end of a long Markdown report in the receipt', async () => {
    complete.mockResolvedValue({ role: 'assistant', content: [{ type: 'text', text: '{"completedCriteria":[0],"needsUser":false,"reasons":["已验证"]}' }] });
    const service = new TaskJudgeService({
      sessionStore: { loadMessages: async () => [], loadTranscriptRows: async () => [] },
      modelManager: { getModelForSession: () => 'test/model' },
      getConfig: () => undefined,
    } as unknown as ConstructorParameters<typeof TaskJudgeService>[0]);
    const report = `# Full report\n\n${'Detailed findings.\n'.repeat(300)}\n## Conclusion\nDone.`;
    await service.reviewTurn({ conversationId: 'conversation', channel: 'webchat', chatId: 'chat', assistantPlainText: report, aborted: false });
    const prompt = complete.mock.calls.at(-1)![1].messages[0].content;
    expect(prompt).toContain('Write all user-facing prose in Simplified Chinese.');
    expect(prompt).toContain('recommendation, nextAction, reasons, rejectedAlternatives and uncertainty');
    expect(prompt).toContain('Double the amounts');
    expect(prompt).toContain('An acknowledgement proves receipt and interpretation only');
    expect(completeRun).toHaveBeenCalledWith(expect.objectContaining({
      receipt: expect.objectContaining({ summary: report }),
    }));
  });
  it('stores localized attention and question content from the verifier', async () => {
    complete.mockResolvedValue({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify({
      completedCriteria: [], needsUser: true, recommendation: '请确认授权范围。', nextAction: '是否允许同步到 Slack？', reasons: ['需要用户授权'],
    }) }] });
    const service = new TaskJudgeService({
      sessionStore: { loadMessages: async () => [], loadTranscriptRows: async () => [] },
      modelManager: { getModelForSession: () => 'test/model' }, getConfig: () => undefined,
    } as unknown as ConstructorParameters<typeof TaskJudgeService>[0]);
    await service.reviewTurn({ conversationId: 'conversation', channel: 'webchat', chatId: 'chat', assistantPlainText: 'English source context', aborted: false });
    expect(complete.mock.calls.at(-1)![1].messages[0].content).toContain('Write all user-facing prose in Simplified Chinese.');
    expect(createWait).toHaveBeenCalledWith(expect.objectContaining({ reason: '请确认授权范围。', condition: { question: '是否允许同步到 Slack？' } }));
  });

});
