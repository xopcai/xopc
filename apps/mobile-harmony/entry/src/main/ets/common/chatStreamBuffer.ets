import { XopcStreamPayload } from '../model/chat';

class XopcBufferedChatDelta {
  messageId?: string;
  offset: number;
  chunks: string[] = [];
  length: number = 0;
  constructor(messageId: string | undefined, offset: number) { this.messageId = messageId; this.offset = offset; }
}

/** Offsets track received text, independently of the last UI commit. */
export class XopcChatStreamBuffer {
  private pending: Map<string, XopcBufferedChatDelta> = new Map<string, XopcBufferedChatDelta>();

  append(segment: string, displayedText: string, payload: XopcStreamPayload): string {
    const buffered = this.pending.get(segment);
    const displayedLength = displayedText.length;
    const receivedLength = displayedLength + (buffered?.length || 0);
    const offset = payload.offset ?? receivedLength;
    if (offset < 0 || offset > receivedLength) return 'gap';
    if (!payload.delta) return 'replay';
    const overlap = Math.min(receivedLength - offset, payload.delta.length);
    if (overlap && (displayedText + (buffered?.chunks.join('') || '')).slice(offset, offset + overlap) !== payload.delta.slice(0, overlap)) return 'gap';
    const delta = payload.delta.slice(overlap);
    if (!delta) return 'replay';
    const target = buffered || new XopcBufferedChatDelta(payload.messageId, displayedLength);
    target.chunks.push(delta); target.length += delta.length;
    this.pending.set(segment, target);
    return 'accepted';
  }

  drain(): XopcStreamPayload[] {
    const batch = Array.from(this.pending.values()).map((pending: XopcBufferedChatDelta): XopcStreamPayload => ({
      messageId: pending.messageId, offset: pending.offset, delta: pending.chunks.join('') }));
    this.pending.clear();
    return batch;
  }
}
