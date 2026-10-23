// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';

import { HomeEvidenceLink } from '../home-evidence-link';

it('opens external sources directly and task sources in the home detail overlay', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<MemoryRouter>
      <HomeEvidenceLink href="https://example.com/report">External result</HomeEvidenceLink>
      <HomeEvidenceLink href="/tasks/task-1">Task basis</HomeEvidenceLink>
      <HomeEvidenceLink href="javascript:alert(1)">Observation only</HomeEvidenceLink>
    </MemoryRouter>));
    const links = [...container.querySelectorAll('a')];
    expect(links.map((item) => item.getAttribute('href'))).toEqual(['https://example.com/report', '/?task=task-1']);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(container.textContent).toContain('Observation only');
  } finally { await act(async () => root.unmount()); }
});
