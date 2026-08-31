import { describe, expect, it } from 'vitest';

import { shouldRefreshSidebarForTranscriptUpdate } from '@/components/shell/sidebar-session-refresh';

describe('shouldRefreshSidebarForTranscriptUpdate', () => {
  const visibleKeys = new Set(['agent:main:webchat:visible']);

  it('refreshes when transcript persistence makes a previously hidden session visible', () => {
    expect(shouldRefreshSidebarForTranscriptUpdate(
      { key: 'agent:main:webchat:new' },
      visibleKeys,
    )).toBe(true);
  });

  it('does not reload the entire sidebar for transcript updates to a visible session', () => {
    expect(shouldRefreshSidebarForTranscriptUpdate(
      { key: 'agent:main:webchat:visible' },
      visibleKeys,
    )).toBe(false);
  });

  it('refreshes defensively when an event has no usable session key', () => {
    expect(shouldRefreshSidebarForTranscriptUpdate({}, visibleKeys)).toBe(true);
  });
});
