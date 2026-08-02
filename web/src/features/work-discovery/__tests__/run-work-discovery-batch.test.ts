import { describe, expect, it, vi } from 'vitest';

import type { WorkDiscoveryCandidate, WorkDiscoveryRun } from '../api';
import { runWorkDiscoveryBatch } from '../run-work-discovery-batch';

function candidate(rootPath: string): WorkDiscoveryCandidate {
  return {
    id: `path:${rootPath}`,
    rootPath,
    displayName: rootPath.slice(1),
    source: 'common_work_root',
    projectKind: 'coding',
    projectKindConfidence: 1,
    score: 80,
    changedFileCount: 0,
    evidence: [],
  };
}

function run(rootPath: string, status: WorkDiscoveryRun['status']): WorkDiscoveryRun {
  return {
    id: `run:${rootPath}`,
    rootPath,
    status,
    projectId: `project:${rootPath}`,
    sessionKey: `session:${rootPath}`,
  };
}

describe('runWorkDiscoveryBatch', () => {
  it('waits for each directory run before starting the next one', async () => {
    const events: string[] = [];
    const polls = new Map<string, number>();
    const selected = [candidate('/one'), candidate('/two')];

    const results = await runWorkDiscoveryBatch(selected, {
      grantDirectory: vi.fn(async (rootPath) => { events.push(`grant:${rootPath}`); }),
      startRun: vi.fn(async (rootPath) => {
        events.push(`start:${rootPath}`);
        return run(rootPath, 'queued');
      }),
      fetchRun: vi.fn(async (runId) => {
        const rootPath = runId.replace('run:', '');
        const count = (polls.get(runId) ?? 0) + 1;
        polls.set(runId, count);
        events.push(`poll:${rootPath}:${count}`);
        return run(rootPath, count === 1 ? 'analyzing' : 'completed');
      }),
      onRun: vi.fn(),
      wait: async () => {},
    });

    expect(results.map((item) => item.status)).toEqual(['completed', 'completed']);
    expect(events).toEqual([
      'grant:/one',
      'start:/one',
      'poll:/one:1',
      'poll:/one:2',
      'grant:/two',
      'start:/two',
      'poll:/two:1',
      'poll:/two:2',
    ]);
  });

  it('stops the queue after the current run is canceled', async () => {
    const startRun = vi.fn(async (rootPath: string) => run(rootPath, 'queued'));
    const results = await runWorkDiscoveryBatch([candidate('/one'), candidate('/two')], {
      grantDirectory: async () => {},
      startRun,
      fetchRun: async () => run('/one', 'canceled'),
      onRun: vi.fn(),
      wait: async () => {},
    });

    expect(results).toHaveLength(1);
    expect(startRun).toHaveBeenCalledTimes(1);
  });

  it('reports a directory failure and continues with the remaining selection', async () => {
    const onError = vi.fn();
    const startRun = vi.fn(async (rootPath: string) => run(rootPath, 'completed'));

    const results = await runWorkDiscoveryBatch([candidate('/one'), candidate('/two')], {
      grantDirectory: async (rootPath) => {
        if (rootPath === '/one') throw new Error('permission denied');
      },
      startRun,
      fetchRun: async () => { throw new Error('not reached'); },
      onRun: vi.fn(),
      onError,
      wait: async () => {},
    });

    expect(onError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ rootPath: '/one' }), 0);
    expect(startRun).toHaveBeenCalledWith('/two');
    expect(results.map((item) => item.rootPath)).toEqual(['/two']);
  });
});
