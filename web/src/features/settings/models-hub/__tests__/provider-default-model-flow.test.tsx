// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { CustomModel } from '@/features/settings/models-json-api';
import { messages } from '@/i18n/messages';

const mocks = vi.hoisted((): { save: ReturnType<typeof vi.fn>; model: CustomModel } => ({ save: vi.fn(), model: { id: 'new-model', input: ['text'] } }));
vi.mock('@/features/settings/models-json-api', async importOriginal => ({
  ...await importOriginal<typeof import('@/features/settings/models-json-api')>(), saveModelsJson: mocks.save,
}));
vi.mock('@/features/settings/provider-api-key-field', () => ({ ProviderApiKeyField: () => null }));
vi.mock('@/features/settings/models/models-model-edit-dialog', () => ({ ModelEditDialogContent: ({ open, onSave, onOpenChange }: {
  open: boolean; onSave: (model: CustomModel) => void; onOpenChange: (open: boolean) => void;
}) => open ? <button onClick={() => { onSave(mocks.model); onOpenChange(false); }}>Save test model</button> : null }));
vi.mock('../default-model-success-step', () => ({ DefaultModelSuccessStep: ({ target }: { target: { modelIds: string[] } }) =>
  <div data-testid="success">{target.modelIds.join(',')}</div>,
}));

import { ProviderManageDialog } from '../provider-manage-dialog';
import { AddProviderDialog } from '../add-provider-dialog';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
const onSaved = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue({ saved: true, modelCount: 2 });
  mocks.model = { id: 'new-model', input: ['text'] };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() {
  await act(async () => root.render(<MemoryRouter><ProviderManageDialog open onOpenChange={vi.fn()}
    providerId="custom" isCustom builtinRows={[]} allModels={[]}
    customConfig={{ providers: { custom: { baseUrl: 'https://example.com', models: [{ id: 'existing' }] } } }}
    labels={messages('en').capabilitiesSettings.manageProviderDialog} language="en" onSaved={onSaved}
  /></MemoryRouter>));
}
async function click(label: string) {
  const button = Array.from(document.querySelectorAll('button')).find(entry => entry.textContent === label || entry.getAttribute('aria-label') === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}

it('replaces the provider content inside the same dialog after a new model is saved', async () => {
  await render();
  await click(messages('en').modelsSettings.addModel);
  const dialog = document.querySelector('[role="dialog"]');
  await click('Save test model');
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(document.querySelector('[data-testid="success"]')?.textContent).toBe('new-model');
  expect(onSaved).toHaveBeenCalledOnce();
});

it('does not offer the default step for editing model metadata', async () => {
  mocks.model = { id: 'existing', name: 'Renamed' };
  await render();
  await click(messages('en').modelsSettings.editModel);
  await click('Save test model');
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-testid="success"]')).toBeNull();
});

it('does not offer the default step for a dedicated computer model', async () => {
  mocks.model = { id: 'gui', computerUse: { profile: 'structured-tools-v1' }, input: ['text', 'image'] };
  await render();
  await click(messages('en').modelsSettings.addModel);
  await click('Save test model');
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(document.querySelector('[data-testid="success"]')).toBeNull();
});

it('does not show success when saving the model fails', async () => {
  mocks.save.mockRejectedValue(new Error('Save failed'));
  await render();
  await click(messages('en').modelsSettings.addModel);
  await click('Save test model');
  expect(document.querySelector('[data-testid="success"]')).toBeNull();
  expect(document.body.textContent).toContain('Save failed');
  expect(onSaved).not.toHaveBeenCalled();
});


it('keeps the add-provider dialog open and offers only the models added in that save', async () => {
  const labels = messages('en').capabilitiesSettings.addProviderDialog;
  await act(async () => root.render(<MemoryRouter><AddProviderDialog open onOpenChange={vi.fn()}
    builtinRows={[]} customConfig={{ providers: {} }} labels={labels} language="en" onSaved={onSaved}
  /></MemoryRouter>));
  const customButton = Array.from(document.querySelectorAll('button')).find(button => button.textContent?.includes(labels.addCustom));
  await act(async () => customButton!.click());
  const dialog = document.querySelector('[role="dialog"]');
  async function fill(input: HTMLInputElement, value: string) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  await fill(document.querySelector<HTMLInputElement>('#custom-provider-id')!, 'custom');
  await fill(document.querySelector<HTMLInputElement>('#custom-base-url')!, 'https://example.com');
  const modelInput = Array.from(document.querySelectorAll<HTMLInputElement>('input')).find(input => input.placeholder === labels.modelIdPlaceholder)!;
  await fill(modelInput, 'chat');
  await click(labels.save);
  expect(mocks.save).toHaveBeenCalledOnce();
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
  expect(document.querySelector('[data-testid="success"]')?.textContent).toBe('chat');
  expect(onSaved).toHaveBeenCalledWith('custom');
});
