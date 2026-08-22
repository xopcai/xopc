import crypto from 'node:crypto';

import {
  REALTIME_PROTOCOL_VERSION,
  realtimeEventNameSchema,
  realtimeTopicSchema,
  type ServerRealtimeMessage,
} from '@xopcai/realtime-protocol';

export type RealtimeEvent = Extract<ServerRealtimeMessage, { kind: 'realtime.event' }>;
export type RealtimeGap = Extract<ServerRealtimeMessage, { kind: 'realtime.gap' }>;
export type RealtimeDelivery = RealtimeEvent | RealtimeGap;

export interface RealtimeTopicPolicy {
  replayCapacity: number;
}

export type RealtimeTopicPolicyResolver = (topic: string) => RealtimeTopicPolicy;

type TopicState = {
  nextSeq: number;
  events: RealtimeEvent[];
  listeners: Set<(event: RealtimeEvent) => void>;
};

export interface RealtimeSubscriptionHandle {
  initial: RealtimeDelivery[];
  cursor: number;
  unsubscribe: () => void;
}

const DEFAULT_TOPIC_POLICY: RealtimeTopicPolicy = { replayCapacity: 0 };

export function defaultRealtimeTopicPolicy(topic: string): RealtimeTopicPolicy {
  if (topic.startsWith('run:')) return { replayCapacity: 8_000 };
  if (topic.startsWith('session:')) return { replayCapacity: 200 };
  if (topic === 'logs') return { replayCapacity: 500 };
  if (topic === 'gateway' || topic === 'sessions') return { replayCapacity: 1_000 };
  return DEFAULT_TOPIC_POLICY;
}

export class RealtimeBroker {
  private readonly topics = new Map<string, TopicState>();

  constructor(
    private readonly resolvePolicy: RealtimeTopicPolicyResolver = defaultRealtimeTopicPolicy,
    private readonly onListenerError: (error: unknown, topic: string) => void = () => {},
  ) {}

  publish(topic: string, event: string, data: unknown, now = Date.now()): RealtimeEvent {
    realtimeTopicSchema.parse(topic);
    realtimeEventNameSchema.parse(event);
    const state = this.ensureTopic(topic);
    const message: RealtimeEvent = {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      messageId: crypto.randomUUID(),
      kind: 'realtime.event',
      sentAt: now,
      payload: { topic, seq: state.nextSeq++, event, data },
    };
    const capacity = this.resolvePolicy(topic).replayCapacity;
    if (capacity > 0) {
      state.events.push(message);
      if (state.events.length > capacity) state.events.splice(0, state.events.length - capacity);
    }
    for (const listener of state.listeners) {
      try {
        listener(message);
      } catch (error) {
        this.onListenerError(error, topic);
      }
    }
    return message;
  }

  subscribe(
    topic: string,
    afterSeq: number | undefined,
    listener: (event: RealtimeEvent) => void,
  ): RealtimeSubscriptionHandle {
    realtimeTopicSchema.parse(topic);
    const state = this.ensureTopic(topic);
    state.listeners.add(listener);
    const initial = afterSeq === undefined ? [] : this.replayFrom(topic, state, afterSeq);
    const gap = initial[0]?.kind === 'realtime.gap' ? initial[0] : undefined;
    const currentSeq = state.nextSeq - 1;
    return {
      initial,
      cursor: gap ? gap.payload.earliestSeq - 1 : afterSeq === undefined ? currentSeq : Math.min(afterSeq, currentSeq),
      unsubscribe: () => {
        state.listeners.delete(listener);
      },
    };
  }

  removeTopic(topic: string): void {
    this.topics.delete(topic);
  }

  currentSequence(topic: string): number {
    return (this.topics.get(topic)?.nextSeq ?? 1) - 1;
  }

  hasTopic(topic: string): boolean {
    return this.topics.has(topic);
  }

  private replayFrom(topic: string, state: TopicState, afterSeq: number): RealtimeDelivery[] {
    const currentSeq = state.nextSeq - 1;
    if (afterSeq > currentSeq) {
      return [{
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        messageId: crypto.randomUUID(),
        kind: 'realtime.gap',
        sentAt: Date.now(),
        payload: {
          topic,
          requestedSeq: afterSeq,
          earliestSeq: state.events[0]?.payload.seq ?? 1,
          recoverable: false,
        },
      }];
    }
    if (currentSeq <= afterSeq) return [];
    const earliestSeq = state.events[0]?.payload.seq;
    if (earliestSeq === undefined || afterSeq + 1 < earliestSeq) {
      const gap: RealtimeGap = {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        messageId: crypto.randomUUID(),
        kind: 'realtime.gap',
        sentAt: Date.now(),
        payload: {
          topic,
          requestedSeq: afterSeq,
          earliestSeq: earliestSeq ?? currentSeq + 1,
          recoverable: earliestSeq !== undefined,
        },
      };
      return [gap, ...state.events];
    }
    return state.events.filter((event) => event.payload.seq > afterSeq);
  }

  private ensureTopic(topic: string): TopicState {
    let state = this.topics.get(topic);
    if (!state) {
      state = { nextSeq: 1, events: [], listeners: new Set() };
      this.topics.set(topic, state);
    }
    return state;
  }
}
