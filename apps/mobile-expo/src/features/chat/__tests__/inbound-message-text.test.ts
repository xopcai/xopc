import { describe, expect, it } from 'vitest';

import {
  extractAttachmentsFromUserContent,
  stripInboundFileMachineText,
} from '../inbound-message-text';

describe('stripInboundFileMachineText', () => {
  it('removes inbound file machine lines from user text', () => {
    const raw =
      '讲一个笑话。\n[File: voice.m4a (audio/mp4, 44355 bytes)]\nxopc-path:rel:inbound/s/voice.m4a\nxopc-path:abs:/root/.xopc/agents/main/inbound/s/voice.m4a';
    expect(stripInboundFileMachineText(raw)).toBe('讲一个笑话。');
  });
});

describe('extractAttachmentsFromUserContent', () => {
  it('parses workspace-relative voice paths from persisted content', () => {
    const content = [
      {
        type: 'text',
        text: '讲一个笑话。\n[File: voice.m4a (audio/mp4, 44355 bytes)]\nxopc-path:rel:inbound/s/voice.m4a\nxopc-path:abs:/abs/voice.m4a',
      },
    ];
    const atts = extractAttachmentsFromUserContent(content);
    expect(atts).toHaveLength(1);
    expect(atts?.[0].workspaceRelativePath).toBe('inbound/s/voice.m4a');
    expect(atts?.[0].type).toBe('voice');
    expect(atts?.[0].mimeType).toBe('audio/mp4');
  });
});
