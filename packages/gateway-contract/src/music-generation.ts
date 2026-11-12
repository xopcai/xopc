export type MusicMode = 'song' | 'instrumental';
export type MusicJobState = 'queued' | 'submitting' | 'submitted' | 'running' | 'saving' | 'completed' | 'failed' | 'submission_unknown';

export interface MusicGenerationJob {
  id: string;
  workId: string;
  parentId: string | null;
  versionNumber: number;
  modelRef: string;
  title: string;
  mode: MusicMode;
  prompt: string;
  lyrics: string | null;
  state: MusicJobState;
  durationMs: number | null;
  error: string | null;
  createdAt: number;
}

export interface MusicGenerationSession {
  configured: boolean;
  jobs: MusicGenerationJob[];
}

export interface MusicGenerationDefaults {
  mode: MusicMode;
}

export interface MusicModelSettings {
  defaults: MusicGenerationDefaults;
  modelRef: string;
  models: Array<{
    ref: string;
    name: string;
    providerId: string;
    modes: readonly MusicMode[];
  }>;
  credentials: Record<string, 'saved' | 'environment' | 'missing'>;
}
