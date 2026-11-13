import { createLogger } from '../utils/logger.js';
import { deleteMusicArtifact, musicArtifactExists, saveMusicArtifact } from './artifact.js';
import { MusicRequestRejected } from './provider.js';
import { resolveMusicKey, resolveMusicModel } from './providers.js';
import { claimMusicJob, getMusicJob, updateMusicJob } from './repository.js';

const log = createLogger('MusicGeneration');
const pollMs = 8_000;
const retryMs = 20_000;
const lifetimeMs = 12 * 60 * 60_000;

export class MusicGenerationWorker {
  private timer?: ReturnType<typeof setInterval>;
  private work?: Promise<void>;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1_000);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    await this.work;
  }

  private tick(): void {
    if (this.work) return;
    this.work = this.runNext().catch(err => log.error({ err }, 'Music worker iteration failed'))
      .finally(() => { this.work = undefined; });
  }

  private async runNext(): Promise<void> {
    const claimed = claimMusicJob();
    if (!claimed) return;
    const { row, token } = claimed;
    const { id, mode } = row;

    if (row.state === 'saving' && await musicArtifactExists(id)) {
      updateMusicJob(id, token, 'completed');
      return;
    }
    if (Date.now() - row.created_at >= lifetimeMs) {
      updateMusicJob(id, token, 'failed', {
        error: 'The music task or its download is no longer available.', errorCode: 'expired',
      });
      return;
    }

    const route = resolveMusicModel(row.model_ref);
    const key = route && await resolveMusicKey(route.provider);
    if (!route || !key) {
      updateMusicJob(id, token, row.state, {
        delayMs: retryMs, error: 'Restore the original music model credentials to resume.', errorCode: 'credentials_missing',
      });
      return;
    }
    const { provider, model } = route;
    if (row.state === 'queued') {
      if (!updateMusicJob(id, token, 'submitting', { keepLease: true })) return;
      try {
        const taskId = await provider.submit(key, model, { mode, prompt: row.prompt, lyrics: row.lyrics });
        updateMusicJob(id, token, 'submitted', { taskId, delayMs: pollMs });
      } catch (err) {
        if (err instanceof MusicRequestRejected) {
          updateMusicJob(id, token, 'failed', { error: err.message, errorCode: err.code });
          log.warn({ jobId: id, modelRef: row.model_ref }, err.message);
        } else {
          updateMusicJob(id, token, 'submission_unknown', { error: 'The provider may have accepted this request.' });
          log.warn({ jobId: id, modelRef: row.model_ref }, 'Music submission could not be confirmed');
        }
      }
      return;
    }

    let saving = row.state === 'saving';
    try {
      if (!row.provider_task_id) throw new Error('Missing remote music task ID.');
      const result = await provider.query(key, mode, row.provider_task_id);
      switch (result.state) {
        case 'submitted':
        case 'running':
          updateMusicJob(id, token, result.state, { delayMs: pollMs });
          return;
        case 'failed':
          updateMusicJob(id, token, 'failed', { error: result.reason, errorCode: 'provider_failed' });
          return;
        case 'completed':
          if (!updateMusicJob(id, token, 'saving', { durationMs: result.durationMs, keepLease: true })) return;
          saving = true;
          await saveMusicArtifact(id, provider, result.url, () => updateMusicJob(id, token, 'saving', { keepLease: true }), key);
          if (await musicArtifactExists(id)) updateMusicJob(id, token, 'completed');
          if (!getMusicJob(row.conversation_id, id)) await deleteMusicArtifact(id);
      }
    } catch {
      updateMusicJob(id, token, saving ? 'saving' : row.state, {
        delayMs: retryMs,
        error: saving ? 'Audio download failed. Retrying the same result.' : 'Status check failed. Retrying.',
        errorCode: saving ? 'audio_retrying' : 'status_retrying',
      });
    }
  }
}
