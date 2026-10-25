// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import useSWR from 'swr';

vi.mock('swr', () => ({ default: vi.fn() }));
vi.mock('@/lib/fetch', () => ({ fetchJson: vi.fn() }));
vi.mock('../phone-live-api', async original => ({ ...await original<typeof import('../phone-live-api')>(), useConversationPhone: vi.fn() }));
vi.mock('../phone-live-panel', () => ({ PhoneLivePanel: ({ headerActions }: { headerActions?: import('react').ReactNode }) => <div>Phone preview{headerActions}</div> }));

import { fetchJson } from '@/lib/fetch';
import { useLocaleStore } from '@/stores/locale-store';
import { GlobalPhoneWorkspace, phoneOccupancy } from '../global-phone-workspace';
import { phoneErrorMessage, useConversationPhone, type PhoneLiveState } from '../phone-live-api';
import { usePhoneWorkspaceStore } from '../phone-workspace-store';
import { phoneWindowWidthLimits, clampPhoneWindowPosition } from '../use-phone-window-layout';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); usePhoneWorkspaceStore.setState({ open: false, selected: null, displayMode: 'docked', position: null, controlConversationId: null }); vi.clearAllMocks(); });
const report = { sessionId: 'session', deviceId: 'device', owner: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', deviceName: 'Shared phone', agentId: 'main', modelRef: 'phone/model', status: 'ready', mode: 'control', controlOwner: 'none', updatedAt: 1, actions: 0, modelRequests: 0 } satisfies PhoneLiveState['report'];

it('hides the device switcher for a single phone and hides without disconnecting', async () => {
  useLocaleStore.setState({ language: 'zh' });
  const data = [{ ...report, sourceConversationName: 'Chat A' }];
  vi.mocked(useSWR).mockReturnValue({ data, mutate: vi.fn(), isLoading: false } as unknown as ReturnType<typeof useSWR>);
  vi.mocked(useConversationPhone).mockReturnValue({ data: { report, ownControl: false, frame: null }, mutate: vi.fn() } as unknown as ReturnType<typeof useConversationPhone>);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const render = () => root!.render(<MemoryRouter><GlobalPhoneWorkspace /></MemoryRouter>);
  await act(async () => render());
  await act(async () => usePhoneWorkspaceStore.getState().show(report.deviceId));
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  expect(document.body.textContent).not.toContain('来源聊天');
  data[0] = { ...report, owner: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', sourceConversationName: 'Chat B' };
  await act(async () => render());
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  await act(async () => (document.querySelector('[aria-label="收起手机，保持连接"]') as HTMLButtonElement).click());
  expect(usePhoneWorkspaceStore.getState().open).toBe(false);
  expect(fetchJson).not.toHaveBeenCalled();
});

it('shows a device switcher only when multiple phones are connected', async () => {
  const data = [report, { ...report, sessionId: 'second-session', deviceId: 'second-device', deviceName: 'Second phone' }];
  vi.mocked(useSWR).mockReturnValue({ data, mutate: vi.fn(), isLoading: false } as unknown as ReturnType<typeof useSWR>);
  vi.mocked(useConversationPhone).mockReturnValue({ data: { report, ownControl: false, frame: null }, mutate: vi.fn() } as unknown as ReturnType<typeof useConversationPhone>);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><GlobalPhoneWorkspace /></MemoryRouter>));
  await act(async () => usePhoneWorkspaceStore.getState().show(report.deviceId));
  expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
  await act(async () => (document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click());
  expect(usePhoneWorkspaceStore.getState().selected).toBe('second-device');
});

it('distinguishes idle, task ownership, inspection and actionable errors', () => {
  expect(phoneOccupancy(report, true)).toBe('已连接 · 空闲');
  expect(phoneOccupancy({ ...report, controlOwner: 'agent' }, true)).toBe('聊天任务占用中');
  expect(phoneOccupancy({ ...report, controlOwner: 'human' }, true)).toBe('人工操作中');
  expect(phoneOccupancy({ ...report, status: 'outcome_unknown' }, true)).toBe('等待检查或接管');
  expect(phoneErrorMessage({ body: { error: { code: 'PHONE_DEVICE_BUSY' } } }, true)).toContain('本次操作尚未开始');
  expect(phoneErrorMessage({ code: 'PHONE_DISPATCH_UNKNOWN' }, true)).toContain('避免重复执行');
});

it('switches between a docked rail and floating window without replacing the phone component', async () => {
  vi.mocked(useSWR).mockReturnValue({ data: [report], mutate: vi.fn(), isLoading: false } as unknown as ReturnType<typeof useSWR>);
  vi.mocked(useConversationPhone).mockReturnValue({ data: { report, ownControl: false, frame: null }, mutate: vi.fn() } as unknown as ReturnType<typeof useConversationPhone>);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<MemoryRouter><GlobalPhoneWorkspace /></MemoryRouter>));
  await act(async () => usePhoneWorkspaceStore.getState().show(report.deviceId));
  const pane = container.querySelector('[data-phone-window]')!;
  const preview = pane.querySelector('div');
  expect(pane.getAttribute('data-display-mode')).toBe('docked');
  await act(async () => (container!.querySelector('[aria-label="小窗显示"]') as HTMLButtonElement).click());
  expect(pane.getAttribute('data-display-mode')).toBe('floating');
  expect(pane.querySelector('div')).toBe(preview);
  await act(async () => (document.querySelector('[aria-label="停靠到右侧"]') as HTMLButtonElement).click());
  expect(pane.getAttribute('data-display-mode')).toBe('docked');
  expect(pane.querySelector('div')).toBe(preview);
  expect(fetchJson).not.toHaveBeenCalled();
});

it('keeps the floating window reachable after dragging or viewport changes', () => {
  const size = { width: 288, height: 600 };
  expect(clampPhoneWindowPosition({ x: -100, y: -200 }, size, { width: 1200, height: 800 })).toEqual({ x: 12, y: 12 });
  expect(clampPhoneWindowPosition({ x: 1800, y: 1000 }, size, { width: 1200, height: 800 })).toEqual({ x: 900, y: 188 });
  expect(clampPhoneWindowPosition({ x: 900, y: 188 }, size, { width: 400, height: 640 })).toEqual({ x: 100, y: 28 });
});

it('limits proportional resizing by both viewport dimensions', () => {
  expect(phoneWindowWidthLimits({ width: 1920, height: 1080 })).toEqual({ min: 216, max: 432 });
  const small = phoneWindowWidthLimits({ width: 320, height: 480 });
  expect(small.max * 640 / 288).toBeLessThanOrEqual(456);
  expect(small.min).toBeLessThanOrEqual(small.max);
});
