import type { MessageContent, ThinkingContent } from './messages.types';

/** Match legacy snapshots by prefix, but never cross known model-message identities. */
export function findThinkingSnapshot(
  content: MessageContent[],
  incoming: ThinkingContent,
  matched: Set<number>,
): number {
  return content.findIndex((block, index) => {
    if (matched.has(index) || block.type !== 'thinking') return false;
    if (block.segmentId && incoming.segmentId && block.segmentId !== incoming.segmentId) return false;
    const storedText = block.text.trim();
    const liveText = incoming.text.trim();
    if (!storedText || !liveText) return Boolean(block.segmentId && block.segmentId === incoming.segmentId);
    return storedText.startsWith(liveText) || liveText.startsWith(storedText);
  });
}
