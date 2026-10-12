import type { MessageContent } from '@/features/chat/messages/messages.types';
import { inheritPartIdentity, knownPartRenderKey } from '@/features/chat/rendering/part-identity';

const textRunSources = new WeakMap<MessageContent, string[]>();
export function textRunSourceIds(part: MessageContent): string[] {
  const sources = textRunSources.get(part);
  const id = knownPartRenderKey(part);
  return sources ?? (id ? [id] : []);
}
/** Merge adjacent assistant text fragments so Markdown constructs can span realtime/UI chunks. */
export function mergeConsecutiveTextBlocks(content: MessageContent[]): MessageContent[] {
  const out: MessageContent[] = [];
  for (const block of content) {
    const previous = out[out.length - 1];
    if (
      block.type === 'text'
      && previous?.type === 'text'
      && block.segmentId === previous.segmentId
      && block.presentation === previous.presentation
    ) {
      out[out.length - 1] = { ...previous, text: `${previous.text ?? ''}${block.text ?? ''}` };
      inheritPartIdentity(previous, out[out.length - 1]);
      textRunSources.set(out[out.length - 1], [...textRunSourceIds(previous), ...textRunSourceIds(block)]);
      continue;
    }
    out.push(block);
  }
  return out;
}
