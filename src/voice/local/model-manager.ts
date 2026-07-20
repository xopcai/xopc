import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from '../../utils/logger.js';
import {
  LOCAL_VOICE_MODELS,
  getLocalVoiceModel,
  isLocalVoiceModelInstalled,
  resolveLocalVoiceModelDir,
  resolveLocalVoiceModelMarkerPath,
} from './models.js';
import { getLocalVoiceRuntimeClient, type LocalVoiceRuntimeProgress } from './runtime-client.js';

const log = createLogger('LocalVoice:Models');

export type LocalVoiceModelState = 'not_installed' | 'downloading' | 'ready' | 'error';

export interface LocalVoiceModelStatus {
  id: string;
  name: string;
  description: string;
  approximateBytes: number;
  engine: string;
  languages: readonly string[];
  recommended?: boolean;
  state: LocalVoiceModelState;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  error?: string;
}

const jobs = new Map<string, LocalVoiceModelStatus>();

function progressFraction(progress: LocalVoiceRuntimeProgress): number | undefined {
  if (typeof progress.progress === 'number' && Number.isFinite(progress.progress)) {
    return progress.progress > 1 ? progress.progress / 100 : progress.progress;
  }
  if (typeof progress.loaded === 'number' && typeof progress.total === 'number' && progress.total > 0) {
    return progress.loaded / progress.total;
  }
  return undefined;
}

export async function listLocalVoiceModelStatuses(): Promise<LocalVoiceModelStatus[]> {
  return Promise.all(
    LOCAL_VOICE_MODELS.map(async (model) => {
      const active = jobs.get(model.id);
      if (active) return { ...active };
      if (!isLocalVoiceModelInstalled(model.id)) {
        return {
          id: model.id,
          name: model.name,
          description: model.description,
          approximateBytes: model.approximateBytes,
          engine: model.engine,
          languages: model.languages,
          recommended: model.recommended,
          state: 'not_installed' as const,
        };
      }
      let installedAt: string | undefined;
      try {
        const marker = JSON.parse(await readFile(resolveLocalVoiceModelMarkerPath(model.id), 'utf8')) as { installedAt?: string };
        installedAt = marker.installedAt;
      } catch {
        // The marker's presence is authoritative; metadata is best-effort.
      }
      return {
        id: model.id,
        name: model.name,
        description: installedAt ? `${model.description} Installed ${installedAt}.` : model.description,
        approximateBytes: model.approximateBytes,
        engine: model.engine,
        languages: model.languages,
        recommended: model.recommended,
        state: 'ready' as const,
      };
    }),
  );
}

export function startLocalVoiceModelInstall(modelId: string): LocalVoiceModelStatus {
  const model = getLocalVoiceModel(modelId);
  const existing = jobs.get(model.id);
  if (existing?.state === 'downloading') return { ...existing };
  const status: LocalVoiceModelStatus = {
    id: model.id,
    name: model.name,
    description: model.description,
    approximateBytes: model.approximateBytes,
    engine: model.engine,
    languages: model.languages,
    recommended: model.recommended,
    state: 'downloading',
    progress: 0,
  };
  jobs.set(model.id, status);
  void (async () => {
    const modelDir = resolveLocalVoiceModelDir(model.id);
    const stagingDir = `${modelDir}.download`;
    try {
      if (model.engine === 'transformers.js') {
        await rm(stagingDir, { recursive: true, force: true });
      }
      await mkdir(stagingDir, { recursive: true });
      await getLocalVoiceRuntimeClient().request(
        'model.install',
        { modelId: model.id, cacheDir: stagingDir },
        {
          onProgress: (progress) => {
            const current = jobs.get(model.id);
            if (!current) return;
            current.progress = progressFraction(progress) ?? current.progress;
            current.downloadedBytes = progress.loaded;
            current.totalBytes = progress.total;
          },
        },
      );
      await writeFile(
        join(stagingDir, 'installed.json'),
        `${JSON.stringify({
          modelId: model.id,
          repository: model.repository,
          revision: model.revision,
          engine: model.engine,
          ...(model.dtype ? { dtype: model.dtype } : {}),
          installedAt: new Date().toISOString(),
        }, null, 2)}\n`,
        { mode: 0o600 },
      );
      await rm(modelDir, { recursive: true, force: true });
      await rename(stagingDir, modelDir);
      jobs.delete(model.id);
      log.info({ modelId: model.id }, 'Local voice model installed');
    } catch (error) {
      // Keep verified/partial sherpa model files so a retry can continue with HTTP Range.
      if (model.engine === 'transformers.js') {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      }
      const message = error instanceof Error ? error.message : String(error);
      jobs.set(model.id, { ...status, state: 'error', error: message });
      log.error({ err: error, modelId: model.id }, `Local voice model installation failed: ${message}`);
    }
  })();
  return { ...status };
}

export async function removeLocalVoiceModel(modelId: string): Promise<void> {
  const model = getLocalVoiceModel(modelId);
  if (jobs.get(model.id)?.state === 'downloading') {
    throw new Error('Cannot remove a model while it is downloading');
  }
  try {
    await getLocalVoiceRuntimeClient().request('model.unload', { modelId: model.id }, { timeoutMs: 10_000 });
  } catch (error) {
    log.warn({ err: error, modelId: model.id }, 'Local voice runtime unload failed; removing model files');
  }
  await rm(resolveLocalVoiceModelDir(model.id), { recursive: true, force: true });
  jobs.delete(model.id);
  log.info({ modelId: model.id }, 'Local voice model removed');
}
