import { common } from '@kit.AbilityKit';
import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { XopcPlaybackRange } from '../model/discussionCapture';
import { XopcDiscussionCaptureRepository } from '../repository/discussionCaptureRepository';
import { XopcAnnotationStore } from './discussionAnnotations';
import { XopcChatMediaPlayback } from './chatMediaPlayback';

@ObservedV2
export class XopcDiscussionReviewPlayback {
  @Trace noteId: string = '';
  @Trace player: XopcChatMediaPlayback = new XopcChatMediaPlayback();
  @Trace sourceStartMs: number = 0;
  @Trace sourceEndMs: number = 0;
  @Trace error: string = '';
  @Trace loading: boolean = false;
  private context?: common.Context;
  private sourceId: string = '';
  private positions: XopcAnnotationStore = new XopcAnnotationStore();
  private path: string = '';
  private generation: number = 0;
  private repository: XopcDiscussionCaptureRepository = new XopcDiscussionCaptureRepository();
  async play(context: common.Context,noteId: string,discussionId: string,range: XopcPlaybackRange,sourceId: string = ''): Promise<void> {
    await this.stop(); const generation = this.generation;
    this.context = context; this.sourceId = sourceId;
    this.noteId = noteId; this.sourceStartMs = range.startedAtMs;
    this.sourceEndMs = Math.min(range.endedAtMs,range.startedAtMs + 120000); this.loading = true;
    try {
      const bytes = await this.repository.audioClip(discussionId,this.sourceStartMs,this.sourceEndMs);
      if (generation !== this.generation) return;
      const path = context.cacheDir + '/note-review-' + util.generateRandomUUID() + '.wav';
      const file = await fs.open(path,fs.OpenMode.CREATE | fs.OpenMode.WRITE_ONLY);
      try {
        try { if (await fs.write(file.fd,bytes) !== bytes.byteLength) throw new Error('INCOMPLETE_MEDIA'); }
        finally { await fs.close(file); }
      } catch (caught) { try { await fs.unlink(path); } catch (_error) {} throw caught as Error; }
      if (generation !== this.generation) { await fs.unlink(path); return; }
      this.path = path; await this.player.open(path,bytes.byteLength,true);
    } catch (caught) { if (generation === this.generation) this.error = (caught as Error).message; }
    finally { if (generation === this.generation) this.loading = false; }
  }
  async stop(): Promise<void> {
    this.generation++; this.loading = false; this.error = '';
    const context = this.context; const noteId = this.noteId; const position = this.sourceStartMs + this.player.position * 1000;
    this.noteId = '';
    if (context && noteId) { try { await this.positions.initialize(context); await this.positions.saveReviewPosition(noteId,position,this.sourceId); } catch (_error) {} }
    await this.player.stop(); const path = this.path; this.path = '';
    if (path) { try { await fs.unlink(path); } catch (_error) {} }
  }
}
export const discussionReviewPlayback: XopcDiscussionReviewPlayback = new XopcDiscussionReviewPlayback();
