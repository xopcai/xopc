import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

import { collectMediaUrisFromMessages, messagesReferenceMediaUri } from '../session-references.js';

describe('session media references', () => {
  it('finds generated media nested in tool result details', () => {
    const uri = 'media://outbound/generated---id.jpg';
    const messages = [{
      role: 'toolResult',
      toolCallId: 'call-image',
      toolName: 'image_generate',
      content: [{ type: 'text', text: 'Generated and attached 1 image.' }],
      details: {
        provider: 'test',
        media: [{ uri, mimeType: 'image/jpeg' }],
      },
      isError: false,
      timestamp: Date.now(),
    }] as unknown as AgentMessage[];

    expect(messagesReferenceMediaUri(messages, uri)).toBe(true);
  });

  it('walks nested message values once and ignores unrelated strings', () => {
    const first = 'media://outbound/first.jpg';
    const second = 'media://inbound/second.png';
    const shared: Record<string, unknown> = { uri: second };
    shared.cycle = shared;
    const messages = [{
      role: 'assistant',
      content: [{ type: 'image', source: { data: first } }],
      metadata: { shared },
      timestamp: Date.now(),
    }] as unknown as AgentMessage[];

    expect([...collectMediaUrisFromMessages(messages)].sort()).toEqual([first, second].sort());
  });
});
