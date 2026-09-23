import { describe, expect, it } from 'vitest';

import {
  CHAT_PREVIEW_MAX_SOURCE_SIZE,
  ChatPreviewCreateInputSchema,
  ChatPreviewRuntimeMessageSchema,
} from './chat-previews.js';

describe('chat preview contract', () => {
  it('bounds source size and applies safe defaults', () => {
    expect(ChatPreviewCreateInputSchema.parse({ title: 'Login', markup: '<main />' }))
      .toMatchObject({ styles: '', script: '', preferredHeight: 480 });
    expect(ChatPreviewCreateInputSchema.safeParse({
      title: 'Too large',
      markup: 'x'.repeat(CHAT_PREVIEW_MAX_SOURCE_SIZE),
      styles: 'x',
    }).success).toBe(false);
    expect(ChatPreviewCreateInputSchema.safeParse({
      title: 'Inline script', markup: '<script>alert(1)</script>',
    }).success).toBe(false);
  });

  it('accepts only versioned, channel-bound runtime messages', () => {
    const channel = crypto.randomUUID();
    expect(ChatPreviewRuntimeMessageSchema.safeParse({
      source: 'xopc-chat-preview', version: 1, channel, type: 'ready',
    }).success).toBe(true);
    expect(ChatPreviewRuntimeMessageSchema.safeParse({
      source: 'xopc-chat-preview', version: 2, channel, type: 'ready',
    }).success).toBe(false);
  });
});
