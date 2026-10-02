// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import { TaskTriggerCard } from '@/features/chat/messages/task-trigger-card';

describe('task update trigger', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => { root?.unmount(); container?.remove(); });

  it('keeps a task event distinct from user speech and links to its Task', () => {
    const trigger = { entryId: 'entry-1', taskId: 'task-1',
      taskTitle: 'Check prices, then write internal progress on the board', kind: 'result' };
    const rows = sessionWireToUiMessages([
      { role: 'task', turnId: 'run-1', taskTrigger: trigger, timestamp: 100 },
      { role: 'assistant', turnId: 'run-1', startsNewBubble: true, content: 'I checked it.' },
    ]);
    expect(rows.map((row) => row.role)).toEqual(['task', 'assistant']);
    expect(rows[0]?.taskTrigger).toEqual(trigger);
    const taskTrigger = rows[0]?.taskTrigger;
    if (!taskTrigger) throw new Error('Expected task trigger');
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<MemoryRouter><TaskTriggerCard trigger={taskTrigger} /></MemoryRouter>));
    expect(container.textContent).toContain('Check prices');
    expect(container.textContent).not.toContain('internal progress');
    expect(container.textContent).not.toContain('Task update');
    expect(container.querySelector('[data-task-trigger]')?.className).toContain('border-t');
    expect(container.querySelector('a span')?.className).toContain('truncate');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/tasks/task-1');
  });
});
