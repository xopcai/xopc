export interface ImageUnderstandingRequest {
  images: Array<{ buffer: Buffer; mimeType: string }>;
  prompt: string;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ImageUnderstandingResult {
  text: string;
  provider: string;
  model: string;
}

export interface ImageUnderstandingProvider {
  id: string;
  label?: string;
  defaultModel?: string;
  isConfigured?: () => Promise<boolean>;
  describeImages(
    modelId: string,
    request: ImageUnderstandingRequest,
  ): Promise<ImageUnderstandingResult>;
}
