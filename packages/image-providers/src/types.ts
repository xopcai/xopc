export type ImageQuality = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'auto';
export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type ImageResolution = '1K' | '2K' | '4K';
export type ImageBackground = 'transparent' | 'opaque' | 'auto';
export type ImageProtocol = 'openai' | 'minimax' | 'dashscope' | 'google' | 'fal' | 'seedream' | 'ideogram' | 'bfl' | 'zhipu' | 'tokenhub' | 'stability';

export interface ImageGeometry {
  sizes?: string[];
  aspectRatios?: string[];
  resolutions?: ImageResolution[];
  pixels?: { minPixels: number; maxPixels: number; maxEdge: number; minEdge: number; step: number; maxRatio: number };
}

export interface ImageCapabilities {
  generate?: { maxCount?: number; supportsSize?: boolean; supportsAspectRatio?: boolean; supportsResolution?: boolean };
  edit?: { enabled: boolean; maxInputImages?: number; inputFormats?: ImageFormat[]; maxInputBytes?: number; supportsSize?: boolean; supportsAspectRatio?: boolean; supportsResolution?: boolean; geometry?: ImageGeometry };
  geometry?: ImageGeometry;
  output?: { qualities?: ImageQuality[]; formats?: ImageFormat[]; backgrounds?: ImageBackground[] };
}

export interface ImageModel {
  id: string;
  name: string;
  capabilities: ImageCapabilities;
  editPath?: string;
}

export interface ImageProviderSpec {
  id: string;
  name: string;
  protocol: ImageProtocol;
  baseUrl: string;
  regions?: Record<'cn' | 'intl', string>;
  documentationUrl: string;
  apiKeyUrl: string;
  timeoutMs: number;
  models: ImageModel[];
}

export interface ImageRequest {
  model: string;
  prompt: string;
  count?: number;
  size?: string;
  aspectRatio?: string;
  resolution?: ImageResolution;
  quality?: ImageQuality;
  outputFormat?: ImageFormat;
  background?: ImageBackground;
  openai?: { moderation?: 'low' | 'auto'; outputCompression?: number; user?: string };
  inputImages?: Array<{ blob: Blob; fileName: string }>;
}

export interface ImageResult {
  images: Array<{ bytes: Uint8Array; mimeType: string }>;
  requestId?: string;
  usage?: unknown;
}

export interface ImageExecution {
  providerId: string;
  baseUrl: string;
  apiKey: string;
  request: ImageRequest;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}
