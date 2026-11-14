import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(new URL('../entry/src/main/ets/view/ChatView.ets', import.meta.url), 'utf8');

describe('conversation draft restoration', () => {
  it('retries composer focus safely while the new chat becomes visible', () => {
    expect(chat).toContain("requestFocus('chat-composer')");
    expect(chat).toContain('this.composerFocusAttempts < 4');
    expect(chat).toContain('catch (_)');
    expect(chat).toContain('this.focusComposerOnMount = false; this.composerFocusAttempts = 0;');
  });

  it('keeps the target-chat prompt available through tab restoration', () => {
    expect(chat).toContain("if (!value && this.chat.selectedId === this.requestedId) value = this.intakeText");
    expect(chat).toContain('this.chat.selectedId !== this.requestedId');
    expect(chat).toContain('this.draftScope !== targetScope');
    expect(chat).toContain('this.intakeTimer = setTimeout');
  });

});
