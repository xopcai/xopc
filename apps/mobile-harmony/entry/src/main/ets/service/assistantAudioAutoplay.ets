import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { XopcAssistantAudioItem, XopcAssistantAudioQueue, XopcAssistantAudioResult } from '../common/assistantAudioAutoplay';
import { readChatMedia } from './chatMedia';
import { XopcChatMediaPlayback, XopcChatMediaPlaybackResult } from './chatMediaPlayback';

export class XopcAssistantAudioAutoplay {
  private context?: common.Context;
  private player: XopcChatMediaPlayback = new XopcChatMediaPlayback();
  private queue: XopcAssistantAudioQueue;
  private generation: number = 0;
  private path: string = '';

  constructor() {
    this.queue = new XopcAssistantAudioQueue((item: XopcAssistantAudioItem): Promise<XopcAssistantAudioResult> => this.play(item));
  }

  enqueue(context: common.Context, item: XopcAssistantAudioItem): void {
    this.context = context;
    this.queue.enqueue(item);
  }

  async interrupt(): Promise<void> {
    this.generation++;
    this.queue.clear();
    await this.player.stop();
    await this.removePath();
  }

  private async play(item: XopcAssistantAudioItem): Promise<XopcAssistantAudioResult> {
    const context = this.context;
    if (!context) return 'interrupted';
    const generation = ++this.generation;
    let result: XopcChatMediaPlaybackResult = 'failed';
    try {
      const bytes = await readChatMedia(item.file, item.conversationId, context);
      if (generation !== this.generation) return 'interrupted';
      const path = context.cacheDir + '/assistant-audio-' + util.generateRandomUUID() + '.audio';
      const output = await fs.open(path, fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
      try {
        if (await fs.write(output.fd, bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA');
      } finally { await fs.close(output); }
      if (generation !== this.generation) { await fs.unlink(path); return 'interrupted'; }
      this.path = path;
      await this.player.open(path, bytes.byteLength, true);
      if (generation !== this.generation) return 'interrupted';
      result = await this.player.waitForTerminal();
      return result === 'interrupted' ? 'interrupted' : 'completed';
    } finally {
      if (generation === this.generation) {
        await this.player.stop();
        await this.removePath();
      }
    }
  }

  private async removePath(): Promise<void> {
    const path = this.path; this.path = '';
    if (path) { try { await fs.unlink(path); } catch (_) {} }
  }
}

export const assistantAudioAutoplay: XopcAssistantAudioAutoplay = new XopcAssistantAudioAutoplay();
