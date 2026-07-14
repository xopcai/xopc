import { describe, expect, it } from 'vitest';

import { desktopPetWindowTarget } from '../desktop-pet-window-target';

describe('desktop pet main-window target', () => {
  it('does not navigate when opening the app from an idle pet', () => {
    expect(desktopPetWindowTarget()).toBeUndefined();
  });

  it('navigates to the session only when opening a session activity', () => {
    expect(desktopPetWindowTarget({ sessionKey: 'agent:main:webchat:task-1' })).toBe(
      '/chat/agent:main:webchat:task-1',
    );
  });
});
