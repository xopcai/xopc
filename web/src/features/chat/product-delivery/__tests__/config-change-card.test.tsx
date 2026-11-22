// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: mock.fetch }));
vi.mock('@/lib/url', () => ({ apiUrl: (path: string) => path }));

import { ConfigChangeCard } from '../config-change-card';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.clearAllMocks();
  mock.fetch.mockResolvedValue({ ok: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('renders before/after self-config changes and supports one-click rollback', async () => {
  await act(async () => root.render(
    <ul>
      <ConfigChangeCard
        language="zh"
        presentation={{
          kind: 'config_change',
          changeId: 'chg-avatar-1',
          tier: 1,
          target: 'user.avatar',
          title: '用户头像',
          canRollback: true,
          changes: [{ field: 'avatar', before: 'none', after: 'image/png' }],
        }}
      />
    </ul>,
  ));

  expect(container.textContent).toContain('用户头像');
  expect(container.textContent).toContain('分级 T1');
  expect(container.textContent).toContain('image/png');

  const undoBtn = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('撤销'))!;
  await act(async () => undoBtn.click());
  expect(mock.fetch).toHaveBeenCalledWith('/api/self-config/changes/chg-avatar-1/rollback', { method: 'POST' });
  expect(container.textContent).toContain('已撤销');
});
