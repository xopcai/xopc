// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { expect, it, vi } from 'vitest';

import { BUILTIN_WORKFLOWS } from '../../../../../src/agent/workflow/builtins/index';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { WorkflowDetailPage } from '../workflow-product-pages';
import { startWorkflowRun } from '../workflow-api';

vi.mock('@/features/settings/agents-admin-api', () => ({ fetchGatewayAgents: async () => ({
  defaultId: 'main', agents: [{ id: 'main', name: 'Default assistant' }, { id: 'writer', name: 'Writer assistant' }],
}) }));
vi.mock('@/features/projects/api', () => ({ fetchProjects: async () => ({ items: [] }) }));
vi.mock('../workflow-api', async (original) => ({
  ...await original<typeof import('../workflow-api')>(),
  listWorkflowDefinitions: async () => BUILTIN_WORKFLOWS,
  listWorkflowRuns: async () => [],
  startWorkflowRun: vi.fn(async () => ({ runId: 'new-run' })),
}));
vi.mock('../workflow-create-dialog', () => ({ WorkflowEditor: () => null }));
vi.mock('../workflow-source-panel', () => ({ WorkflowSourcePanel: () => null }));
vi.mock('../workflow-run-panel', () => ({ WorkflowRunPanel: () => null }));
vi.mock('../workflow-definition-graph', () => ({ WorkflowDefinitionGraph: () => null }));
vi.mock('../workflow-context-picker', () => ({ WorkflowContextPicker: () => null }));
vi.mock('../workflow-run-setup-panel', () => ({ WorkflowRunSetupPanel: ({ value, onChange }: { value: import('../workflow-run-setup-panel').WorkflowRunSetupValue; onChange: (value: import('../workflow-run-setup-panel').WorkflowRunSetupValue) => void }) => <button onClick={() => onChange({ ...value, argValues: { question: 'Research a topic' } })}>Fill input</button> }));

it.each(['main', 'writer'])('submits %s using the system default or an explicit execution assistant', async (agentId) => {
  vi.mocked(startWorkflowRun).mockClear();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useGatewayStore.setState({ conversationId: 'test-token' });
  const previousLanguage = useLocaleStore.getState().language;
  useLocaleStore.setState({ language: 'en' });
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  try {
    await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter initialEntries={['/workflows/research']}><Routes>
      <Route path="/workflows/:definitionId" element={<WorkflowDetailPage />} />
      <Route path="/workflows/runs/:runId" element={<div>Run started</div>} />
    </Routes></MemoryRouter></SWRConfig>));
    const assistant = element.querySelector<HTMLButtonElement>('[aria-label="Execution assistant"]')!;
    expect(assistant.textContent).toContain('Default assistant');
    if (agentId === 'writer') {
      await act(async () => assistant.click());
      const writer = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((option) => option.textContent?.includes('Writer assistant'))!;
      expect(writer).toBeTruthy();
      await act(async () => writer.click());
      expect(assistant.textContent).toContain('Writer assistant');
    }
    await act(async () => Array.from(element.querySelectorAll('button')).find((button) => button.textContent === 'Fill input')!.click());
    const start = Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Start run')!;
    expect(start).toBeTruthy();
    await act(async () => start.click());
    expect(startWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({ definitionId: 'research', agentId }));
    expect(element.textContent).toContain('Run started');
  } finally {
    await act(async () => root.unmount()); element.remove();
    useLocaleStore.setState({ language: previousLanguage });
  }
});
