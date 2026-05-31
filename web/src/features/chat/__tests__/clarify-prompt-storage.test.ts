// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';

import {
  clearClarifyPromptSnapshot,
  readClarifyPromptSnapshot,
  writeClarifyPromptSnapshot,
} from '@/features/chat/clarify/clarify-prompt-storage';

describe('clarify-prompt-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('roundtrips clarify prompt per session', () => {
    const prompt = {
      requestId: 'req-1',
      question: 'Which option?',
      choices: ['A', 'B'],
      default: 'A',
    };
    writeClarifyPromptSnapshot('session-a', prompt);
    expect(readClarifyPromptSnapshot('session-a')).toEqual(prompt);
  });

  it('isolates keys per session', () => {
    writeClarifyPromptSnapshot('a', { requestId: '1', question: 'Qa' });
    writeClarifyPromptSnapshot('b', { requestId: '2', question: 'Qb' });
    expect(readClarifyPromptSnapshot('a')?.question).toBe('Qa');
    expect(readClarifyPromptSnapshot('b')?.question).toBe('Qb');
  });

  it('clearClarifyPromptSnapshot removes key', () => {
    writeClarifyPromptSnapshot('z', { requestId: '1', question: 'Q' });
    clearClarifyPromptSnapshot('z');
    expect(readClarifyPromptSnapshot('z')).toBeNull();
  });
});
