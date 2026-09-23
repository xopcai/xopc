import { describe, expect, it } from 'vitest';

import {
  buildChatPreviewSrcDoc,
  parseChatPreviewRuntimeMessage,
} from './runtime';

describe('chat preview runtime', () => {
  it('builds an isolated document without network access', () => {
    const sourceHash = 'a'.repeat(64);
    const doc = buildChatPreviewSrcDoc({
      previewId: crypto.randomUUID(),
      sourceHash,
      markup: '<main>Login</main>',
      styles: 'main { color: red; }',
      script: "console.log('</script>')",
      createdAt: 1,
    }, crypto.randomUUID());
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain('<main>Login</main>');
    expect(doc).not.toContain("console.log('</script>')");
  });

  it('rejects unversioned and malformed runtime messages', () => {
    const channel = crypto.randomUUID();
    expect(parseChatPreviewRuntimeMessage({
      source: 'xopc-chat-preview', version: 1, channel, type: 'ready',
    })?.type).toBe('ready');
    expect(parseChatPreviewRuntimeMessage({
      source: 'xopc-chat-preview', channel, type: 'ready',
    })).toBeNull();
  });
});
