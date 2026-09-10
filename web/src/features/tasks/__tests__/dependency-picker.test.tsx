// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { DependencyPicker } from '@/features/tasks/dependency-picker';

const labels = {
  link: 'Link dependencies',
  linked: 'Linked dependencies: {{count}}',
  searchPlaceholder: 'Search tasks',
  noMatches: 'No matches',
  noCandidates: 'No candidates',
  remove: 'Remove dependency: {{task}}',
};

describe('DependencyPicker', () => {
  it('links selected task titles while keeping removal as a separate action', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    const onChange = vi.fn();

    try {
      await act(async () => root.render(
        <MemoryRouter>
          <DependencyPicker
            candidates={[{ id: 'task 1', title: 'Prerequisite task' }]}
            selectedIds={['task 1']}
            labels={labels}
            getTaskHref={(taskId) => `/tasks/${encodeURIComponent(taskId)}`}
            onChange={onChange}
          />
        </MemoryRouter>,
      ));

      const taskLink = container.querySelector('a');
      expect(taskLink?.textContent).toBe('Prerequisite task');
      expect(taskLink?.getAttribute('href')).toBe('/tasks/task%201');

      const removeButton = container.querySelector('button[aria-label="Remove dependency: Prerequisite task"]');
      expect(removeButton).not.toBeNull();
      await act(async () => removeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      expect(onChange).toHaveBeenCalledWith([]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
