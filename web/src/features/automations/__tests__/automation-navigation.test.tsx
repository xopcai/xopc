// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { automationApi, type Automation } from '../automation-api';
import { AutomationNavigation } from '../automation-navigation';

const task: Automation = { id: 'task', name: 'Report', enabled: true, trigger: { kind: 'manual' },
  action: { kind: 'agent', instruction: 'Report' }, conversationMode: 'new_session',
  delivery: { notificationPolicy: 'none', destinations: [] }, state: {}, createdAtMs: 1, updatedAtMs: 1 };
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const configure = vi.fn(); const select = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear(); useGatewayStore.setState({ baseUrl: 'http://fixture', conversationId: 'owner' });
  vi.spyOn(automationApi, 'runs').mockResolvedValue({ runs: [{ id: 'run', automationId: 'task', automationName: 'Report',
    status: 'succeeded', manual: false, createdAtMs: 1, triggerSnapshot: task.trigger, actionSnapshot: task.action }], hasMore: false });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });

async function render(selectedAutomationId: string | null = null) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><AutomationNavigation
    automations={[task]} runs={[]} labels={messages('en').automations} cronLabels={messages('en').cron} language="en"
    selectedAutomationId={selectedAutomationId} executionSummaries={{ task: { unreadCount: 53 } }}
    busy={false} onEdit={vi.fn()} onAction={vi.fn()} onOpenDetails={configure} onSelectRun={select} /></SWRConfig>));
}

it('expands history without entering configuration or marking results read', async () => {
  const read = vi.spyOn(automationApi, 'markRunRead');
  await render();
  expect(automationApi.runs).not.toHaveBeenCalled();
  expect(container.textContent).toContain(messages('en').automations.filters.unread);
  await act(async () => (container.querySelector('[aria-expanded]') as HTMLButtonElement).click());
  expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
  expect(configure).not.toHaveBeenCalled();
  expect(read).not.toHaveBeenCalled();
  expect(automationApi.runs).toHaveBeenCalled();
  const child = container.querySelector('[aria-label="Execution history"] button') as HTMLButtonElement;
  await act(async () => child.click());
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: 'run' }));
  const parent = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Report'))!;
  await act(async () => parent.click());
  expect(configure).toHaveBeenCalledWith('task');
});

it('automatically expands the deep-linked parent while retaining a manual collapsed state', async () => {
  await render('task');
  expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('true');
  await act(async () => (container.querySelector('[aria-expanded]') as HTMLButtonElement).click());
  expect(container.querySelector('[aria-expanded]')?.getAttribute('aria-expanded')).toBe('false');
  expect(JSON.parse(localStorage.getItem('xopc.automation-navigation:http://fixture:owner')!)).toMatchObject({ task: false });
});
