// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { messages } from '@/i18n/messages';
import type { ConnectorInstance } from '../connectors-api';
import { InstalledConnectorRow } from '../components/installed-connector-row';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });

it('uses background-only highlighting and an inset keyboard focus ring for grouped rows', async () => {
  const container = document.createElement('div');
  root = createRoot(container);
  const instance = { instanceId: 'github', displayName: 'GitHub', connectionStatus: 'connected', usage: {} } as ConnectorInstance;
  const onOpenDetails = vi.fn();
  await act(async () => root!.render(<InstalledConnectorRow instance={instance} highlighted onOpenDetails={onOpenDetails} t={messages('zh').connectorsSettings} />));
  const button = container.querySelector('button')!;
  expect(button.classList.contains('bg-accent-soft')).toBe(true);
  expect(button.classList.contains('ring-2')).toBe(false);
  expect(button.classList.contains('focus-visible:ring-inset')).toBe(true);
  expect(button.className).not.toContain('ring-offset');
  expect(button.classList.contains('first:rounded-t-[calc(var(--radius-xl)-1px)]')).toBe(true);
  expect(button.classList.contains('last:rounded-b-[calc(var(--radius-xl)-1px)]')).toBe(true);
  await act(async () => button.click());
  expect(onOpenDetails).toHaveBeenCalledWith(instance);
});
