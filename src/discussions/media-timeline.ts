import { spawn } from 'node:child_process';
import type { DiscussionPlaybackRange } from '@xopcai/gateway-contract';

export interface MediaSpan { sourceMs: number; pcmMs: number; durationMs: number }
export interface MediaEpoch { baseMs: number; durationMs: number; spans: MediaSpan[]; verified: boolean }
export interface RecordingTimeline { primary: 'encoded' | 'pcm'; epochs: MediaEpoch[] }
export const pcmEpoch = (durationMs: number, baseMs = 0): MediaEpoch => ({ baseMs, durationMs, verified: true, spans: [{ sourceMs: 0, pcmMs: 0, durationMs }] });

/** Packet timestamps expose pauses without decoding the recording into memory. */
export async function probeMediaEpoch(path: string, durationMs: number, baseMs: number, signal: AbortSignal): Promise<MediaEpoch> {
  const result: MediaEpoch = { baseMs, durationMs, spans: [], verified: false };
  try {
    await new Promise<void>((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawn(process.env.XOPC_FFPROBE_PATH || 'ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_entries', 'packet=pts_time,duration_time:packet_side_data=skip_samples,discard_padding', '-of', 'compact=p=0', path], { stdio: ['ignore', 'pipe', 'ignore'] });
      let pending = ''; let pcm = 0; let packets = 0; let lastStart = -Infinity;
      const abort = () => { child.kill('SIGKILL'); reject(new Error('Timing inspection cancelled')); };
      const timer = setTimeout(abort, 30_000); timer.unref();
      signal.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (text: string) => {
        pending += text;
        const lines = pending.split('\n'); pending = lines.pop()!;
        if (pending.length > 8192) { abort(); return; }
        for (const line of lines) {
          if (!line.trim()) continue;
          const fields = Object.fromEntries(line.split('|').map(part => part.split('=')));
          const pts = Number(fields.pts_time) * 1000;
          const duration = Number(fields.duration_time) * 1000;
          if (++packets > 1_000_000 || !Number.isFinite(pts) || !Number.isFinite(duration) || duration <= 0
            || Number(fields.skip_samples ?? 0) !== 0 || Number(fields.discard_padding ?? 0) !== 0) { abort(); return; }
          const start = Math.max(0, pts); const length = duration - (start - pts);
          if (length <= 0) continue;
          const previous = result.spans.at(-1);
          if (start <= lastStart) { abort(); return; }
          lastStart = start;
          if (previous && Math.abs(start - previous.sourceMs - previous.durationMs) <= 2) previous.durationMs += length;
          else result.spans.push({ sourceMs: start, pcmMs: pcm, durationMs: length });
          pcm += length;
          if (result.spans.length > 10_000) { abort(); return; }
        }
      });
      child.once('error', reject);
      child.once('close', code => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        if (code !== 0 || !result.spans.length || Math.abs(pcm - durationMs) > 100) { reject(new Error('Unverified media timing')); return; }
        result.spans.at(-1)!.durationMs += durationMs - pcm;
        result.verified = result.spans.at(-1)!.durationMs > 0;
        resolve();
      });
    });
  } catch { result.verified = false; }
  return result;
}

export function pointToPcm(epoch: MediaEpoch, sourceMs: number): number | undefined {
  if (!epoch.verified || !Number.isFinite(sourceMs)) return;
  const matches = epoch.spans.filter(span => sourceMs >= span.sourceMs && sourceMs < span.sourceMs + span.durationMs);
  const span = matches.length === 1 ? matches[0] : undefined;
  return span ? epoch.baseMs + span.pcmMs + sourceMs - span.sourceMs : undefined;
}

export function playbackRanges(timeline: RecordingTimeline, start: number, end: number): DiscussionPlaybackRange[] {
  const total = timeline.epochs.reduce((sum,epoch) => sum + epoch.durationMs,0);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > total + 1 ) return [];
  if (timeline.primary === 'pcm') return [{ startedAtMs: start, endedAtMs: end }];
  if (!timeline.epochs.every(epoch => epoch.verified)) return [];
  return timeline.epochs[0]!.spans.flatMap(span => {
    const left = Math.max(start, span.pcmMs); const right = Math.min(end, span.pcmMs + span.durationMs);
    return right > left ? [{ startedAtMs: span.sourceMs + left - span.pcmMs, endedAtMs: span.sourceMs + right - span.pcmMs }] : [];
  });
}
