// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { messages } from '@/i18n/messages';

import { CustomMcpServerDialog } from '../../custom-mcp-server-dialog';
import { emptyMcpServerRow } from '../mcp-config-api';
import { McpHeadersEditor } from '../mcp-headers-editor';
import { createMcpHeaderEntry, headersToRecord, parseHeadersPaste, recordToHeaders } from '../mcp-headers-utils';

const clipboard = vi.hoisted(() => vi.fn());
vi.mock('@/lib/copy-to-clipboard', () => ({ readTextFromClipboard: clipboard }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
  clipboard.mockReset().mockResolvedValue('Authorization: Bearer token\nX-Tenant: team');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

function Form({ existing = false }: { existing?: boolean }) {
  const [headers, setHeaders] = useState(() => existing
    ? recordToHeaders({ Authorization: 'Bearer token', 'X-Tenant': 'team' })
    : [createMcpHeaderEntry(), createMcpHeaderEntry()]);
  return <McpHeadersEditor label="Headers" addLabel="Add Header" removeHeaderAria="Remove Header"
    pasteLabel="Paste" pasteFailed="Paste failed" pasteFailedTitle="Could not paste headers" dismissLabel="OK" keyPlaceholder="Key" valuePlaceholder="Value"
    headers={headers} onChange={setHeaders} />;
}
async function type(input: HTMLInputElement, value: string) {
  input.focus();
  for (const char of value) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, input.value + char);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.activeElement).toBe(input);
    expect(input.isConnected).toBe(true);
  }
}

it('keeps focus while typing header names and values, including duplicate names and empty keys', async () => {
  await act(async () => root.render(<Form />));
  const inputs = container.querySelectorAll('input');
  await type(inputs[1], 'Bearer token');
  await type(inputs[0], 'Authorization');
  await type(inputs[2], 'Authorization');
  await type(inputs[3], 'second token');
  expect(inputs[0].value).toBe('Authorization');
  expect(inputs[1].value).toBe('Bearer token');
});

it('preserves the remaining row DOM when deleting an earlier row and supports adding rows', async () => {
  await act(async () => root.render(<Form existing />));
  const remaining = container.querySelectorAll('input')[2];
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Remove Header"]')!.click());
  expect(container.querySelector('input')).toBe(remaining);
  await type(remaining, '-Id');
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Add Header'))!.click());
  await type(container.querySelectorAll('input')[2], 'New-Header');
});

it('pastes editable rows with unique UI identities and excludes them from saved headers', async () => {
  await act(async () => root.render(<Form />));
  await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Paste')!.click());
  await type(container.querySelector('input')!, '-Extra');
  for (const rows of [parseHeadersPaste('X-Test: one\nX-Test: two')!, parseHeadersPaste('{"Authorization":"token"}')!]) {
    expect(new Set(rows.map(row => row.clientKey)).size).toBe(rows.length);
  }
  expect(headersToRecord(recordToHeaders({ Authorization: 'token' }))).toEqual({ Authorization: 'token' });
});


it.each(['', 'invalid headers', new Error('Clipboard denied')])('shows the project modal when paste fails: %s', async result => {
  if (result instanceof Error) clipboard.mockRejectedValue(result);
  else clipboard.mockResolvedValue(result);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    await act(async () => root.render(<Form existing />));
    const input = container.querySelector('input')!;
    const paste = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Paste')!;
    paste.focus();
    await act(async () => paste.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.classList.contains('xopc-dialog-content')).toBe(true);
    expect(dialog.textContent).toContain('Could not paste headers');
    expect(dialog.textContent).toContain('Paste failed');
    expect(dialog.querySelectorAll('button')).toHaveLength(1);
    expect(alert).not.toHaveBeenCalled();
    expect(input.value).toBe('Authorization');
    await act(async () => dialog.querySelector('button')!.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('input')).toBe(input);
  } finally {
    alert.mockRestore();
  }
});


it('dismisses the paste warning without closing the connector configuration dialog', async () => {
  clipboard.mockResolvedValue('invalid headers');
  const onClose = vi.fn();
  const m = messages('zh');
  await act(async () => root.render(<CustomMcpServerDialog open mode="add"
    initialRow={{ ...emptyMcpServerRow('server-2'), transport: 'streamable-http', url: 'https://example.com/mcp' }}
    existingCustomServers={[]} config={{}} managedServerIds={new Set()}
    t={m.mcpSettings} cs={m.connectorsSettings} onClose={onClose} onSaved={async () => {}}
  />));
  const parentDialog = document.querySelector('[role="dialog"]');
  const paste = Array.from(document.querySelectorAll('button')).find(button => button.textContent === m.mcpSettings.pasteHeaders)!;
  await act(async () => paste.click());
  const dialogs = document.querySelectorAll('[role="dialog"]');
  expect(dialogs).toHaveLength(2);
  const warning = dialogs[1];
  expect(warning.textContent).toContain(m.mcpSettings.pasteHeadersFailed);
  await act(async () => warning.querySelector('button')!.click());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  expect(document.querySelector('[role="dialog"]')).toBe(parentDialog);
  expect(onClose).not.toHaveBeenCalled();
});
