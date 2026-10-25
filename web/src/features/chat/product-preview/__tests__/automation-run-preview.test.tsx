// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig, useSWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

import { automationApi, type Automation, type AutomationRun } from '@/features/automations/automation-api';
import { useLocaleStore } from '@/stores/locale-store';
import { AutomationRunPreview } from '../automation-run-preview';

vi.mock('@/features/automations/automation-delivery-status', () => ({ AutomationDeliveryStatus: () => <p>Notification status</p> }));

it('does not substitute the latest execution when an old link has no execution identity', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  vi.spyOn(automationApi, 'get').mockResolvedValue({ automation: { id: 'task-1', name: 'Progress check', state: {} } as Automation });
  const latest = vi.spyOn(automationApi, 'runs');
  const read = vi.spyOn(automationApi, 'getRun');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter><AutomationRunPreview automationId="task-1" /></MemoryRouter></SWRConfig>));
    expect(container.textContent).toContain('does not identify an execution');
    expect(latest).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});

it('shows queue progress and refreshes the same execution to its result without triggering another run', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  vi.spyOn(automationApi, 'get').mockResolvedValue({ automation: { id: 'task-1', name: 'Progress check', state: {} } as Automation });
  const run: AutomationRun = { id: 'run-1', automationId: 'task-1', automationName: 'Progress check', status: 'queued', createdAtMs: 1,
    manual: true, triggerSnapshot: { kind: 'manual' }, actionSnapshot: { kind: 'agent', instruction: 'Summarize' } };
  const read = vi.spyOn(automationApi, 'getRun').mockResolvedValue({ run });
  const execute = vi.spyOn(automationApi, 'runNow');
  const latest = vi.spyOn(automationApi, 'runs').mockResolvedValue({ runs: [{ ...run, id: 'newer-run', status: 'succeeded', summary: 'Wrong newer result' }] });
  let refresh!: () => Promise<unknown>;
  function Harness() {
    const { mutate } = useSWRConfig();
    refresh = () => mutate(['automation-run-preview', 'task-1', 'run-1']);
    return <AutomationRunPreview automationId="task-1" runId="run-1" />;
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter><Harness /></MemoryRouter></SWRConfig>));
    expect(container.textContent).toContain('Queued');
    expect(container.querySelector('textarea')).toBeNull();
    read.mockResolvedValue({ run: { ...run, status: 'running' } });
    await act(async () => { await refresh(); });
    expect(container.textContent).toContain('Running');
    read.mockResolvedValue({ run: { ...run, status: 'succeeded', summary: 'Project summary is ready' } });
    await act(async () => { await refresh(); });
    expect(container.textContent).toContain('Project summary is ready');
    expect(container.textContent).toContain('Notification status');
    expect(container.textContent).not.toContain('Wrong newer result');
    expect(latest).not.toHaveBeenCalled();
    expect(read.mock.calls.every(([id]) => id === 'run-1')).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); }
});
