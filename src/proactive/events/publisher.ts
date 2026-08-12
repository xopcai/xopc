import type { PublishEventInput, PublishedEvent } from './types.js';

export interface ProactiveSignalPublisher {
  publish(input: PublishEventInput, observedAt?: Date): PublishedEvent;
}
