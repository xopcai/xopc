// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UpdateReminderBar } from '../update-reminder-bar';
import { useUpdateReminder } from '../use-update-reminder';
import { useLocaleStore } from '@/stores/locale-store';

const mocks = vi.hoisted(() => ({ check: vi.fn(), status: { state: 'error', message: '' } }));
vi.mock('../use-update-status', () => ({
  NPM_PENDING_RESTART_KEY: 'test.pendingRestart',
  npmUpdateRestartIsAutomatic: () => false,
  useUpdateStatus: () => ({
    npm: null,
    electron: mocks.status,
    isElectron: true,
    electronCheck: mocks.check,
    electronQuitAndInstall: vi.fn(),
    runNpmUpdate: vi.fn(),
    npmUpdateRunning: false,
  }),
}));

function Reminder() {
  return <UpdateReminderBar reminder={useUpdateReminder()} />;
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'zh' });
  localStorage.clear();
  mocks.check.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderError(message: string) {
  mocks.status = { state: 'error', message };
  act(() => root.render(<Reminder />));
}

describe('desktop update error reminder', () => {
  it.each(['net::ERR_CONNECTION_CLOSED', 'connect ECONNRESET', 'Request timed out'])('explains network failures and offers a real recheck: %s', (message) => {
    renderError(message);
    const status = container.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('暂时无法连接更新服务');
    expect(status.textContent).toContain('继续使用当前版本');
    expect(status.textContent).not.toContain(message);
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('pre')?.textContent).toBe(message);
    const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '重试')!;
    act(() => retry.click());
    expect(mocks.check).toHaveBeenCalledOnce();
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="关闭"]')!.click());
    expect(container.textContent).toBe('');
  });

  it('keeps complete diagnostics collapsed for an unknown failure', () => {
    const message = `Signature validation failed: ${'diagnostic '.repeat(40)}`.trim();
    renderError(message);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('暂时无法完成更新');
    expect(container.querySelector('details')?.open).toBe(false);
    expect(container.querySelector('pre')?.textContent).toBe(message);
  });

  it('still shows recovery actions when the updater supplies no message', () => {
    renderError('');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('暂时无法完成更新');
    expect(container.querySelector('details')).toBeNull();
    expect(container.textContent).toContain('重试');
  });

  it('provides an English recovery message', () => {
    useLocaleStore.setState({ language: 'en' });
    renderError('net::ERR_CONNECTION_CLOSED');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Unable to reach the update service');
    expect(container.textContent).toContain('Retry');
  });
});
