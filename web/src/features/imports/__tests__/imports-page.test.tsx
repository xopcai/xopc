// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImportsPage } from '../imports-page';
import { importRequest } from '../import-api';
import { useLocaleStore } from '@/stores/locale-store';
vi.mock('../import-api', () => ({ importRequest: vi.fn() }));
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  vi.mocked(importRequest).mockImplementation(async path => {
    if (path === '/sources') return { sources: [{ id: 'claude-code', name: 'Claude Code', detected: true }, { id: 'codex', name: 'Codex', detected: false }] };
    return { source: 'claude-code', skills: 2, context: 1, projects: 1, skipped: 3, issues: [] };
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
it('imports a detected app with one click and no selection or activation steps', async () => {
  await act(async () => root.render(<MemoryRouter><ImportsPage /></MemoryRouter>));
  expect(container.textContent).toContain('Claude Code');
  expect(container.textContent).not.toContain('Codex');
  expect(container.querySelector('[role="combobox"], select, input')).toBeNull();
  await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === 'Import')!.click());
  expect(importRequest).toHaveBeenCalledWith('/sources/claude-code/import', { requestId: expect.any(String) });
  expect(container.querySelector('[role="status"]')?.textContent).toContain('2 skills');
  expect(container.textContent).toContain('Import again');
  expect(importRequest).toHaveBeenCalledTimes(2);
});
it('shows request errors without treating them as a successful import', async () => {
  vi.mocked(importRequest).mockRejectedValueOnce(new Error('Owner access required'));
  await act(async () => root.render(<MemoryRouter><ImportsPage /></MemoryRouter>));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Owner access required');
  expect(container.querySelector('[role="status"]')).toBeNull();
});
it('shows a refresh action when no source is detected', async () => {
  vi.mocked(importRequest).mockResolvedValueOnce({ sources: [] });
  await act(async () => root.render(<MemoryRouter><ImportsPage /></MemoryRouter>));
  expect(container.textContent).toContain('No supported apps found');
  expect([...container.querySelectorAll('button')].some(b => b.textContent === 'Refresh')).toBe(true);
});
