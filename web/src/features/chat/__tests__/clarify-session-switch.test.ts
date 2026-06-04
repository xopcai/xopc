// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';

import {
  clearClarifyPromptSnapshot,
  readClarifyPromptSnapshot,
  writeClarifyPromptSnapshot,
} from '@/features/chat/clarify/clarify-prompt-storage';

describe('clarify session switch persistence', () => {
  const sessionA = 'agent:main:webchat:default:direct:a';
  const sessionB = 'agent:main:webchat:default:direct:b';
  const promptA = {
    requestId: 'req-a',
    question: 'Pick one?',
    choices: ['Yes', 'No'],
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps session A clarify when switching away and back', () => {
    writeClarifyPromptSnapshot(sessionA, promptA);
    expect(readClarifyPromptSnapshot(sessionA)).toEqual(promptA);
    expect(readClarifyPromptSnapshot(sessionB)).toBeNull();

    writeClarifyPromptSnapshot(sessionB, { requestId: 'req-b', question: 'Other?' });
    expect(readClarifyPromptSnapshot(sessionA)).toEqual(promptA);

    clearClarifyPromptSnapshot(sessionB);
    expect(readClarifyPromptSnapshot(sessionA)).toEqual(promptA);
  });
});
