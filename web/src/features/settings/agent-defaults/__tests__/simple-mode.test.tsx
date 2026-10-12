// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { AgentDefaults } from '@/features/settings/types/agent-gateway';
import { useLocaleStore } from '@/stores/locale-store';
import { useSettingsModeStore } from '@/stores/settings-mode-store';

vi.mock('swr', () => ({ default: () => ({ data: [{ id: 'daily', title: 'Daily work' }] }) }));

import { AgentDefaultsRuntimePanel } from '../agent-defaults-runtime-panel';
import { AgentDefaultsToolsPanel } from '../agent-defaults-tools-panel';

let root: Root;
let container: HTMLDivElement;
let draft: AgentDefaults;
const saveDraft = vi.fn((next: AgentDefaults) => { draft = next; });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useLocaleStore.setState({ language: 'en' });
  useSettingsModeStore.setState({ mode: 'simple' });
  draft = {
    models: { chat: { primary: 'test/main', fallbacks: ['test/backup'] }, intents: {} },
    skills: { mode: 'selected', include: [] },
    tools: { read_file: { mode: 'allow', timeoutMs: 4321, maxCallsPerTurn: 7 } },
    workflows: { default: 'daily', allowed: ['daily'] },
    runtime: { maxTurns: 12, timeoutMs: 9876, promptCache: { mode: 'off', lifetime: 'long' }, cloudCreditLimitPerRunMicro: '1000000', codemode: { enabled: true } },
  };
  saveDraft.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  useSettingsModeStore.setState({ mode: 'simple' });
});

it('keeps spending and workflow access editable without exposing execution parameters', async () => {
  const original = structuredClone(draft);
  await act(async () => root.render(<AgentDefaultsRuntimePanel draft={draft} setDraft={saveDraft} zh={false} />));
  expect(container.querySelector('input[inputmode="decimal"]')).not.toBeNull();
  expect(container.querySelector('input[type="number"]')).toBeNull();
  expect(container.textContent).toContain('Daily work');
  expect(container.textContent).toContain('Codemode: on');
  const selected = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('Allow selected workflows only'))!;
  await act(async () => selected.click());
  expect(draft.workflows.allowed).toEqual([]);
  expect(draft.workflows.default).toBe('daily');
  expect(draft.runtime).toEqual(original.runtime);
  saveDraft.mockClear();
  const advanced = [...container.querySelectorAll('button')].find(button => button.textContent === 'Show advanced settings')!;
  await act(async () => advanced.click());
  expect(container.querySelector('input[type="number"]')).not.toBeNull();
  expect(saveDraft).not.toHaveBeenCalled();
});

it('keeps tool authorization editable and preserves hidden call limits', async () => {
  await act(async () => root.render(<AgentDefaultsToolsPanel draft={draft} setDraft={saveDraft} zh={false} builtinTools={[{ id: 'read_file', description: { en: 'Read a file', zh: '读取文件' } }]} />));
  expect(container.querySelector('input[type="number"]')).toBeNull();
  const deny = [...container.querySelectorAll('button')].find(button => button.textContent === 'Deny')!;
  await act(async () => deny.click());
  expect(draft.tools.read_file).toEqual({ mode: 'deny', timeoutMs: 4321, maxCallsPerTurn: 7 });
  expect(draft.models.chat.fallbacks).toEqual(['test/backup']);
});
