import type { ImageJobState, MusicJobState, VideoGenerationState } from '@xopcai/gateway-contract';

import { afterSqliteCommit } from '../storage/sqlite/transaction.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('MediaGeneration');
const listeners = new Set<(conversationId: string, transcriptId: string) => void>();

export function mediaGenerationPhase(state: ImageJobState | MusicJobState | VideoGenerationState) {
  switch (state) {
    case 'completed':
    case 'failed':
    case 'submission_unknown':
      return state;
    default:
      return 'pending';
  }
}

export function onMediaGenerationChanged(listener: (conversationId: string, transcriptId: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyMediaGenerationAfterCommit(conversationId: string, transcriptId: string): void {
  afterSqliteCommit(() => {
    for (const listener of listeners) {
      try { listener(conversationId, transcriptId); }
      catch (err) { log.error({ err, conversationId, transcriptId }, 'Media generation change listener failed'); }
    }
  });
}
