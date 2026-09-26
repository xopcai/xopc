import { afterEach, describe, expect, it } from 'vitest';

import { requestSessionSync, resetSessionSyncCoordinatorForTests } from '../session-sync-coordinator';

afterEach(resetSessionSyncCoordinatorForTests);

describe('requestSessionSync', () => {
  it('coalesces concurrent triggers into one active and one trailing refresh', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    const sync = async () => {
      calls += 1;
      if (calls === 1) await gate;
    };

    const first = requestSessionSync('gateway:session', sync);
    const second = requestSessionSync('gateway:session', sync);
    const third = requestSessionSync('gateway:session', sync);
    expect(calls).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    release();
    await first;
    expect(calls).toBe(2);
  });

  it('does not couple different sessions', async () => {
    const calls: string[] = [];
    await Promise.all([
      requestSessionSync('a', async () => { calls.push('a'); }),
      requestSessionSync('b', async () => { calls.push('b'); }),
    ]);
    expect(calls.sort()).toEqual(['a', 'b']);
  });
});
