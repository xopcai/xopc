import { describe, expect, it } from 'vitest';
import { stripUserMessageForDisplay } from '../entry/src/main/ets/common/chatDisplay.ets';
import { stripUserMessageForDisplay as reference } from '../../mobile-expo/src/features/chat/wire-text-scrub';
import { historyRows } from '../entry/src/main/ets/common/chatProtocol.ets';

const samples = [
  '看看这张图\n\n[Image description: a red flower]',
  '[Image description: a red flower]',
  'hello\n\n[2 image(s) attached; no image-capable model is available to describe them.]',
  'hello\n\n[1 image(s) attached but could not be described: timeout]',
  '<file path="README.md">\n# Expanded\n</file>\n\n@file:README.md summarize',
  '[Startup context loaded by runtime]\nprivate notes\nEND_QUOTED_NOTES\n\nhello',
  '<user-profile>private profile</user-profile>\n[2026-09-18 12:00 UTC] hello',
  '<user-profile>user authored XML</user-profile>\nhello',
  '<user-context>unfinished user text',
  '<source_contexts>snapshot</source_contexts>\n<user_message>\nhello\n</user_message>',
  'before\n## Skill: example\nexpanded instructions\n**Arguments**: hello\nafter',
  'look\n[media attached: photo]\nxopc-media-uri: media://photo\nxopc-media-path: photo.png\nUse the read_media tool to inspect',
  'ordinary text with no generated context',
];
describe('RN user display contract', () => {
  it.each(samples)('matches RN for %s', text => {
    expect(stripUserMessageForDisplay(text)).toBe(reference(text));
  });
  it('scrubs user rows, preserves images and does not rewrite assistant or stored input', () => {
    const text = samples[0];
    const input = { session: { key: 's', messages: [
      { id: 'u', role: 'user', content: text, media: [{ id: 'img', uri: 'media://img', type: 'image', name: 'img', mimeType: 'image/png', size: 1 }] },
      { id: 'a', role: 'assistant', content: text },
    ] }, pagination: { hasMore: false } };
    const rows = historyRows(input);
    expect(rows[0].text).toBe('看看这张图'); expect(rows[0].media).toHaveLength(1);
    expect(rows[1].text).toBe(text); expect(input.session.messages[0].content).toBe(text);
  });
});
