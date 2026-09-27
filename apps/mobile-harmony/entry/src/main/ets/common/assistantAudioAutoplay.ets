import { XopcChatRow, XopcHistoryMedia } from '../model/chat';

export interface XopcAssistantAudioItem {
  key: string;
  conversationId: string;
  file: XopcHistoryMedia;
}

export type XopcAssistantAudioResult = 'completed' | 'interrupted';

export interface XopcAssistantAudioState {
  conversationId: string;
  enabled: boolean;
  wasStreaming: boolean;
  lastSeenKey: string;
}

export interface XopcAssistantAudioAdvance {
  state: XopcAssistantAudioState;
  candidate?: XopcAssistantAudioItem;
}

export function latestAssistantAudio(rows: XopcChatRow[], conversationId: string): XopcAssistantAudioItem | undefined {
  for (let rowIndex = rows.length - 1; rowIndex >= 0; rowIndex--) {
    const row = rows[rowIndex];
    if (row.role !== 'assistant') continue;
    const media = row.media || [];
    for (let mediaIndex = media.length - 1; mediaIndex >= 0; mediaIndex--) {
      const file = media[mediaIndex];
      if (!file.mimeType.startsWith('audio/')) continue;
      const identity = file.id || file.uri || file.workspaceRelativePath || file.name;
      return { key: conversationId + ':' + row.id + ':' + identity, conversationId, file };
    }
  }
  return undefined;
}

// Only a streaming completion edge may emit a candidate. Loading persisted history establishes the baseline.
export function advanceAssistantAudio(previous: XopcAssistantAudioState | undefined, conversationId: string,
  enabled: boolean, streaming: boolean, candidate?: XopcAssistantAudioItem): XopcAssistantAudioAdvance {
  if (!previous || previous.conversationId !== conversationId) {
    return { state: { conversationId, enabled, wasStreaming: streaming,
      lastSeenKey: streaming ? '' : candidate?.key || '' } };
  }
  if (!enabled || !previous.enabled) {
    return { state: { conversationId, enabled, wasStreaming: streaming,
      lastSeenKey: streaming ? previous.lastSeenKey : candidate?.key || previous.lastSeenKey } };
  }
  const awaiting = previous.wasStreaming || streaming;
  const completed = awaiting && !streaming && !!candidate && candidate.key !== previous.lastSeenKey;
  return { state: { conversationId, enabled, wasStreaming: completed ? false : awaiting,
    lastSeenKey: completed ? candidate!.key : previous.lastSeenKey }, candidate: completed ? candidate : undefined };
}

export class XopcAssistantAudioQueue {
  private pending: XopcAssistantAudioItem[] = [];
  private seen: Set<string> = new Set<string>();
  private seenOrder: string[] = [];
  private active: boolean = false;
  private play: (item: XopcAssistantAudioItem) => Promise<XopcAssistantAudioResult>;
  private maxPending: number;

  constructor(play: (item: XopcAssistantAudioItem) => Promise<XopcAssistantAudioResult>, maxPending: number = 8) {
    this.play = play;
    this.maxPending = maxPending;
  }

  enqueue(item: XopcAssistantAudioItem): void {
    if (this.seen.has(item.key)) return;
    this.seen.add(item.key);
    this.seenOrder.push(item.key);
    if (this.seen.size > 128) {
      const oldest: string | undefined = this.seenOrder.shift();
      if (oldest) this.seen.delete(oldest);
    }
    if (this.pending.length >= this.maxPending) this.pending.shift();
    this.pending.push(item);
    this.pump();
  }

  clear(): void { this.pending = []; }

  private async pump(): Promise<void> {
    if (this.active) return;
    const item = this.pending.shift();
    if (!item) return;
    this.active = true;
    try {
      if (await this.play(item) === 'interrupted') this.clear();
    } catch (_) {
      // A failed track must not block later assistant audio.
    } finally {
      this.active = false;
      this.pump();
    }
  }
}
