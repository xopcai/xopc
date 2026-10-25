// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ project: vi.fn(), run: vi.fn(), definitions: vi.fn(), automations: vi.fn(), getAutomation: vi.fn(), runs: vi.fn(), app: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/features/projects/api', () => ({ fetchProject: mocks.project }));
vi.mock('@/features/automations/automation-api', () => ({ automationApi: { list: mocks.automations, get: mocks.getAutomation, runs: mocks.runs } }));
vi.mock('@/features/chat/agent-selection/chat-agents-api', () => ({ fetchChatAgents: async () => ({ defaultId: 'main', items: [] }) }));
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
  it('opens an editable task link with the shared task form instead of a summary preview', async () => {
    mocks.getAutomation.mockResolvedValue({ automation: { id: 'a1', name: 'Morning digest', enabled: false,
      action: { kind: 'agent', instruction: 'Summarize updates' }, trigger: { kind: 'schedule', schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' } },
      conversationMode: 'continuous', delivery: { notificationPolicy: 'all', destinations: [] }, state: {}, createdAtMs: 1, updatedAtMs: 1 } });
    await render('/automations?automation=a1', true);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('textarea')?.value).toBe('Summarize updates');
    expect(dialog.querySelector('[aria-label="Task name"]')).not.toBeNull();
    expect(dialog.textContent).toContain('Save');
    expect(dialog.textContent).not.toContain('Open full page');
  });
  it('shows project brief and recent progress without management controls', async () => {
    await render('/projects/p1');
    expect(container.textContent).toContain('Build a calendar');
    expect(container.textContent).toContain('Design complete');
    expect(container.querySelector('button, input, textarea')).toBeNull();
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
    mocks.project.mockResolvedValueOnce(null);
    await render('/projects/missing');
    expect(container.textContent).toContain('unavailable');
  });
  it('surfaces fetching errors', async () => {
    mocks.project.mockRejectedValueOnce(new Error('offline'));
    await render('/projects/p1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unable to load');
  });
  it('provides a full page link and closes on Escape', async () => {
    const onClose = await render('/projects/p1?agentId=coder', true);
    const dialog = document.querySelector('[role="dialog"]')!;
    const href = dialog.querySelector('a')?.getAttribute('href');
    expect(href).toBe('/projects/p1?agentId=coder&returnTo=%2Fchat%2Fc1%3Fview%3Dfull');
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
