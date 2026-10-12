// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { McpHeadersEditor } from '../mcp-headers-editor';
import { createMcpHeaderEntry, headersToRecord, parseHeadersPaste, recordToHeaders } from '../mcp-headers-utils';

vi.mock('@/lib/copy-to-clipboard', () => ({ readTextFromClipboard: async () => 'Authorization: Bearer token\nX-Tenant: team' }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
beforeEach(() => {
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
    pasteLabel="Paste" pasteFailed="Paste failed" keyPlaceholder="Key" valuePlaceholder="Value"
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
