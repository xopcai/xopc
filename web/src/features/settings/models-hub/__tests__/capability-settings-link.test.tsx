// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { CapabilityConnectionContext, CapabilitySettingsLink } from '../capability-settings-link';
let container: HTMLDivElement; let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function Location() { return <output>{useLocation().pathname}</output>; }
it.each([true, false])('opens the canonical connection modal, inline context=%s', async inline => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const connect = vi.fn();
  await act(async () => root.render(<MemoryRouter initialEntries={['/chat/new']}><CapabilityConnectionContext.Provider value={inline ? connect : null}><CapabilitySettingsLink to="/settings/capabilities/models?tab=services&configure=transcription">Manage</CapabilitySettingsLink><Location /></CapabilityConnectionContext.Provider></MemoryRouter>));
  await act(async () => container.querySelector('a')!.click());
  expect(container.querySelector('output')?.textContent).toBe(inline ? '/chat/new' : '/settings/capabilities/models');
  if (inline) expect(connect).toHaveBeenCalledExactlyOnceWith('transcription'); else expect(connect).not.toHaveBeenCalled();
});
