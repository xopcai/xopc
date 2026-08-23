import { describe, expect, it } from 'vitest';

import { closeTaskDetailModalHref, modalizeTaskDetailHref, taskDetailModalHref } from '../task-detail-route';

describe('task detail modal route', () => {
  it('adds the task id while preserving background search params', () => {
    expect(taskDetailModalHref('/projects/p-1/tasks?view=graph', 'task 1'))
      .toBe('/projects/p-1/tasks?view=graph&task=task+1');
  });

  it('replaces an existing task id', () => {
    expect(taskDetailModalHref('/projects/p-1/tasks?task=old', 'next'))
      .toBe('/projects/p-1/tasks?task=next');
  });

  it('removes only the modal task id', () => {
    expect(closeTaskDetailModalHref('/projects/p-1/tasks', '?view=graph&task=t-1'))
      .toBe('/projects/p-1/tasks?view=graph');
  });

  it('turns standalone task links into modal links without changing other links', () => {
    expect(modalizeTaskDetailHref('/home?view=focus', '/tasks/task%201')).toBe('/home?view=focus&task=task+1');
    expect(modalizeTaskDetailHref('/home', '/chat/new')).toBe('/chat/new');
  });
});
