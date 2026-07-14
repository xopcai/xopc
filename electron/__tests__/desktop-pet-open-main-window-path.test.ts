import { describe, expect, it } from 'vitest';

import { resolveDesktopPetMainWindowPath } from '../desktop-pet/open-main-window-path.js';

describe('desktop pet main-window navigation', () => {
  it('does not turn a plain pet click into chat navigation', () => {
    expect(resolveDesktopPetMainWindowPath(undefined)).toBeUndefined();
  });

  it('keeps an explicit session route for activity entries', () => {
    expect(resolveDesktopPetMainWindowPath('/chat/agent%3Amain%3Awebchat')).toBe(
      '/chat/agent%3Amain%3Awebchat',
    );
  });
});
