// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ project: vi.fn(), run: vi.fn(), definitions: vi.fn(), automations: vi.fn(), runs: vi.fn(), app: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/features/projects/api', () => ({ fetchProject: mocks.project }));
vi.mock('@/features/workflows/workflow-api', () => ({ getWorkflowRun: mocks.run, listWorkflowDefinitions: mocks.definitions }));
vi.mock('@/features/automations/automation-api', () => ({ automationApi: { list: mocks.automations, runs: mocks.runs } }));
vi.mock('@/features/local-apps/api', () => ({ getLocalApp: mocks.app, getLocalAppSnapshot: mocks.snapshot }));

import ProductPreviewContent from '../product-preview-content';
import { ProductPreviewModal } from '../product-preview-modal';
import { resolveProductPreviewTarget } from '../product-preview-route';
import { useLocaleStore } from '@/stores/locale-store';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  useLocaleStore.setState({ language: 'en' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  mocks.project.mockResolvedValue({ name: 'Project plan', status: 'active', health: 'on_track', brief: 'Build a calendar', successCriteria: ['Ship it'], milestones: [], recentUpdates: [{ summary: 'Design complete' }] });
  mocks.run.mockResolvedValue({ run: { title: 'Research run', status: 'failed', error: { message: 'Provider offline' }, metrics: { doneAgentCount: 1, agentCount: 2 }, result: { summary: 'Findings ready' } }, phases: [{ id: 'p1', title: 'Research', status: 'completed' }] });
  mocks.definitions.mockResolvedValue([{ id: 'research', title: 'Research workflow', description: 'Investigate a topic', metadata: {}, phases: [{ id: 'p1', title: 'Collect evidence' }] }]);
  mocks.automations.mockResolvedValue({ automations: [{ id: 'a1', name: 'Morning digest', enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Summarize updates' }, state: {} }] });
  mocks.runs.mockResolvedValue({ runs: [{ id: 'r1', status: 'succeeded', createdAtMs: 1, summary: 'Digest delivered' }] });
  mocks.app.mockResolvedValue({ id: 'app1', name: 'Calendar', idea: 'Plan a week', draftPreviewUrl: '/api/local-apps/preview/token/ui/index.html', installationState: 'installed', enabled: true, status: 'installed', extensionId: 'calendar' });
  mocks.snapshot.mockResolvedValue({ previewUrl: '/api/local-apps/preview/snapshot/ui/index.html' });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

async function render(href: string, modal = false) {
  const target = resolveProductPreviewTarget(href)!;
  const onClose = vi.fn();
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter>{modal
    ? <ProductPreviewModal target={target} backgroundPath="/chat/c1?view=full" onClose={onClose} />
    : <ProductPreviewContent target={target} />}</MemoryRouter></SWRConfig>));
  return onClose;
}

describe('chat product previews', () => {
  it('shows project brief and recent progress without management controls', async () => {
    await render('/projects/p1');
    expect(container.textContent).toContain('Build a calendar');
    expect(container.textContent).toContain('Design complete');
    expect(container.querySelector('button, input, textarea')).toBeNull();
  });
  it('shows run results, failure reason, and preserves the owner', async () => {
    await render('/workflows/runs/r1?agentId=coder');
    expect(container.textContent).toContain('Findings ready');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Provider offline');
    expect(mocks.run).toHaveBeenCalledWith('r1', { ownerAgentId: 'coder' });
  });
  it('previews a definition without exposing editing controls', async () => {
    await render('/workflows/research');
    expect(container.textContent).toContain('Collect evidence');
    expect(container.querySelector('textarea, [contenteditable="true"]')).toBeNull();
  });
  it('shows automation instructions and recent execution results', async () => {
    await render('/automations?automation=a1');
    expect(container.textContent).toContain('Summarize updates');
    expect(container.textContent).toContain('Digest delivered');
    expect(mocks.runs).toHaveBeenCalledWith(5, 'a1');
  });
  it('previews the referenced app snapshot and offers intentional app navigation', async () => {
    await render('/local-apps/app1?sourceHash=abc');
    expect(container.querySelector('iframe')?.getAttribute('src')).toContain('/api/local-apps/preview/snapshot/ui/index.html');
    expect(container.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/extensions/calendar');
    expect(mocks.snapshot).toHaveBeenCalledWith('app1', 'abc');
  });
  it('does not offer app usage for drafts', async () => {
    mocks.app.mockResolvedValueOnce({ id: 'app1', name: 'Draft', idea: '', installationState: 'not_installed', status: 'draft', enabled: false });
    await render('/local-apps/app1');
    expect(container.querySelector('a')).toBeNull();
  });
  it('shows a skeleton for pending content', async () => {
    mocks.project.mockReturnValueOnce(new Promise(() => {}));
    await render('/projects/p1');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
  it('handles unavailable content', async () => {
    mocks.definitions.mockResolvedValueOnce([]);
    await render('/workflows/missing');
    expect(container.textContent).toContain('unavailable');
  });
  it('surfaces fetching errors', async () => {
    mocks.project.mockRejectedValueOnce(new Error('offline'));
    await render('/projects/p1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load');
  });
  it('provides a full page link and closes on Escape', async () => {
    const onClose = await render('/workflows/runs/r1?agentId=coder', true);
    const dialog = document.querySelector('[role="dialog"]')!;
    const href = dialog.querySelector('a')?.getAttribute('href');
    expect(href).toBe('/workflows/runs/r1?agentId=coder&returnTo=%2Fchat%2Fc1%3Fview%3Dfull');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
