import { describe, expect, it } from 'vitest';

import { buildWorkChatHandoffUrl } from '../work-chat-handoff';

describe('buildWorkChatHandoffUrl', () => {
  it('opens a new chat and auto-sends the exact trimmed intent', () => {
    const url = buildWorkChatHandoffUrl('  整理会议记录\n并给出下一步  ');
    const [pathname, query = ''] = url.split('?');
    const search = new URLSearchParams(query);

    expect(pathname).toBe('/chat/new');
    expect(search.get('draft')).toBe('整理会议记录\n并给出下一步');
    expect(search.get('autoSend')).toBe('1');
  });

  it('opens an empty conversation when the intent is blank', () => {
    expect(buildWorkChatHandoffUrl('   ')).toBe('/chat/new');
  });
});
