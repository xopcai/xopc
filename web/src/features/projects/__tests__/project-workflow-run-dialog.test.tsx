// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUILTIN_WORKFLOWS } from '../../../../../src/agent/workflow/builtins/index';
import { useLocaleStore } from '@/stores/locale-store';
import { listWorkflowDefinitions, startWorkflowRun } from '@/features/workflows/workflow-api';
import { ProjectWorkflowRunButton } from '../project-workflow-run-dialog';

vi.mock('@/features/settings/agents-admin-api', () => ({ fetchGatewayAgents: async () => ({
  defaultId: 'main', agents: [{ id: 'main', name: 'Default assistant' }, { id: 'writer', name: 'Writer assistant' }],
}) }));
vi.mock('@/features/workflows/workflow-api', async (original) => ({
  ...await original<typeof import('@/features/workflows/workflow-api')>(),
  listWorkflowDefinitions: vi.fn(),
  listProjectWorkflowPresets: async () => [{ definitionId: 'research', contextRefs: [{ kind: 'note', id: 'project-note', role: 'reference' }] }],
  startWorkflowRun: vi.fn(),
}));
vi.mock('@/features/workflows/workflow-context-picker', () => ({ WorkflowContextPicker: () => null }));
vi.mock('@/features/workflows/workflow-run-setup-panel', () => ({ WorkflowRunSetupPanel: ({ value, onChange }: {
  value: import('@/features/workflows/workflow-run-setup-panel').WorkflowRunSetupValue;
  onChange: (value: import('@/features/workflows/workflow-run-setup-panel').WorkflowRunSetupValue) => void;
}) => <button onClick={() => onChange({ ...value, goal: 'Research the market', argValues: { question: 'Market outlook' } })}>Fill input</button> }));

let location: string;
function Harness() {
  const route = useLocation(); location = route.pathname + route.search;
  return <ProjectWorkflowRunButton projectId="project-1" />;
}
let element: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let previousLanguage: 'en' | 'zh';
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  previousLanguage = useLocaleStore.getState().language;
  useLocaleStore.setState({ language: 'en' });
  vi.mocked(listWorkflowDefinitions).mockResolvedValue([...BUILTIN_WORKFLOWS]);
  vi.mocked(startWorkflowRun).mockReset().mockResolvedValue({ runId: 'run-1', conversationId: 'conversation-1' });
  element = document.createElement('div'); document.body.append(element); root = createRoot(element);
});
afterEach(async () => {
  await act(async () => root.unmount()); element.remove();
  useLocaleStore.setState({ language: previousLanguage });
});
async function clickButton(text: string, scope: ParentNode = document.body) {
  const button = Array.from(scope.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  expect(button, `Button ${text}`).toBeTruthy();
  await act(async () => button!.click());
}
async function open() {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}><MemoryRouter initialEntries={['/projects/project-1']}><Harness /></MemoryRouter></SWRConfig>));
  await clickButton('Run workflow');
}
async function selectWorkflow() {
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Choose workflow"]')!.click());
  await clickButton('Research');
}

describe('project workflow run modal', () => {
  it.each(['main', 'writer'])('starts with %s while keeping the user on the project page', async (agentId) => {
    await open();
    expect(location).toBe('/projects/project-1');
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.className).toContain('overflow-hidden');
    expect(dialog.className).toContain('h-[min(');
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Execution assistant"]')?.textContent).toContain('Default assistant');
    expect(Array.from(dialog.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Start run')?.disabled).toBe(true);
    await selectWorkflow();
    await clickButton('Fill input');
    if (agentId === 'writer') {
      await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Execution assistant"]')!.click());
      await clickButton('Writer assistant');
    }
    await clickButton('Start run');
    expect(startWorkflowRun).toHaveBeenCalledWith(expect.objectContaining({
      agentId, projectId: 'project-1', definitionId: 'research', goal: 'Research the market',
      input: { question: 'Market outlook' }, contextRefs: [{ kind: 'note', id: 'project-note', role: 'reference' }],
    }));
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Run started.');
    expect(location).toBe('/projects/project-1');
    const resultLink = document.querySelector('[role="status"] a')!;
    expect(resultLink.getAttribute('href')).toBe(`/workflows/runs/run-1?agentId=${agentId}&projectId=project-1`);
    await clickButton('Close');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await clickButton('Run workflow');
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Choose workflow"]')?.textContent).toBe('Choose workflow');
  });

  it('keeps input available after a failed start so the user can retry', async () => {
    vi.mocked(startWorkflowRun).mockRejectedValueOnce(new Error('Run could not start'));
    await open(); await selectWorkflow(); await clickButton('Fill input'); await clickButton('Start run');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Run could not start');
    await clickButton('Start run');
    expect(startWorkflowRun).toHaveBeenCalledTimes(2);
    expect(location).toBe('/projects/project-1');
  });

  it('offers creation in the workflow page when no workflows exist', async () => {
    vi.mocked(listWorkflowDefinitions).mockResolvedValue([]);
    await open();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('No workflows are available');
    const create = document.querySelector<HTMLAnchorElement>('a[href="/workflows/new?projectId=project-1"]')!;
    expect(create).toBeTruthy();
    await act(async () => create.click());
    expect(location).toBe('/workflows/new?projectId=project-1');
  });
});
