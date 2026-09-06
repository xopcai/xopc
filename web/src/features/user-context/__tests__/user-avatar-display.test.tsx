// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchUserProfile } = vi.hoisted(() => ({ fetchUserProfile: vi.fn() }));
vi.mock('../user-context-api', () => ({ fetchUserProfile }));

import { bumpUserAvatarCacheRevision } from '../user-avatar-cache';
import { UserAvatarDisplay } from '../user-avatar-display';

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fetchUserProfile.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <UserAvatarDisplay callName="Mic" />
    </SWRConfig>,
  ));
}

describe('user avatar display', () => {
  it('does not request an image before confirming an avatar exists', async () => {
    let resolveProfile!: (value: { hasAvatar: boolean }) => void;
    fetchUserProfile.mockReturnValue(new Promise((resolve) => { resolveProfile = resolve; }));
    await render();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('M');
    await act(async () => resolveProfile({ hasAvatar: false }));
    expect(container.querySelector('img')).toBeNull();
  });

  it('refreshes avatar presence after uploading and deleting', async () => {
    fetchUserProfile.mockResolvedValue({ hasAvatar: false });
    await render();
    expect(container.querySelector('img')).toBeNull();

    fetchUserProfile.mockResolvedValue({ hasAvatar: true });
    await act(async () => { bumpUserAvatarCacheRevision(true); });
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/api/you/avatar?');

    fetchUserProfile.mockResolvedValue({ hasAvatar: false });
    await act(async () => { bumpUserAvatarCacheRevision(false); });
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('M');
  });
});
