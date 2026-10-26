// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('../phone-live-api', async original => ({ ...await original<typeof import('../phone-live-api')>(), useConversationPhone: vi.fn() }));
vi.mock('../phone-live-panel', () => ({ PhoneLivePanel: ({ conversationId, state, headerActions }: { conversationId: string; state: PhoneLiveState; headerActions?: import('react').ReactNode }) => <div data-conversation={conversationId}>{state.report.deviceName}{headerActions}</div> }));

import { fetchJson } from '@/lib/fetch';
import { useLocaleStore } from '@/stores/locale-store';
import { useRightWorkspaceStore } from '@/stores/right-workspace-store';
import { GlobalPhoneWorkspace, phoneOccupancy } from '../global-phone-workspace';
import { phoneErrorMessage, useConversationPhone, type PhoneLiveState } from '../phone-live-api';
import { usePhoneWorkspaceStore } from '../phone-workspace-store';
import { phoneWindowWidthLimits, clampPhoneWindowPosition } from '../use-phone-window-layout';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const chatA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const chatB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const report = { sessionId: 'session-a', deviceId: 'device-a', owner: chatA, deviceName: 'Phone A', agentId: 'main', modelRef: 'phone/model', status: 'ready', mode: 'control', controlOwner: 'none', updatedAt: 1, actions: 0, modelRequests: 0 } satisfies PhoneLiveState['report'];
let phones: Record<string, PhoneLiveState | null>;
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
beforeEach(() => {
  useLocaleStore.setState({ language: 'zh' });
  useRightWorkspaceStore.getState().reset();
  usePhoneWorkspaceStore.setState({ open: false, selected: null, displayMode: 'docked', position: null, controlConversationId: null });
  phones = { [chatA]: { report, ownControl: false, frame: null }, [chatB]: null };
  vi.mocked(useConversationPhone).mockImplementation(id => ({ data: phones[id], mutate: vi.fn(), isLoading: false }) as unknown as ReturnType<typeof useConversationPhone>);
});
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; container?.remove(); vi.clearAllMocks(); });
async function render(conversationId: string | null = chatA) {
  if (!root) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(<GlobalPhoneWorkspace conversationId={conversationId} />));
}
async function openPhone(id = report.deviceId, owner = chatA) {
  await act(async () => usePhoneWorkspaceStore.getState().show(id, true, owner));
}

it('only opens a phone from its chat and has no global phone launcher', async () => {
  await render();
  expect(document.querySelector('[data-phone-window]')).toBeNull();
  expect(document.querySelector('[aria-label="全局手机连接"]')).toBeNull();
  await openPhone();
  expect(document.querySelector('[data-conversation]')?.getAttribute('data-conversation')).toBe(chatA);
  expect(document.body.textContent).toContain('Phone A');
  await act(async () => (document.querySelector('[aria-label="收起手机，保持连接"]') as HTMLButtonElement).click());
  expect(usePhoneWorkspaceStore.getState().open).toBe(false);
  expect(fetchJson).not.toHaveBeenCalled();
});

it.each(['docked', 'floating'] as const)('removes the %s phone when switching to a chat without phone use', async displayMode => {
  usePhoneWorkspaceStore.setState({ displayMode });
  await render(); await openPhone();
  expect(document.querySelector('[data-phone-window]')).not.toBeNull();
  await render(chatB);
  expect(document.querySelector('[data-phone-window]')).toBeNull();
  expect(document.body.textContent).not.toContain('Phone A');
  expect(useRightWorkspaceStore.getState().panes[chatB]?.tabs.some(tab => tab.kind === 'phone') ?? false).toBe(false);
  await render();
  expect(document.querySelector('[data-conversation]')?.getAttribute('data-conversation')).toBe(chatA);
});

it('does not reuse the previous chat phone when another chat has its own phone', async () => {
  phones[chatB] = { report: { ...report, sessionId: 'session-b', deviceId: 'device-b', owner: chatB, deviceName: 'Phone B' }, ownControl: false, frame: null };
  await render(); await openPhone();
  await render(chatB);
  expect(document.querySelector('[data-phone-window]')).toBeNull();
  await openPhone('device-b', chatB);
  expect(document.body.textContent).toContain('Phone B');
  expect(document.body.textContent).not.toContain('Phone A');
  expect(document.querySelector('[data-conversation]')?.getAttribute('data-conversation')).toBe(chatB);
  expect(document.querySelector('[role="tablist"]')).toBeNull();
});

it('does not mount a phone on non-chat pages even when a floating window was open', async () => {
  usePhoneWorkspaceStore.setState({ displayMode: 'floating' });
  await render(); await openPhone();
  await render(null);
  expect(document.querySelector('[data-phone-window]')).toBeNull();
});

it('clears the old view when the current chat no longer has an active phone', async () => {
  await render(); await openPhone();
  phones[chatA] = null;
  await render();
  expect(document.querySelector('[data-phone-window]')).toBeNull();
});

it('does not open a panel or acquire control for an assistance request', async () => {
  phones[chatA] = { report: { ...report, status: 'needs_user', assistanceId: 'request', message: 'Complete login' }, ownControl: false, frame: null };
  await render();
  expect(usePhoneWorkspaceStore.getState().open).toBe(false);
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(fetchJson).not.toHaveBeenCalled();
});

it('switches docked and floating layouts without remounting the current chat phone', async () => {
  await render(); await openPhone();
  const window = document.querySelector('[data-phone-window]')!;
  const preview = window.querySelector('[data-conversation]');
  await act(async () => (document.querySelector('[aria-label="小窗显示"]') as HTMLButtonElement).click());
  expect(window.getAttribute('data-display-mode')).toBe('floating');
  expect(window.querySelector('[data-conversation]')).toBe(preview);
  await act(async () => (document.querySelector('[aria-label="停靠到右侧"]') as HTMLButtonElement).click());
  expect(window.getAttribute('data-display-mode')).toBe('docked');
  expect(window.querySelector('[data-conversation]')).toBe(preview);
});

it('replaces an obsolete phone tab only within the source chat after recovery', async () => {
  useRightWorkspaceStore.getState().openPhone('old-session', 'Phone A', chatA, false, false);
  useRightWorkspaceStore.getState().openPhone('other-session', 'Phone B', chatB, false, false);
  await render(); await openPhone();
  expect(useRightWorkspaceStore.getState().panes[chatA].tabs.filter(tab => tab.kind === 'phone')).toMatchObject([{ phoneSessionId: 'device-a' }]);
  expect(useRightWorkspaceStore.getState().panes[chatB].tabs.filter(tab => tab.kind === 'phone')).toMatchObject([{ phoneSessionId: 'other-session' }]);
});

it('distinguishes task ownership and actionable errors', () => {
  expect(phoneOccupancy(report, true)).toBe('已连接 · 空闲');
  expect(phoneOccupancy({ ...report, controlOwner: 'agent' }, true)).toBe('聊天任务占用中');
  expect(phoneOccupancy({ ...report, controlOwner: 'human' }, true)).toBe('人工操作中');
  expect(phoneErrorMessage({ code: 'PHONE_DEVICE_BUSY' }, true)).toContain('本次操作尚未开始');
});
it('keeps a floating window reachable and within the viewport', () => {
  expect(clampPhoneWindowPosition({ x: -100, y: -200 }, { width: 288, height: 600 }, { width: 1200, height: 800 })).toEqual({ x: 12, y: 12 });
  const small = phoneWindowWidthLimits({ width: 320, height: 480 });
  expect(small.max * 640 / 288).toBeLessThanOrEqual(456);
});
