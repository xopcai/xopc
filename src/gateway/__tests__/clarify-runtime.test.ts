import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  answerClarificationChoiceFromChannel,
  answerClarificationTextFromChannel,
  registerClarificationChannelRuntime,
} from '../clarify-runtime.js';

afterEach(() => registerClarificationChannelRuntime(null));

describe('clarification channel runtime', () => {
  it('forwards durable channel answers with their idempotency keys', () => {
    const answerChoice = vi.fn(() => true);
    const answerText = vi.fn(() => true);
    registerClarificationChannelRuntime({ answerChoice, answerText });

    expect(answerClarificationChoiceFromChannel('wait-1', 1, 'callback-1')).toBe(true);
    expect(answerClarificationTextFromChannel('session-1', 'Production', 'message-1')).toBe(true);
    expect(answerChoice).toHaveBeenCalledWith('wait-1', 1, 'callback-1');
    expect(answerText).toHaveBeenCalledWith('session-1', 'Production', 'message-1');
  });

  it('does not consume messages when no gateway runtime is active', () => {
    expect(answerClarificationTextFromChannel('session-1', 'hello', 'message-1')).toBe(false);
  });
});
