// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGatewayStore } from '@/stores/gateway-store';
import { useWorkflowsPage, type WorkflowsPageVm } from '../use-workflows-page';
import { WorkflowsPageHeaderActions } from '../workflows-page-header-actions';
import { cancelWorkflowRun, listWorkflowRunsForAgents, retryWorkflowRun } from '../workflow-api';

vi.mock('@/features/settings/agents-admin-api', () => ({ fetchGatewayAgents: async () => ({
  defaultId: 'main', agents: [{ id: 'main', name: 'Main' }, { id: 'writer', name: 'Writer' }],
}) }));
vi.mock('../workflow-api', () => ({
  listWorkflowDefinitions: async () => [], listProjectWorkflowPresets: async () => [],
  listWorkflowRunsForAgents: vi.fn(async (ids: string[]) => ids.map((id) => ({
    id: `run-${id}`, ownerAgentId: id, definitionId: 'research', createdAtMs: 1, status: 'succeeded',
  }))),
  cancelWorkflowRun: vi.fn(async () => {}), retryWorkflowRun: vi.fn(async () => ({ runId: 'retried' })),
}));

let vm: WorkflowsPageVm;
let location: string;
function Harness() {
  vm = useWorkflowsPage();
  const route = useLocation();
  location = route.pathname + route.search;
  return <WorkflowsPageHeaderActions vm={vm} />;
}

const containers: Array<{ root: ReturnType<typeof createRoot>; element: HTMLDivElement }> = [];
afterEach(async () => {
  for (const { root, element } of containers.splice(0)) {
    await act(async () => root.unmount());
    element.remove();
  }
  vi.clearAllMocks();
});

async function mount(route = '/workflows') {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useGatewayStore.setState({ conversationId: 'test-token' });
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element); containers.push({ root, element });
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><MemoryRouter initialEntries={[route]}><Harness /></MemoryRouter></SWRConfig>));
  return element;
}

describe('workflow assistant scopes', () => {
  it('defaults to all assistants and routes actions to each run owner', async () => {
    const element = await mount();
    expect(vm.ownerAgentId).toBeUndefined();
    expect(listWorkflowRunsForAgents).toHaveBeenCalledWith(['main', 'writer'], expect.any(Number), { projectId: undefined });
    expect(element.textContent).toMatch(/全部助手|All assistants/);
    const writerRun = vm.runs.find((run) => run.ownerAgentId === 'writer')!;
    await act(async () => { await vm.cancelRun(writerRun.id); });
    expect(cancelWorkflowRun).toHaveBeenCalledWith('run-writer', { ownerAgentId: 'writer' });
    await act(async () => { await vm.retryRun(writerRun.id); });
    expect(retryWorkflowRun).toHaveBeenCalledWith('run-writer', { ownerAgentId: 'writer' });
    expect(location).toBe('/workflows/runs/retried?agentId=writer');
    await act(async () => vm.openRunDetails(writerRun));
    expect(location).toBe('/workflows/runs/run-writer?agentId=writer');
  });

  it('hides the assistant filter in the library and does not propagate the filter into execution', async () => {
    const element = await mount('/workflows?tab=library&agent=writer');
    expect(element.querySelector('[role="combobox"]')).toBeNull();
    await act(async () => vm.openDefinitionDetails({ id: 'research' } as never));
    expect(location).toBe('/workflows/research');
  });

  it('supports an explicit assistant filter and clears back to all assistants', async () => {
    await mount('/workflows?agent=writer');
    expect(listWorkflowRunsForAgents).toHaveBeenCalledWith(['writer'], expect.any(Number), { projectId: undefined });
    await act(async () => vm.clearRunFilters());
    expect(vm.ownerAgentId).toBeUndefined();
    expect(listWorkflowRunsForAgents).toHaveBeenLastCalledWith(['main', 'writer'], expect.any(Number), { projectId: undefined });
  });
});
