// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

import { fetchConversationPhone, phonePoint } from '../phone-live-api';
import { useRightWorkspaceStore as workspace } from '@/stores/right-workspace-store';

beforeEach(() => workspace.getState().reset());
it('maps the image rectangle without accepting letterbox clicks', () => {
  const rect = { left: 100, top: 50, width: 400, height: 400 };
  expect(phonePoint(rect, 100, 200, 300, 250)).toEqual([500, 500]);
  expect(phonePoint(rect, 100, 200, 110, 250)).toBeNull();
  expect(phonePoint(rect, 200, 100, 300, 60)).toBeNull();
  expect(phonePoint(rect, 200, 100, 300, 250)).toEqual([500, 500]);
});
it('deduplicates phone tabs per conversation and preserves a file the user is viewing', () => {
  const s = workspace.getState();
  const file = s.openFile({ path: 'notes.md' }, 'chat-one');
  s.openPhone('phone-one', 'Emulator', 'chat-one', false);
  s.openPhone('phone-one', 'Emulator', 'chat-one', false);
  expect(workspace.getState().panes['chat-one']).toMatchObject({ activeId: file, tabs: [{ kind: 'file' }, { kind: 'phone' }] });
  s.openPhone('phone-one', 'Emulator', 'chat-two', false);
  expect(workspace.getState().panes['chat-two']).toMatchObject({ open: false, tabs: [{ kind: 'phone' }] });
  s.openPhone('phone-one', 'Emulator', 'chat-one', true);
  expect(workspace.getState().panes['chat-one']).toMatchObject({ open: true, activeId: 'phone:phone-one' });
  s.setOpen(false, 'chat-one');
  expect(workspace.getState().panes['chat-two'].open).toBe(false);
});

it('keeps a draft conversation pollable after its initial not-found response', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  try {
    fetch.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    expect(await fetchConversationPhone('/api/phone/conversations/draft')).toBeNull();
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ payload: { report: { sessionId: 'live' } } }), { status: 200 }));
    expect(await fetchConversationPhone('/api/phone/conversations/draft')).toMatchObject({ report: { sessionId: 'live' } });
  } finally { fetch.mockRestore(); }
});
