// @vitest-environment jsdom
import { act, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { useReadingPosition } from '../use-reading-position';

it('compensates for changed block heights above the visible paragraph before paint', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  function Reader() {
    const viewport = useRef<HTMLElement>(null);
    const preserve = useReadingPosition(viewport);
    const [updated, setUpdated] = useState(false);
    return <main ref={viewport}>
      <p data-reading-anchor="above">{updated ? 'Expanded text' : 'Short text'}</p>
      <p data-reading-anchor="reading">Reading this paragraph</p>
      <button onClick={() => { preserve(); setUpdated(true); }}>Update</button>
    </main>;
  }
  try {
    await act(async () => root.render(<Reader />));
    const viewport = container.querySelector('main')!; viewport.scrollTop = 200;
    const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => rect(0, 400));
    vi.spyOn(container.querySelector('[data-reading-anchor="above"]')!, 'getBoundingClientRect').mockImplementation(() => rect(-200, -1));
    vi.spyOn(container.querySelector('[data-reading-anchor="reading"]')!, 'getBoundingClientRect').mockImplementation(() => rect((container.textContent.includes('Expanded text') ? 320 : 240) - viewport.scrollTop, 400));
    await act(async () => container.querySelector('button')!.click());
    expect(viewport.scrollTop).toBe(280);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks();
  }
});
