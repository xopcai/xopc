// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImportsPage } from '../imports-page';
import { importRequest, type ImportInventory } from '../import-api';
import { useLocaleStore } from '@/stores/locale-store';
vi.mock('../import-api', () => ({ importRequest: vi.fn() }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const inventory: ImportInventory = { id: 'inventory', source: 'claude-code', createdAt: 0, expiresAt: Date.now() + 60_000, complete: true, notices: [], candidates: [
  { id: 's', kind: 'skill', name: 'report', description: '', displayPath: '/skills/report', scope: 'user', status: 'ready', suggested: true },
  { id: 'c', kind: 'context', name: 'CLAUDE.md', description: '', displayPath: '/CLAUDE.md', scope: 'user', status: 'ready', suggested: false },
  { id: 'p', kind: 'project', name: 'work', description: '', displayPath: '/work', scope: 'project', status: 'ready', suggested: false },
  { id: 'ps', kind: 'skill', parentId: 'p', name: 'project-skill', description: '', displayPath: '/work/skill', scope: 'project', status: 'ready', suggested: true },
  { id: 'pc', kind: 'context', parentId: 'p', name: 'project-rule', description: '', displayPath: '/work/CLAUDE.md', scope: 'project', status: 'ready', suggested: false },
] };
const result = { id: 'run', source: 'claude-code', status: 'completed', skills: 1, context: 0, projects: 0, skipped: 0, issues: [], items: [] };
function button(text: string) { return [...document.querySelectorAll('button')].find(b => b.textContent === text)!; }
function checkbox(name: string) { return [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(b => b.closest('label')?.textContent?.startsWith(name))!; }
async function open() {
  await act(async () => root.render(<MemoryRouter><ImportsPage /></MemoryRouter>));
  await act(async () => button('Import').click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(importRequest).mockImplementation(async path => {
    if (path === '/sources') return { sources: [{ id: 'claude-code', name: 'Claude Code', detected: true }] };
    if (path.endsWith('/scan')) return inventory;
    if (path.endsWith('/preview')) return { text: 'Source text', truncated: false };
    return result;
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
it('scans first, defaults only user skills, and submits explicit IDs after confirmation', async () => {
  await open();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(checkbox('report').checked).toBe(true);
  expect(checkbox('CLAUDE.md').checked).toBe(false);
  expect(checkbox('work').checked).toBe(false);
  expect(importRequest).not.toHaveBeenCalledWith('/runs', expect.anything());
  await act(async () => button('Import selected content').click());
  expect(importRequest).toHaveBeenCalledWith('/runs', { inventoryId: 'inventory', candidateIds: ['s'], requestId: expect.any(String), retryOf: undefined });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.textContent).toContain('Import complete');
});
it('selects project skills with the project but keeps its rules opt-in, then clears children', async () => {
  await open();
  await act(async () => checkbox('work').click());
  expect(checkbox('project-skill').checked).toBe(true);
  expect(checkbox('project-rule').checked).toBe(false);
  await act(async () => checkbox('project-rule').click());
  await act(async () => checkbox('work').click());
  expect(checkbox('project-skill').checked).toBe(false);
  expect(checkbox('project-rule').checked).toBe(false);
});
it('cancelling a selection performs no business writes', async () => {
  await open(); await act(async () => button('Cancel').click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(vi.mocked(importRequest).mock.calls.some(([path]) => path === '/runs')).toBe(false);
});
it('retries uncertain network results with the same request and locked selection', async () => {
  await open();
  vi.mocked(importRequest).mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async () => button('Import selected content').click());
  expect(checkbox('report').disabled).toBe(true);
  const first = vi.mocked(importRequest).mock.calls.find(([path]) => path === '/runs')![1];
  await act(async () => [...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent === 'Try again')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(vi.mocked(importRequest).mock.calls.filter(([path]) => path === '/runs').map(([, body]) => body)).toEqual([first, first]);
});
it('shows request errors without treating them as a successful import', async () => {
  vi.mocked(importRequest).mockRejectedValueOnce(new Error('Owner access required'));
  await act(async () => root.render(<MemoryRouter><ImportsPage /></MemoryRouter>));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Owner access required');
  expect(container.querySelector('[role="status"]')).toBeNull();
});
