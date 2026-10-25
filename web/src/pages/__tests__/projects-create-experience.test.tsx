// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn() }));
vi.mock('@/features/projects/api', () => ({ fetchProjects: api.list, createProject: api.create, archiveProject: vi.fn(), pinProject: vi.fn(), restoreProject: vi.fn(), unpinProject: vi.fn() }));
vi.mock('@/features/fs/use-directory-picker', () => ({ useDirectoryPicker: () => ({ hasNativePicker: true, picking: false, pick: vi.fn() }) }));
import { ProjectsPage } from '../projects-page';
import { useLocaleStore } from '@/stores/locale-store';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); api.list.mockResolvedValue({ items: [], total: 0 }); api.create.mockReturnValue(new Promise(() => {})); useLocaleStore.setState({ language: 'zh' }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });
it('creates an organizational project from its name without sending a directory or starting project analysis', async () => {
  await act(async () => root.render(<MemoryRouter><ProjectsPage /></MemoryRouter>));
  expect(container.textContent).toContain('创建第一个项目');
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === '创建')!.click());
  const form = document.querySelector('form')!;
  const name = form.querySelector('input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, 'Plan an event'); name.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
  expect(form.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true);
  await act(async () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(api.create).toHaveBeenCalledWith({ name: 'Plan an event', autoUnderstand: false });
});

it('does not claim this is the first project when the list failed to load', async () => {
  api.list.mockRejectedValueOnce(new Error('Service unavailable'));
  await act(async () => root.render(<MemoryRouter><ProjectsPage /></MemoryRouter>));
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain('创建第一个项目');
});
