// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ project: vi.fn(), operating: vi.fn(), run: vi.fn(), definitions: vi.fn(), automations: vi.fn(), getAutomation: vi.fn(), runs: vi.fn(), app: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/features/projects/api', () => ({ fetchProject: mocks.project, fetchProjectOperatingView: mocks.operating }));
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
  mocks.operating.mockResolvedValue({ tasks: [], blockers: [], recentResults: [], digest: { health: 'empty', summary: 'No tasks yet' } });
  mocks.automations.mockResolvedValue({ automations: [{ id: 'a1', name: 'Morning digest', enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Summarize updates' }, state: {} }] });
  mocks.runs.mockResolvedValue({ runs: [{ id: 'r1', status: 'succeeded', createdAtMs: 1, summary: 'Digest delivered' }] });
  mocks.app.mockResolvedValue({ id: 'app1', name: 'Calendar', idea: 'Plan a week', draftPreviewUrl: '/api/local-apps/preview/token/ui/index.html', installationState: 'installed', enabled: true, status: 'installed', extensionId: 'calendar' });
  mocks.snapshot.mockResolvedValue({ previewUrl: '/api/local-apps/preview/snapshot/ui/index.html' });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });

async function render(href: string, modal = false) {
  const target = resolveProductPreviewTarget(href)!;
  const onClose = vi.fn();
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map() }}><MemoryRouter initialEntries={[`/chat/c1?view=full&preview=${encodeURIComponent(href)}`]}>{modal
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


  it('shows task counts, prioritizes user input and links tasks without losing the chat', async () => {
    const task = (id: string, extra = {}) => ({ id, title: id, phase: 'ready', operationalState: 'idle', priority: 'normal', attention: [], blockedBy: [], updatedAt: 1, ...extra });
    mocks.operating.mockResolvedValueOnce({
      tasks: [
        task('running', { phase: 'active', operationalState: 'running' }),
        task('approval', { operationalState: 'waiting', attention: [{ kind: 'approval_required', summary: 'Approve deployment' }] }),
        task('blocked', { operationalState: 'blocked' }),
        task('todo'), task('done', { phase: 'closed', resolution: 'done' }),
        task('cancelled', { phase: 'closed', resolution: 'cancelled' }),
      ],
      blockers: [
        { id: 'b', taskId: 'blocked', kind: 'dependency_blocked', title: 'Dependency', detail: 'Waiting for service' },
        { id: 'a', taskId: 'approval', kind: 'approval_required', title: 'Deployment', detail: 'Approve deployment' },
        { id: 'a2', taskId: 'approval', kind: 'input_required', title: 'Duplicate reminder', detail: 'Choose region' },
        { id: 'c', taskId: 'cancelled', kind: 'run_failed', title: 'Old failure' },
      ], recentResults: [], digest: { recommendedAction: 'Approve deployment' },
    });
    await render('/projects/p1');
    expect(mocks.operating).toHaveBeenCalledWith('p1');
    expect([...container.querySelectorAll('dd')].map(item => item.textContent)).toEqual(['1', '1', '1', '1', '1']);
    const attention = [...container.querySelectorAll('section')].find(section => section.textContent?.startsWith('Needs attention'))!;
    expect(attention.textContent).toContain('Approve deployment');
    expect(attention.textContent).not.toContain('Duplicate reminder');
    expect(attention.textContent).not.toContain('Old failure');
    expect(attention.querySelector('a')?.getAttribute('href')).toBe('/chat/c1?view=full&task=approval');
    expect(container.querySelector('a[href*="/projects/p1/tasks"]')).not.toBeNull();
  });

  it('merges recent updates and results in time order and removes repeated summaries', async () => {
    mocks.project.mockResolvedValueOnce({ name: 'Project', status: 'active', health: 'unknown', recentUpdates: [
      { id: 'u1', summary: 'Older update', createdAt: 10 },
      { id: 'u2', summary: 'Repeated inspection', createdAt: 20 },
      { id: 'u3', summary: 'Repeated inspection', createdAt: 30 },
    ] });
    mocks.operating.mockResolvedValueOnce({ tasks: [], blockers: [], digest: {}, recentResults: [
      { taskId: 't1', taskTitle: 'Release', receipt: { runId: 'r1', summary: 'Release checked', finalizedAt: 40, verification: { status: 'passed' } } },
    ] });
    await render('/projects/p1');
    const progress = [...container.querySelectorAll('section')].find(section => section.textContent?.startsWith('Recent progress'))!;
    const items = [...progress.querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Release checked');
    expect(items[1].textContent).toContain('Repeated inspection');
    expect(items[2].textContent).toContain('Older update');
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/chat/c1?view=full&task=t1');
  });

  it('keeps project details and updates available when operating data fails', async () => {
    mocks.operating.mockRejectedValueOnce(new Error('offline'));
    await render('/projects/p1');
    expect(container.textContent).toContain('Build a calendar');
    expect(container.textContent).toContain('Design complete');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Task overview is temporarily unavailable');
    expect(container.querySelectorAll('dd')).toHaveLength(0);
    expect(container.textContent).not.toContain('No recorded blockers');
  });

  it('uses a local skeleton while task data loads', async () => {
    mocks.operating.mockReturnValueOnce(new Promise(() => {}));
    await render('/projects/p1');
    expect(container.textContent).toContain('Build a calendar');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelectorAll('dd')).toHaveLength(0);
  });

  it('renders honest empty states in Chinese', async () => {
    useLocaleStore.setState({ language: 'zh' });
    await render('/projects/p1');
    expect(container.textContent).toContain('尚未关联任务');
    expect(container.textContent).toContain('暂无已记录的阻塞');
    expect([...container.querySelectorAll('dd')].map(item => item.textContent)).toEqual(['0', '0', '0', '0', '0']);
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
