import { describe, expect, it } from 'vitest';

import { capAttachments, MAX_CHAT_ATTACHMENTS } from '../chat-limits';
import { composerAttachmentsToWire } from '../composer.types';
import {
  estimateComposerInputHeight,
  MAX_COMPOSER_INPUT_HEIGHT,
  MIN_COMPOSER_INPUT_HEIGHT,
} from '../composer-layout';
import {
  buildOptimisticUserMessage,
  buildUserMessageContent,
  buildUserResendPayload,
  canSendComposerDraft,
  extractUserMessageText,
  findPrecedingUserMessage,
  isLastAssistantMessage,
  wireAttachmentsToMessageAttachments,
} from '../composer-send-helpers';

describe('composerAttachmentsToWire', () => {
  it('maps composer attachments to gateway wire shape', () => {
    const wire = composerAttachmentsToWire([
      {
        id: 'a1',
        type: 'image',
        name: 'pic.png',
        mimeType: 'image/png',
        size: 12,
        content: 'YWJj',
      },
    ]);
    expect(wire).toEqual([
      {
        type: 'image',
        mimeType: 'image/png',
        data: 'YWJj',
        name: 'pic.png',
        size: 12,
      },
    ]);
  });

  it('omits empty data when workspaceRelativePath is present', () => {
    const wire = composerAttachmentsToWire([
      {
        id: 'a2',
        type: 'document',
        name: 'doc.pdf',
        mimeType: 'application/pdf',
        size: 100,
        content: '',
        workspaceRelativePath: 'inbound/n/doc.pdf',
      },
    ]);
    expect(wire).toEqual([
      {
        type: 'document',
        mimeType: 'application/pdf',
        name: 'doc.pdf',
        size: 100,
        workspaceRelativePath: 'inbound/n/doc.pdf',
      },
    ]);
  });
});

describe('capAttachments', () => {
  it('truncates to MAX_CHAT_ATTACHMENTS', () => {
    const items = Array.from({ length: MAX_CHAT_ATTACHMENTS + 3 }, (_, i) => i);
    const capped = capAttachments(items);
    expect(capped).toHaveLength(MAX_CHAT_ATTACHMENTS);
  });
});

describe('canSendComposerDraft', () => {
  it('allows text-only, attachment-only, or both', () => {
    expect(canSendComposerDraft('', 0)).toBe(false);
    expect(canSendComposerDraft('hi', 0)).toBe(true);
    expect(canSendComposerDraft('  ', 1)).toBe(true);
    expect(canSendComposerDraft('', 1)).toBe(true);
  });
});

describe('estimateComposerInputHeight', () => {
  it('keeps short drafts at the compact height', () => {
    expect(estimateComposerInputHeight('hi', 320)).toBe(MIN_COMPOSER_INPUT_HEIGHT);
  });

  it('expands long recommendation drafts before native content-size events fire', () => {
    const height = estimateComposerInputHeight(
      '根据我的日程和待办，帮我规划接下来优先做什么，并说明每件事为什么应该现在处理',
      280,
    );

    expect(height).toBeGreaterThan(MIN_COMPOSER_INPUT_HEIGHT);
    expect(height).toBeLessThanOrEqual(MAX_COMPOSER_INPUT_HEIGHT);
  });
});

describe('buildOptimisticUserMessage', () => {
  it('builds user-with-attachments with image blocks', () => {
    const msg = buildOptimisticUserMessage('hello', [
      { type: 'image', mimeType: 'image/png', data: 'YWJj', name: 'a.png', size: 3 },
    ]);
    expect(msg.role).toBe('user-with-attachments');
    expect(msg.content.some((b) => b.type === 'text')).toBe(true);
    expect(msg.content.some((b) => b.type === 'image')).toBe(true);
    expect(msg.attachments?.length).toBe(1);
  });

  it('wireAttachmentsToMessageAttachments sets preview for images', () => {
    const atts = wireAttachmentsToMessageAttachments([
      { type: 'image', mimeType: 'image/jpeg', data: 'qqq', name: 'x.jpg' },
    ]);
    expect(atts[0].preview).toBe('qqq');
  });
});

describe('buildUserMessageContent', () => {
  it('skips non-image attachments in content blocks', () => {
    const blocks = buildUserMessageContent('x', [
      { type: 'document', mimeType: 'application/pdf', data: 'pdf', name: 'f.pdf' },
    ]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('text');
  });
});

describe('assistant regenerate helpers', () => {
  const messages = [
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'hello' }] },
    { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hi there' }] },
    { role: 'user' as const, content: [{ type: 'text' as const, text: 'again' }] },
    { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'sure' }] },
  ];

  it('extractUserMessageText strips envelope timestamps', () => {
    expect(
      extractUserMessageText([{ type: 'text', text: '[2026-05-22 10:00 UTC] hello' }]),
    ).toBe('hello');
  });

  it('findPrecedingUserMessage walks backward to the nearest user turn', () => {
    expect(findPrecedingUserMessage(messages, 3)?.content[0]).toEqual({ type: 'text', text: 'again' });
    expect(findPrecedingUserMessage(messages, 1)?.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('buildUserResendPayload returns text for user messages', () => {
    expect(buildUserResendPayload(messages[2])).toEqual({ text: 'again', attachments: undefined });
  });

  it('isLastAssistantMessage only matches the final assistant row', () => {
    expect(isLastAssistantMessage(messages, 1)).toBe(false);
    expect(isLastAssistantMessage(messages, 3)).toBe(true);
  });
});
