import type { FollowUpMode } from './tui-settings.js';

export function drainFollowUpQueue(queue: string[], mode: FollowUpMode): string | undefined {
  if (mode === 'all') {
    const combined = queue.splice(0).join('\n\n').trim();
    return combined || undefined;
  }
  return queue.shift();
}

export function restoreQueuedMessages(
  queues: {
    steeringQueue: string[];
    followUpQueue: string[];
  },
  currentText: string,
): { text: string; restoredCount: number } {
  const steering = queues.steeringQueue.splice(0);
  const followUp = queues.followUpQueue.splice(0);
  const restored = [...steering, ...followUp];
  const text = [restored.join('\n\n'), currentText.trim()].filter(Boolean).join('\n\n');
  return { text, restoredCount: restored.length };
}
