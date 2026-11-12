export type VideoGenerationState = 'queued' | 'submitting' | 'submitted' | 'running' | 'saving'
  | 'completed' | 'failed' | 'submission_unknown';

export type VideoRatio = '16:9' | '9:16' | 'adaptive';
export const VIDEO_RESOLUTIONS = ['480P', '720P', '1080P'] as const;
export type VideoResolution = typeof VIDEO_RESOLUTIONS[number];
export const VIDEO_AUTO_DURATION = -1;
export const WAN_VIDEO_MODEL_REF = 'dashscope-cn/wan3.0-video';
export const SEEDANCE_VIDEO_MODEL_REF = 'volcengine-ark/doubao-seedance-2-5-260628';
export const SEEDANCE_FAST_VIDEO_MODEL_REF = 'volcengine-ark/doubao-seedance-2-0-fast-260128';
export const CLOUD_WAN_VIDEO_MODEL_REF = 'xopc-cloud/video';
export const CLOUD_SEEDANCE_VIDEO_MODEL_REF = 'xopc-cloud/video-seedance';
export const CLOUD_SEEDANCE_FAST_VIDEO_MODEL_REF = 'xopc-cloud/video-seedance-fast';
export const LOCAL_VIDEO_MODEL_REFS = [WAN_VIDEO_MODEL_REF, SEEDANCE_VIDEO_MODEL_REF, SEEDANCE_FAST_VIDEO_MODEL_REF] as const;
export const VIDEO_MODEL_REFS = [...LOCAL_VIDEO_MODEL_REFS, CLOUD_WAN_VIDEO_MODEL_REF, CLOUD_SEEDANCE_VIDEO_MODEL_REF, CLOUD_SEEDANCE_FAST_VIDEO_MODEL_REF] as const;
export type VideoModelRef = typeof VIDEO_MODEL_REFS[number];

export interface VideoModelDefinition {
  provider: 'dashscope-cn' | 'volcengine-ark' | 'xopc-cloud';
  name: string;
  minDuration: number;
  maxDuration: number;
  resolutions: readonly VideoResolution[];
  imageRatios: readonly VideoRatio[];
}

const localVideoModels: Record<typeof LOCAL_VIDEO_MODEL_REFS[number], VideoModelDefinition> = {
  [WAN_VIDEO_MODEL_REF]: { provider: 'dashscope-cn', name: 'Wan 3.0', minDuration: 2, maxDuration: 30, resolutions: VIDEO_RESOLUTIONS, imageRatios: ['adaptive', '16:9', '9:16'] },
  [SEEDANCE_VIDEO_MODEL_REF]: { provider: 'volcengine-ark', name: 'Seedance 2.5', minDuration: 4, maxDuration: 30, resolutions: VIDEO_RESOLUTIONS, imageRatios: ['adaptive'] },
  [SEEDANCE_FAST_VIDEO_MODEL_REF]: { provider: 'volcengine-ark', name: 'Seedance 2.0 Fast', minDuration: 4, maxDuration: 15, resolutions: ['480P', '720P'], imageRatios: ['adaptive', '16:9', '9:16'] },
};

export const VIDEO_MODELS: Readonly<Record<VideoModelRef, VideoModelDefinition>> = {
  ...localVideoModels,
  [CLOUD_WAN_VIDEO_MODEL_REF]: { ...localVideoModels[WAN_VIDEO_MODEL_REF], provider: 'xopc-cloud' },
  [CLOUD_SEEDANCE_VIDEO_MODEL_REF]: { ...localVideoModels[SEEDANCE_VIDEO_MODEL_REF], provider: 'xopc-cloud' },
  [CLOUD_SEEDANCE_FAST_VIDEO_MODEL_REF]: { ...localVideoModels[SEEDANCE_FAST_VIDEO_MODEL_REF], provider: 'xopc-cloud' },
};

export function isVideoDurationSupported(model: VideoModelDefinition, duration: number): boolean {
  return duration === VIDEO_AUTO_DURATION
    || (Number.isInteger(duration) && duration >= model.minDuration && duration <= model.maxDuration);
}

export function getVideoDurationOptions(model: VideoModelDefinition): number[] {
  return [VIDEO_AUTO_DURATION, ...Array.from({ length: model.maxDuration - model.minDuration + 1 },
    (_, index) => model.minDuration + index)];
}

export const VIDEO_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export interface VideoGenerationJob {
  id: string;
  transcriptId: string;
  modelRef: VideoModelRef;
  prompt: string;
  duration: number;
  ratio: VideoRatio;
  resolution: VideoResolution;
  imageName: string | null;
  state: VideoGenerationState;
  error: string | null;
  createdAt: number;
  draftCreatedAt?: number;
  summary?: string;
}

export interface VideoGenerationDefaults {
  duration: number;
  resolution: VideoResolution;
}

export interface VideoGenerationDraft extends VideoGenerationDefaults {
  id: string;
  revision: number;
  transcriptId: string;
  modelRef: VideoModelRef;
  prompt: string;
  summary?: string;
  ratio: VideoRatio;
  imageUri: string | null;
  imageName: string | null;
  estimatedCostFen: number;
  estimatedCreditMicro?: number;
  createdAt: number;
}

export interface VideoGenerationSession {
  transcriptId: string;
  configured: boolean;
  modelRef: VideoModelRef;
  defaults: VideoGenerationDefaults;
  jobs: VideoGenerationJob[];
  draft?: VideoGenerationDraft;
}

export interface VideoModelSettings {
  modelRef: VideoModelRef;
  defaults: VideoGenerationDefaults;
  configured: Record<Exclude<VideoModelDefinition['provider'], 'xopc-cloud'>, boolean> & { 'xopc-cloud'?: boolean };
  modelRefs?: VideoModelRef[];
}

export function estimateVideoCostFen(modelRef: VideoModelRef, duration: number, resolution: VideoResolution): number {
  const seconds = duration === VIDEO_AUTO_DURATION ? VIDEO_MODELS[modelRef].maxDuration : duration;
  const wanPricePerSecond = { '480P': 30, '720P': 60, '1080P': 120 };
  if (VIDEO_MODELS[modelRef].provider === 'xopc-cloud') return 0;
  if (modelRef === WAN_VIDEO_MODEL_REF) return seconds * wanPricePerSecond[resolution];
  // Ark Beijing list price, no input video, estimated from standard 16:9 or 9:16 output.
  const pixels = { '480P': 854 * 480, '720P': 1280 * 720, '1080P': 1920 * 1080 };
  const yuanPerMillionTokens = modelRef === SEEDANCE_VIDEO_MODEL_REF ? (resolution === '1080P' ? 77 : 70) : 37;
  return Math.ceil(seconds * pixels[resolution] * 24 / 1024 * yuanPerMillionTokens / 10_000);
}
