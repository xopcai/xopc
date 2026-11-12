import type { VideoGenerationJob, VideoModelRef } from '@xopcai/gateway-contract';

export type VideoProviderInput = Pick<VideoGenerationJob, 'prompt' | 'duration' | 'ratio' | 'resolution'> & {
  model_ref: VideoModelRef;
  image_bytes: Uint8Array | null;
  image_mime: string | null;
};

export type VideoProviderStatus =
  | { state: 'submitted' | 'running' }
  | { state: 'completed'; url: string; expiresAt?: number }
  | { state: 'failed'; reason: string };

export class VideoProviderError extends Error {
  readonly rejected: boolean;

  constructor(provider: string, status: number, code?: string) {
    const safeCode = code && /^[\w.-]{1,80}$/.test(code) ? ` (${code})` : '';
    super(`${provider} returned HTTP ${status}${safeCode}`);
    this.rejected = (status >= 400 && status < 500 && status !== 408) || (status === 200 && Boolean(code));
  }
}

export function safeVideoErrorCode(code: unknown): string {
  return typeof code === 'string' && /^[\w.-]{1,80}$/.test(code) ? ` (${code})` : '';
}
