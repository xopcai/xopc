// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./agent-avatar-dicebear', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

import { AgentAvatarDisplay } from './agent-avatar-display';

describe('AgentAvatarDisplay', () => {
  it('keeps the fallback avatar when the DiceBear chunk cannot load', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);

    try {
      await act(async () => {
        root.render(<AgentAvatarDisplay agentId="agent-1" />);
      });

      expect(container.querySelector('img')?.src).toMatch(/^data:image\/svg\+xml,/);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
