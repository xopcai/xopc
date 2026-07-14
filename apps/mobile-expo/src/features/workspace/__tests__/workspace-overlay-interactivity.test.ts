import { describe, expect, it } from 'vitest';

import { isWorkspaceChatOverlayInteractive } from '../workspace-overlay-interactivity';

describe('isWorkspaceChatOverlayInteractive', () => {
  it('stops receiving touches as soon as the overlay starts closing', () => {
    expect(isWorkspaceChatOverlayInteractive('closing')).toBe(false);
  });

  it.each(['opening', 'open'] as const)('keeps the visible overlay interactive while %s', (phase) => {
    expect(isWorkspaceChatOverlayInteractive(phase)).toBe(true);
  });

  it('does not receive touches when closed', () => {
    expect(isWorkspaceChatOverlayInteractive('closed')).toBe(false);
  });
});
