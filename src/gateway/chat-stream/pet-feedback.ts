import type {
  PetFeedback,
  PetFeedbackProgress,
  PetFeedbackReassurance,
  PetFeedbackTaskState,
} from './protocol.js';

type PetFeedbackKind = 'progress' | 'clarify' | 'success' | 'error';

export interface PetFeedbackOptions {
  publicSummary?: string;
  progress?: Partial<PetFeedbackProgress>;
  recoverable?: boolean;
}

function boundedProgress(progress: PetFeedbackOptions['progress']): PetFeedbackProgress | undefined {
  if (!progress || typeof progress.completed !== 'number' || typeof progress.total !== 'number') return undefined;
  if (!Number.isFinite(progress.completed) || !Number.isFinite(progress.total) || progress.total <= 0) return undefined;
  const total = Math.max(1, Math.floor(progress.total));
  return { completed: Math.min(total, Math.max(0, Math.floor(progress.completed))), total };
}

function safeExplicitSummary(value: string | undefined): string | undefined {
  const summary = value?.replace(/\s+/g, ' ').trim();
  return summary ? summary.slice(0, 160) : undefined;
}

/**
 * Builds ambient-safe companion feedback. Raw questions, errors, and tool output
 * must never be used as a fallback for publicSummary.
 */
export function createPetFeedback(kind: PetFeedbackKind, options: PetFeedbackOptions = {}): PetFeedback {
  const taskState: PetFeedbackTaskState = kind === 'progress'
    ? 'working'
    : kind === 'clarify'
      ? 'waiting'
      : kind;
  const reassurance: PetFeedbackReassurance = kind === 'progress'
    ? 'making_progress'
    : kind === 'clarify'
      ? 'waiting_safely'
      : kind === 'success'
        ? 'completed'
        : options.recoverable === true
          ? 'work_preserved'
          : 'details_available';
  const nextAction = kind === 'clarify'
    ? { type: 'confirm' as const, label: 'confirm' as const }
    : kind === 'error'
      ? { type: 'review_error' as const, label: 'review_error' as const }
      : { type: 'open_session' as const, label: 'open_session' as const };
  const publicSummary = safeExplicitSummary(options.publicSummary);
  const progress = boundedProgress(options.progress);

  return {
    version: 2,
    taskState,
    sensitivity: publicSummary ? 'public' : 'private',
    reassurance,
    nextAction,
    ...(publicSummary ? { publicSummary } : {}),
    ...(progress ? { progress } : {}),
  };
}
