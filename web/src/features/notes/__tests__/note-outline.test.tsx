// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';

import { useNoteOutline } from '../note-outline';

function OutlineProbe() {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { headings, current, goTo } = useNoteOutline(root);
  return (
    <>
      <div ref={setRoot}>
        <h1>Note title</h1>
        <div data-note-outline-scroll>
          <div data-note-outline-content>
            <h2>First section</h2>
            <h3>Second section</h3>
            <h4>Ignored subsection</h4>
          </div>
        </div>
      </div>
      <output>{headings.length >= 2 ? headings.map(({ level, label }) => `${level} ${label}`).join(', ') : 'Hidden'}</output>
      <output>{current?.textContent}</output>
      <button type="button" onClick={() => goTo(headings[1].element)}>Jump to second heading</button>
    </>
  );
}

async function updateOutline(change: () => void) {
  await act(async () => {
    change();
    await new Promise<void>(resolve => window.setTimeout(resolve, 30));
  });
}

it('tracks live H1–H3 headings within the document and scrolls to the selected heading', async () => {
  const container = document.body.appendChild(document.createElement('div'));
  const reactRoot = createRoot(container);
  try {
    act(() => reactRoot.render(<OutlineProbe />));
    const scrollArea = container.querySelector<HTMLElement>('[data-note-outline-scroll]')!;
    const secondHeading = scrollArea.querySelector('h3')!;
    const [entries, active] = container.querySelectorAll('output');
    Object.defineProperties(scrollArea, {
      clientHeight: { value: 400 },
      scrollHeight: { value: 1600 },
    });
    secondHeading.getBoundingClientRect = () => DOMRect.fromRect({ y: 600 - scrollArea.scrollTop });

    expect(entries.textContent).toBe('2 First section, 3 Second section');

    await updateOutline(() => { secondHeading.textContent = 'Edited section'; });
    expect(entries.textContent).toBe('2 First section, 3 Edited section');
    await updateOutline(() => {
      scrollArea.scrollTop = 640;
      scrollArea.dispatchEvent(new Event('scroll'));
    });
    expect(active.textContent).toBe('Edited section');

    act(() => container.querySelector('button')!.click());
    expect(scrollArea.scrollTop).toBe(576);
    expect(active.textContent).toBe('Edited section');

    await updateOutline(() => secondHeading.remove());
    expect(entries.textContent).toBe('Hidden');
  } finally {
    act(() => reactRoot.unmount());
    container.remove();
  }
});
