export type ImageJobState = 'queued' | 'running' | 'saving' | 'completed' | 'failed';

export type ImageJobErrorCode =
  | 'provider_rate_limited'
  | 'provider_rejected'
  | 'provider_failed'
  | 'credentials_missing'
  | 'not_configured'
  | 'expired';

export interface ImageGenerationArtifact {
  index: number;
  mediaUri: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ImageGenerationJob {
  id: string;
  workId: string;
  parentId: string | null;
  versionNumber: number;
  modelRef: string | null;
  title: string;
  prompt: string;
  aspectRatio: string | null;
  resolution: string | null;
  quality: string | null;
  count: number;
  state: ImageJobState;
  images: ImageGenerationArtifact[];
  error: string | null;
  errorCode?: ImageJobErrorCode | null;
  createdAt: number;
}

export interface ImageGenerationSession {
  transcriptId?: string;
  configured: boolean;
  jobs: ImageGenerationJob[];
}
