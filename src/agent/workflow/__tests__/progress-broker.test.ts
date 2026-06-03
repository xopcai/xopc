import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ChannelProgressCapability,
  WorkflowProgressPostInput,
} from '../channel-capability.js';
import { WorkflowProgressBroker } from '../progress-broker.js';
import type { WorkflowAgentSnapshot, WorkflowSnapshot } from '../types.js';

const FAST_THROTTLE_MS = 50;

function snapshot(over: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  return {
    name: 'audit_repo',
    description: 'audit',
    phases: ['Scan'],
    currentPhase: 'Scan',
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0,
    skippedCount: 0,
    ...over,
  };
}

function mkAgent(over: Partial<WorkflowAgentSnapshot> = {}): WorkflowAgentSnapshot {
  return {
    id: 1,
    label: 'x',
    phase: 'Scan',
    prompt: '',
    status: 'running',
    ...over,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeChannel implements ChannelProgressCapability {
  readonly channelId = 'fake';
  readonly supportsEdit = true;
  readonly defaultThrottleMs = FAST_THROTTLE_MS;
  readonly defaultMode = 'edit' as const;
  readonly calls: WorkflowProgressPostInput[] = [];
  private seq = 0;

  async postProgress(input: WorkflowProgressPostInput) {
    this.calls.push(input);
    return { messageId: `m${++this.seq}` };
  }
}

describe('WorkflowProgressBroker', () => {
  let broker: WorkflowProgressBroker;

  beforeEach(() => {
    broker = new WorkflowProgressBroker();
  });

  it('first update is a key event and fires immediately', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);
    broker.onUpdate('s1', 'tc1', snapshot());
    await sleep(5);
    expect(ch.calls).toHaveLength(1);
    expect(ch.calls[0].previousMessageId).toBeUndefined();
    expect(ch.calls[0].isFinal).toBe(false);
  });

  it('subsequent non-key updates are throttled until the window opens', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);

    broker.onUpdate('s1', 'tc1', snapshot()); // first → immediate (key)
    await sleep(5);
    broker.onUpdate('s1', 'tc1', snapshot({ doneCount: 1 })); // non-key → throttled
    await sleep(5);
    expect(ch.calls).toHaveLength(1);

    // Wait past throttle window — scheduled flush fires.
    await sleep(FAST_THROTTLE_MS + 20);
    expect(ch.calls).toHaveLength(2);
  });

  it('phase change bypasses throttle', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);

    broker.onUpdate('s1', 'tc1', snapshot()); // first
    await sleep(5);
    broker.onUpdate(
      's1',
      'tc1',
      snapshot({ currentPhase: 'Synthesize', phases: ['Scan', 'Synthesize'] }),
    );
    await sleep(5);
    expect(ch.calls).toHaveLength(2);
  });

  it('new error bypasses throttle', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);

    broker.onUpdate('s1', 'tc1', snapshot()); // first
    await sleep(5);
    broker.onUpdate(
      's1',
      'tc1',
      snapshot({ errorCount: 1, agents: [mkAgent({ status: 'error' })] }),
    );
    await sleep(5);
    expect(ch.calls).toHaveLength(2);
  });

  it('tool_end always fires regardless of throttle', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);

    broker.onUpdate('s1', 'tc1', snapshot()); // first
    await sleep(5);
    broker.onEnd(
      's1',
      'tc1',
      snapshot({ doneCount: 12, agentCount: 12, durationMs: 60_000, result: { ok: true } }),
    );
    await sleep(5);
    expect(ch.calls).toHaveLength(2);
    expect(ch.calls[1].isFinal).toBe(true);
  });

  it('passes previousMessageId in edit mode after the first send', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);

    broker.onUpdate('s1', 'tc1', snapshot()); // first → m1
    await sleep(5);
    broker.onUpdate(
      's1',
      'tc1',
      snapshot({ currentPhase: 'Synthesize', phases: ['Scan', 'Synthesize'] }),
    );
    await sleep(5);
    expect(ch.calls[1].previousMessageId).toBe('m1');
  });

  it('final-only mode drops mid-run updates and only fires on tool_end', async () => {
    const ch: ChannelProgressCapability = {
      channelId: 'silent',
      supportsEdit: false,
      defaultThrottleMs: 60_000,
      defaultMode: 'final-only',
      postProgress: vi.fn().mockResolvedValue({ messageId: 'mz' }),
    };
    broker.registerChannel(ch);

    broker.onUpdate('s1', 'tc1', snapshot());
    await sleep(5);
    broker.onUpdate(
      's1',
      'tc1',
      snapshot({ currentPhase: 'Synthesize', phases: ['Scan', 'Synthesize'] }),
    );
    await sleep(5);
    expect(ch.postProgress).not.toHaveBeenCalled();

    broker.onEnd('s1', 'tc1', snapshot({ doneCount: 1, agentCount: 1 }));
    await sleep(5);
    expect(ch.postProgress).toHaveBeenCalledTimes(1);
    const arg = (ch.postProgress as ReturnType<typeof vi.fn>).mock.calls[0][0] as WorkflowProgressPostInput;
    expect(arg.isFinal).toBe(true);
  });

  it('config can disable a channel; nothing is dispatched', async () => {
    broker = new WorkflowProgressBroker({
      getConfig: () =>
        ({
          channels: { fake: { workflowProgress: { enabled: false } } },
        }) as any,
    });
    const ch = new FakeChannel();
    broker.registerChannel(ch);
    broker.onUpdate('s1', 'tc1', snapshot());
    await sleep(5);
    expect(ch.calls).toHaveLength(0);
  });

  it('does not crash when postProgress rejects', async () => {
    const ch: ChannelProgressCapability = {
      channelId: 'flaky',
      supportsEdit: true,
      defaultThrottleMs: FAST_THROTTLE_MS,
      defaultMode: 'edit',
      postProgress: vi.fn().mockRejectedValue(new Error('boom')),
    };
    broker.registerChannel(ch);
    broker.onUpdate('s1', 'tc1', snapshot());
    await sleep(5);
    expect(ch.postProgress).toHaveBeenCalledTimes(1);

    // Next key event still tries again — broker survives rejection.
    broker.onUpdate(
      's1',
      'tc1',
      snapshot({ currentPhase: 'Synthesize', phases: ['Scan', 'Synthesize'] }),
    );
    await sleep(5);
    expect(ch.postProgress).toHaveBeenCalledTimes(2);
  });

  it('state is dropped after tool_end (no stale memory after the GC grace period)', async () => {
    const ch = new FakeChannel();
    broker.registerChannel(ch);
    broker.onUpdate('s1', 'tc1', snapshot());
    await sleep(5);
    broker.onEnd('s1', 'tc1', snapshot({ doneCount: 1 }));
    await sleep(5);
    // 2s GC delay in broker.onEnd — wait it out (use fake timer would be cleaner
    // but the rest of the suite avoids them; 2.1s is fine in CI).
    await sleep(2_100);
    expect(broker._stateCount()).toBe(0);
  });

  it('config defaults to enabled when no override is present', async () => {
    broker = new WorkflowProgressBroker({
      getConfig: () => ({}) as any, // no `channels` block at all
    });
    const ch = new FakeChannel();
    broker.registerChannel(ch);
    broker.onUpdate('s1', 'tc1', snapshot());
    await sleep(5);
    expect(ch.calls).toHaveLength(1);
  });
});
