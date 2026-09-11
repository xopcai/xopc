import type { RealtimeDelivery, RealtimeEvent, RealtimeSubscriptionHandle } from '../../realtime/broker.js';
import type { SessionInput, SessionInputState } from '../../storage/sqlite/session-input-repository.js';
import type { SubmitSessionInput } from '../../gateway/service/session-input-coordinator.js';

const RUN_ASSIGNMENT_TIMEOUT_MS = 5_000;
const RUN_ASSIGNMENT_POLL_MS = 20;
const MAX_TRACKED_TASKS = 256;

export interface VoiceAgentEvent { type: string; payload?: Record<string, unknown> }
export interface VoiceAgentTask { taskId: string; runId: string; events: AsyncIterable<VoiceAgentEvent> }
export interface VoiceAgentBroker {
  delegate(input: { sessionKey: string; expectedSessionId: string; turnId: string; text: string; signal: AbortSignal }): Promise<VoiceAgentTask>;
  cancel(taskId: string): Promise<boolean>;
}

type SubmitResult =
  | { ok: true; effectiveDelivery: 'next' | 'steer'; state: SessionInputState }
  | { ok: false; code: string };
type BrokerDependencies = {
  submit(input: SubmitSessionInput): Promise<SubmitResult>;
  find(sessionKey: string, clientMessageId: string): SessionInput | undefined;
  snapshot(sessionKey: string): SessionInputState;
  currentSequence(topic: string): number;
  subscribe(topic: string, afterSeq: number, listener: (event: RealtimeEvent) => void): RealtimeSubscriptionHandle;
  cancelRun(runId: string): Promise<void>;
};

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); reject(signal.reason ?? new Error('Voice task subscription cancelled')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

function eventData(delivery: RealtimeDelivery): VoiceAgentEvent | undefined {
  if (delivery.kind !== 'realtime.event') return undefined;
  const value = delivery.payload.data;
  return value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
    ? value as VoiceAgentEvent : undefined;
}

/** Durable voice-to-Agent boundary. Playback and socket cancellation only detach event delivery. */
export class DurableVoiceAgentBroker implements VoiceAgentBroker {
  private readonly runByTask = new Map<string, string>();
  constructor(private readonly deps: BrokerDependencies) {}

  async delegate(input: { sessionKey: string; expectedSessionId: string; turnId: string; text: string; signal: AbortSignal }): Promise<VoiceAgentTask> {
    const clientMessageId = `voice:${input.expectedSessionId}:${input.turnId}`;
    const activeRunId = this.deps.snapshot(input.sessionKey).activeRunId;
    const activeRunCursor = activeRunId ? this.deps.currentSequence(`run:${activeRunId}`) : 0;
    const result = await this.deps.submit({ sessionKey: input.sessionKey, expectedSessionId: input.expectedSessionId,
      clientMessageId, delivery: activeRunId ? 'steer' : 'next', content: input.text,
      origin: { type: 'channel', channel: 'voice' } });
    if (result.ok === false) throw new Error(`Voice task submission failed: ${result.code}`);

    const deadline = Date.now() + RUN_ASSIGNMENT_TIMEOUT_MS;
    let row = this.deps.find(input.sessionKey, clientMessageId);
    while (!row?.runId && !row?.targetRunId) {
      if (row && ['completed', 'cancelled', 'failed', 'interrupted'].includes(row.status)) {
        throw new Error(row.error ?? `Voice task ended before assignment: ${row.status}`);
      }
      if (Date.now() >= deadline) throw new Error('Voice task run assignment timed out');
      await sleep(RUN_ASSIGNMENT_POLL_MS, input.signal);
      row = this.deps.find(input.sessionKey, clientMessageId);
    }
    const runId = row.runId ?? row.targetRunId!;
    this.runByTask.set(row.id, runId);
    if (this.runByTask.size > MAX_TRACKED_TASKS) this.runByTask.delete(this.runByTask.keys().next().value!);
    const afterSeq = result.effectiveDelivery === 'steer' && runId === activeRunId ? activeRunCursor : 0;
    return { taskId: row.id, runId, events: this.events(row.id, runId, afterSeq, input.signal) };
  }

  async cancel(taskId: string): Promise<boolean> {
    const runId = this.runByTask.get(taskId);
    if (!runId) return false;
    await this.deps.cancelRun(runId);
    this.runByTask.delete(taskId);
    return true;
  }

  private async *events(taskId: string, runId: string, afterSeq: number, signal: AbortSignal): AsyncGenerator<VoiceAgentEvent> {
    const queued: RealtimeDelivery[] = [];
    let wake: (() => void) | undefined;
    const push = (event: RealtimeDelivery) => { queued.push(event); wake?.(); wake = undefined; };
    const subscription = this.deps.subscribe(`run:${runId}`, afterSeq, push);
    subscription.initial.forEach(push);
    const abort = () => { wake?.(); wake = undefined; };
    signal.addEventListener('abort', abort, { once: true });
    try {
      while (!signal.aborted) {
        if (!queued.length) await new Promise<void>(resolve => { wake = resolve; });
        if (signal.aborted) return;
        const delivery = queued.shift();
        if (!delivery) continue;
        if (delivery.kind === 'realtime.gap') throw new Error('Voice task event history is unavailable');
        const event = eventData(delivery);
        if (!event) continue;
        yield event;
        if (event.type === 'stream_end') { this.runByTask.delete(taskId); return; }
      }
    } finally {
      signal.removeEventListener('abort', abort);
      subscription.unsubscribe();
    }
  }
}
