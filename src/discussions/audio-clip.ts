import { spawn } from 'node:child_process';
import type { NotesService } from '../notes/service.js';
import { DiscussionServiceError } from './errors.js';
import { getDiscussionCapture } from './repository.js';

let active = 0;
/** A bounded playback derivative for native clients that require per-request device proofs. */
export async function discussionAudioClip(id: string,startMs: number,endMs: number,notes: NotesService,signal: AbortSignal): Promise<Buffer> {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || endMs - startMs > 120_000) throw new DiscussionServiceError('invalid_input','Audio clip must be at most 120 seconds');
  const capture = getDiscussionCapture(id);
  if (!capture || !capture.audioAttachmentId || capture.audioDeletedAt) throw new DiscussionServiceError('not_found','Original audio unavailable');
  const source = await notes.getAttachmentPath(capture.noteId,capture.audioAttachmentId);
  if (!source) throw new DiscussionServiceError('not_found','Original audio unavailable');
  if (active >= 2) throw new DiscussionServiceError('conflict','Audio playback is busy; retry shortly');
  active++;
  try {
    return await new Promise<Buffer>((resolve,reject) => {
      signal.throwIfAborted();
      const child = spawn(process.env.XOPC_FFMPEG_PATH || 'ffmpeg',['-v','error','-protocol_whitelist','file,pipe','-ss',String(startMs / 1000),'-i',source.filePath,'-t',String((endMs - startMs) / 1000),'-map','0:a:0','-vn','-ar','16000','-ac','1','-f','wav','pipe:1'],{ stdio: ['ignore','pipe','ignore'] });
      const chunks: Buffer[] = []; let bytes = 0;
      const abort = () => { child.kill('SIGKILL'); reject(new Error('Audio clip interrupted')); };
      const timer = setTimeout(abort,30_000); timer.unref(); signal.addEventListener('abort',abort,{ once: true });
      child.stdout.on('data',(chunk: Buffer) => { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) abort(); else chunks.push(chunk); });
      child.once('error',reject); child.once('close',code => { clearTimeout(timer); signal.removeEventListener('abort',abort); if (code || bytes <= 44) reject(new Error('Audio clip unavailable')); else resolve(Buffer.concat(chunks)); });
    });
  } finally { active--; }
}
