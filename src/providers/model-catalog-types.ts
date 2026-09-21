import type { ComputerProfile } from '@xopcai/computer-control-contract';
import type { VoiceManifest } from '@xopcai/realtime-protocol/voice';
export interface CatalogModel {
  voice?: VoiceManifest;
  computerUse?: { profile: ComputerProfile };
  id: string;
  name: string;
  displayNames?: Partial<Record<'zh-CN' | 'en', string>>;
  availability: 'available' | 'unavailable';
  kind: 'language' | 'image' | 'stt' | 'tts' | 'omni';
  input: Array<'text' | 'image' | 'audio'>;
  output: Array<'text' | 'image' | 'audio'>;
  operations: Array<
    | 'chat.completions'
    | 'responses'
    | 'images.generate'
    | 'images.edit'
    | 'audio.transcription'
    | 'audio.speech'
    | 'audio.conversation'
  >;
  reasoning: boolean;
  contextWindow: number;
  maxOutputTokens: number | null;
  stability?: 'stable' | 'preview' | 'deprecated';
  priority?: number;
  tier?: string;
  bestEffort?: boolean;
  imageGeneration?: {
    maxCount: number;
    sizes: string[];
    aspectRatios?: string[];
    qualities: Array<'low' | 'medium' | 'high' | 'auto'>;
    formats: Array<'png' | 'jpeg' | 'webp'>;
    backgrounds: Array<'transparent' | 'opaque' | 'auto'>;
    maxInputImages: number;
  };
  stt?: {
    inputFormats: string[];
    maxBytes: number;
    maxDurationSeconds: number;
    languages: string[];
    languageHint: boolean;
    prompt: boolean;
    timestamps: Array<'segment' | 'word'>;
    diarization: boolean;
  };
  tts?: {
    maxCharacters: number;
    languages: string[];
    outputFormats: Array<'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'>;
    streaming: boolean;
    speed: boolean;
    pitch: boolean;
    instructions: boolean;
    defaultVoice?: string;
  };
}

export interface CatalogSource {
  providerId: string;
  baseUrl: string;
  api: 'openai-completions' | 'openai-responses';
  etag: string | null;
  recommendedModel: string | null;
  recommended?: Partial<Record<'vision' | 'image-generation' | 'stt' | 'tts', string>>;
  search?: {
    schemaVersion: 1;
    endpoint: string;
    auth: { scope: 'models:invoke' };
    maxResults: number;
    defaults: { count: number; safeSearch: 'moderate' };
    capabilities: { freshness: boolean; language: boolean; region: boolean };
  };
  lastSuccessAt: number;
  models: CatalogModel[];
}

export interface ModelCatalogSnapshot {
  sources: Record<string, CatalogSource>;
}

export type CatalogSourceOrigin = 'memory' | 'disk' | 'network';

export type AvailableCatalogModel = Omit<CatalogModel, 'availability'>;
