import { describe, expect, it } from 'vitest';

import {
  stripMediaClaimCheck,
  stripRuntimeUserMessageEnvelope,
  stripSourceContextsEnvelope,
} from './user-message-display.js';

describe('stripRuntimeUserMessageEnvelope', () => {
  it('removes generated profile context and its envelope timestamp', () => {
    expect(stripRuntimeUserMessageEnvelope([
      '<user-profile>',
      'Preferred name: micjoyce',
      'Timezone: Asia/Shanghai',
      '</user-profile>',
      '',
      '[2026-08-30 13:54 GMT+8] 看下note 内容',
    ].join('\n'))).toBe('看下note 内容');
  });

  it('removes task, source, and selected user-context blocks together', () => {
    expect(stripRuntimeUserMessageEnvelope([
      '<xopc_task_execution>',
      'Task: Review',
      '</xopc_task_execution>',
      '',
      '<source_contexts>',
      '<source_context kind="note" id="n1" version="1">Note</source_context>',
      '</source_contexts>',
      '',
      '<user_message>',
      '<active-focuses>',
      '- Ship it',
      '</active-focuses>',
      '',
      '[2026-08-30 13:54 GMT+8] Review this',
      '</user_message>',
    ].join('\n'))).toBe('Review this');
  });

  it('keeps user-authored profile XML without a runtime timestamp', () => {
    const authored = '<user-profile>\nExample\n</user-profile>\n\nExplain this XML';
    expect(stripRuntimeUserMessageEnvelope(authored)).toBe(authored);
  });

  it('removes legacy untagged execution context from persisted messages', () => {
    expect(stripRuntimeUserMessageEnvelope([
      'Relevant user facts:',
      '- Prefers concise replies.',
      '',
      'Active goals:',
      '- Ship the release: Finish the work.',
      '',
      '[2026-09-08 00:59 GMT+8] Complete the note',
    ].join('\n'))).toBe('Complete the note');
  });

  it('preserves user-authored text that starts with a legacy heading', () => {
    const authored = '[2026-09-08 00:59 GMT+8] Relevant user facts:\n- Example for review';
    expect(stripRuntimeUserMessageEnvelope(authored)).toBe('Relevant user facts:\n- Example for review');
  });
});

describe('stripSourceContextsEnvelope', () => {
  it('unwraps a source-backed message even when no timestamp is present', () => {
    const text = '<source_contexts>\nNote\n</source_contexts>\n\n<user_message>\nSummarize\n</user_message>';
    expect(stripSourceContextsEnvelope(text)).toBe('Summarize');
  });
});

describe('stripMediaClaimCheck', () => {
  it('removes the canonical media block while preserving user text', () => {
    const text = [
      '讲一个故事',
      '[media attached: recording.m4a (audio/mp4, 44355 bytes)]',
      'xopc-media-uri:media://inbound/recording.m4a',
      'xopc-media-path:/home/admin/.xopc/media/inbound/recording.m4a',
      'Use the read_media tool with the xopc-media-uri value when you need to inspect this attachment.',
    ].join('\n');

    expect(stripMediaClaimCheck(text)).toBe('讲一个故事');
  });

  it('removes a media-only block completely', () => {
    const text = [
      '[media attached: recording.m4a (audio/mp4, 44355 bytes)]',
      'xopc-media-uri:media://inbound/recording.m4a',
      'xopc-media-path:/home/admin/.xopc/media/inbound/recording.m4a',
      'Use the read_media tool with the xopc-media-uri value when you need to inspect this attachment.',
    ].join('\n');

    expect(stripMediaClaimCheck(text)).toBe('');
  });
});
