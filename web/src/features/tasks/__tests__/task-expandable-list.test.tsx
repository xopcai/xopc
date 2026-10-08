// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskExpandableList } from '../task-expandable-list';

function Location() { return <output>{useLocation().search}</output>; }

describe('task related work list', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const render = (count: number, search = '?returnTo=%2Fprojects') => act(() => {
    root.render(<MemoryRouter initialEntries={[`/tasks/task${search}`]}>
      <TaskExpandableList contentKey="task:automations" language="zh">
        {Array.from({ length: count }, (_, index) => <li key={index}><a href={`/automations?automation=${index}`}>Automation {index}</a></li>)}
      </TaskExpandableList><Location />
    </MemoryRouter>);
  });
  it('reveals every linked item and preserves navigation parameters', () => {
    render(5);
    expect(container.querySelectorAll('li')).toHaveLength(3);
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('查看全部（5）');
    act(() => button.click());
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.querySelectorAll('a')[4].getAttribute('href')).toBe('/automations?automation=4');
    expect(container.querySelector('output')!.textContent).toContain('returnTo=%2Fprojects');
    act(() => button.click());
    expect(container.querySelectorAll('li')).toHaveLength(3);
    expect(container.querySelector('output')!.textContent).toBe('?returnTo=%2Fprojects');
  });
  it('does not show a toggle for a short list', () => {
    render(3);
    expect(container.querySelector('button')).toBeNull();
  });
  it('restores a fully expanded list from its URL', () => {
    render(5, '?taskExpanded=task%3Aautomations');
    expect(container.querySelectorAll('li')).toHaveLength(5);
    expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('true');
  });
});
