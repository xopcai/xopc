// @vitest-environment jsdom
import * as Dialog from '@radix-ui/react-dialog';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../capabilities-settings-panel', () => ({ CapabilitiesSettingsPanel: ({ inlineUse, inlineView, onPendingChange }: any) => <div><span data-view={inlineView}>{inlineUse}</span><input aria-label="Service draft" defaultValue="" /><button onClick={() => onPendingChange(true)}>Start saving</button><button onClick={() => onPendingChange(false)}>Finish saving</button></div> }));
import { CapabilitySettingsSheet } from '../capability-settings-sheet';
import { openCapabilitySettings } from '../open-capability-settings';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it('keeps the invoking screen mounted and prevents closing or switching during a save', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><textarea defaultValue="unsent draft" /><CapabilitySettingsSheet /></MemoryRouter>));
  const draft = container.querySelector('textarea');
  await act(async () => openCapabilitySettings('speech'));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('speech');
  expect(container.querySelector('textarea')).toBe(draft);
  const click = async (name: string) => act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === name)!.click());
  await click('Start saving');
  const done = [...document.querySelectorAll('button')].find(button => ['完成','Done'].includes(button.textContent ?? ''))!;
  expect(done.disabled).toBe(true);
  await act(async () => openCapabilitySettings('transcription'));
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('transcription');
  await click('Finish saving'); await act(async () => done.click());
  expect((document.querySelector('[role="dialog"]') as HTMLElement).style.display).toBe('none'); expect(draft?.value).toBe('unsent draft');
});

it('opens either modal tab directly and retains the editor while changing tabs', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><CapabilitySettingsSheet /></MemoryRouter>));
  await act(async () => openCapabilitySettings('transcription', 'services'));
  expect(document.querySelector('[data-view]')?.getAttribute('data-view')).toBe('services');
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Service draft"]')!;
  input.value = 'unsaved connection';
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => ['模型与参数', 'Model and parameters'].includes(button.textContent ?? ''))!.click());
  expect(document.querySelector('[data-view]')?.getAttribute('data-view')).toBe('settings');
  expect(document.querySelector('input[aria-label="Service draft"]')).toBe(input);
  expect(input.value).toBe('unsaved connection');
  await act(async () => [...document.querySelectorAll('button')].find(button => ['完成','Done'].includes(button.textContent ?? ''))!.click());
  await act(async () => openCapabilitySettings('transcription', 'services'));
  expect(document.querySelector('input[aria-label="Service draft"]')).toBe(input);
  expect(input.value).toBe('unsaved connection');
});

it('supports keyboard tab navigation with correct selection semantics', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><CapabilitySettingsSheet /></MemoryRouter>));
  await act(async () => openCapabilitySettings('speech'));
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  await act(async () => { tabs[0].focus(); tabs[0].dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true})); });
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tabs[1]);
  expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tabs[1].id);
});

it('nests model configuration inside an invoking modal without aria-hiding the configuration or losing its draft', async () => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<MemoryRouter><Dialog.Root defaultOpen><Dialog.Portal><Dialog.Content data-testid="invoking"><Dialog.Title>Automation draft</Dialog.Title><Dialog.Description>Unsaved work</Dialog.Description><textarea defaultValue="Keep this draft" /><button onClick={() => openCapabilitySettings('background', 'services', 'automation')}>Models</button></Dialog.Content></Dialog.Portal></Dialog.Root><CapabilitySettingsSheet /></MemoryRouter>));
  const opener = [...document.querySelectorAll('button')].find(button => button.textContent === 'Models')!;
  await act(async () => { opener.focus(); opener.click(); });
  const editor = document.querySelector('[aria-label="Service draft"]')!;
  expect(editor.closest('[aria-hidden="true"]')).toBeNull();
  expect(document.querySelector('[data-testid="invoking"]')?.contains(editor)).toBe(true);
  expect(document.querySelector('textarea')?.value).toBe('Keep this draft');
});
