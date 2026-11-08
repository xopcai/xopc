import { describe, expect, it, vi } from 'vitest';

import { collectTuiClarification, type TuiClarification } from '../tui-clarification.js';

const question: TuiClarification = { id: 'question', version: 2, conversationId: 'A', kind: 'input', question: 'Choose',
  choiceDetails: [{ id: 'one', label: 'First' }, { id: 'two', label: 'Second' }] };

describe('TUI structured clarification', () => {
  it('submits stable choice identity, version and idempotency key', async () => {
    const response = await collectTuiClarification(question, {
      choose: vi.fn(async (_title, options) => options[1]), input: vi.fn(),
    });
    expect(response).toMatchObject({ action: 'answer', expectedVersion: 2, response: { choiceId: 'two' } });
    expect(response.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('requires an explicit approval and defaults to denial', async () => {
    const approval: TuiClarification = { ...question, kind: 'approval', choiceDetails: undefined,
      approval: { operation: 'Delete exact file', target: '/workspace/file', argumentsPreview: { path: '/workspace/file' } } };
    const choose = vi.fn(async (_title: string, options: string[]) => options[0]);
    const response = await collectTuiClarification(approval, { choose, input: vi.fn() });
    expect(response).toMatchObject({ action: 'answer', decision: 'deny' });
    expect(choose.mock.calls[0]![0]).toContain('/workspace/file');
    expect(response.response).toBeUndefined();
  });

  it('cancels without granting approval when the dialog is dismissed', async () => {
    const response = await collectTuiClarification({ ...question, kind: 'approval', choiceDetails: undefined,
      approval: { operation: 'Publish' } }, { choose: vi.fn(), input: vi.fn() });
    expect(response.action).toBe('cancel');
    expect(response.decision).toBeUndefined();
  });

  it('collects independent batch answers together', async () => {
    const response = await collectTuiClarification({ ...question, schemaVersion: 2, choiceDetails: undefined,
      questions: [{ id: 'direction', header: 'Direction', question: 'Where?', type: 'text' },
        { id: 'style', header: 'Style', question: 'Which?', type: 'single_choice', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }] },
    { choose: vi.fn(async (_title, options) => options[0]), input: vi.fn(async () => 'north') });
    expect(response).toMatchObject({ schemaVersion: 2, answers: [{ questionId: 'direction', text: 'north' }, { questionId: 'style', choiceId: 'a' }] });
  });

  it('does not open an expired approval', async () => {
    const choose = vi.fn();
    await expect(collectTuiClarification({ ...question, expiresAt: 1 }, { choose, input: vi.fn() })).rejects.toThrow('expired');
    expect(choose).not.toHaveBeenCalled();
  });
});
