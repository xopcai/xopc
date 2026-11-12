import { createLogger } from '../utils/logger.js';
import { deleteVideoArtifact, storeVideoArtifact, videoArtifactExists } from './artifact.js';
import { beginVideoSubmission, claimVideoJob, getVideoJob, updateVideoJob } from './repository.js';
import { VideoProviderError } from './provider-types.js';
import { fetchProviderVideo, getVideoProvider } from './providers.js';

const log = createLogger('VideoGeneration');
const POLL_MS = 15_000;
const RETRY_MS = 30_000;

export class VideoGenerationWorker {
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
    this.work = this.runNext().catch(err => log.error({ err }, 'Video worker iteration failed'))
      .finally(() => { this.work = undefined; });
  }

  private async runNext(): Promise<void> {
    const claimed = claimVideoJob();
    if (!claimed) return;
    const { row, token } = claimed;
    const id = row.id;
    const provider = getVideoProvider(row.model_ref);

    if (row.state === 'saving' && await videoArtifactExists(id)) {
      updateVideoJob(id, token, 'completed');
      return;
    }
    if (Date.now() - row.created_at >= provider.taskTtlMs) {
      updateVideoJob(id, token, 'failed', { error: `The ${provider.name} task or download expired.` });
      return;
    }

    const key = await provider.resolveKey().catch(() => undefined);
    if (!key) {
      updateVideoJob(id, token, row.state, { delayMs: RETRY_MS, error: `Configure a ${provider.name} API key to resume.` });
      return;
    }

    if (row.state === 'queued') {
      if (!beginVideoSubmission(id, token)) return;
      try {
        const providerTaskId = await provider.submit(key, row);
        updateVideoJob(id, token, 'submitted', { providerTaskId, delayMs: POLL_MS });
      } catch (error) {
        if (error instanceof VideoProviderError && error.rejected) {
          updateVideoJob(id, token, 'failed', { error: error.message });
        } else {
          updateVideoJob(id, token, 'submission_unknown', {
            error: `${provider.name} may have accepted the request. Check its console before generating again.`,
          });
        }
      }
      return;
    }

    let saving = row.state === 'saving';
    try {
      const result = await provider.query(key, row.provider_task_id!);
      switch (result.state) {
        case 'submitted':
        case 'running':
          updateVideoJob(id, token, result.state, { delayMs: POLL_MS });
          return;
        case 'completed':
          if (result.expiresAt && result.expiresAt <= Date.now()) {
            updateVideoJob(id, token, 'failed', { error: `The ${provider.name} download link expired.` });
            return;
          }
          if (!updateVideoJob(id, token, 'saving', { keepLease: true })) return;
          saving = true;
          await storeVideoArtifact(id, await fetchProviderVideo(provider, result.url));
          if (!updateVideoJob(id, token, 'completed') && !getVideoJob(row.conversation_id, id)) {
            await deleteVideoArtifact(id);
          }
          return;
        case 'failed':
          updateVideoJob(id, token, 'failed', { error: result.reason });
          return;
      }
    } catch {
      updateVideoJob(id, token, saving ? 'saving' : row.state, {
        delayMs: RETRY_MS, error: saving ? 'Video download failed. Retrying.' : `${provider.name} status check failed. Retrying.`,
      });
    }
  }
}
