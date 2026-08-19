import { describe, expect, it } from 'vitest';

import { allowedTaskActions, projectTaskLane } from '../task-board.js';

describe('task board projection', () => {
  it.each([
    ['pending', 'ready'],
    ['paused', 'ready'],
    ['planning', 'moving'],
    ['running', 'moving'],
    ['running', 'moving'],
    ['verifying', 'moving'],
    ['needs_user', 'needs_user'],
    ['blocked', 'needs_user'],
    ['completed', 'done'],
    ['cancelled', undefined],
  ] as const)('projects %s into %s', (status, lane) => {
    expect(projectTaskLane(status)).toBe(lane);
  });

  it('exposes only commands valid for the current state', () => {
    expect(allowedTaskActions('pending')).toEqual(['run', 'cancel']);
    expect(allowedTaskActions('paused')).toEqual(['resume', 'verify', 'cancel']);
    expect(allowedTaskActions('blocked')).toEqual(['resume', 'verify', 'cancel']);
    expect(allowedTaskActions('running')).toEqual(['pause', 'verify', 'cancel']);
    expect(allowedTaskActions('completed')).toEqual([]);
    expect(allowedTaskActions('cancelled')).toEqual([]);
  });
});
