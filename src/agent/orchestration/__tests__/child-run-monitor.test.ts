import { afterEach, expect, it } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { closeXopcDatabase } from '../../../storage/sqlite/connection.js';
import { getChildRun, getChildRunMessages, listChildRuns, monitorChildRun } from '../child-run-monitor.js';

afterEach(() => { closeXopcDatabase(); delete (globalThis as Record<symbol, unknown>)[Symbol.for('xopc.child-run-monitor')]; });

it('restores child transcripts after runtime ownership is lost and isolates the parent', () => {
  initializeTestAgentCatalog();
  const monitor = monitorChildRun({ id: 'durable-child', parentConversationId: 'parent-A', task: 'inspect the parser', workspace: '/fixture', modelRef: 'fixture/model', allowedTools: ['read_file'], abort: () => {} });
  monitor.snapshot([{ role: 'user', content: 'remember the parser', timestamp: 1 }]);
  monitor.append('partial evidence');
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('xopc.child-run-monitor')];
  expect(getChildRun('parent-A', 'durable-child')).toMatchObject({ status: 'interrupted', allowedTools: ['read_file'] });
  expect(getChildRunMessages('parent-A', 'durable-child')[0]).toMatchObject({ content: 'remember the parser' });
  expect(listChildRuns('parent-B')).toEqual([]);
  expect(() => getChildRunMessages('parent-B', 'durable-child')).toThrow('not found');
});
