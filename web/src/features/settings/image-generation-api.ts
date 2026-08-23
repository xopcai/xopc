import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ImageModelCapabilities = {
  generate?: {
    maxCount?: number;
    supportsSize?: boolean;
    supportsAspectRatio?: boolean;
    supportsResolution?: boolean;
  };
  edit?: {
    enabled: boolean;
    maxInputImages?: number;
    supportsSize?: boolean;
    supportsAspectRatio?: boolean;
  };
  geometry?: {
    sizes?: string[];
    aspectRatios?: string[];
    resolutions?: Array<'1K' | '2K' | '4K'>;
  };
  output?: {
    qualities?: Array<'low' | 'medium' | 'high' | 'auto'>;
    formats?: Array<'png' | 'jpeg' | 'webp'>;
    backgrounds?: Array<'transparent' | 'opaque' | 'auto'>;
  };
};

export type ImageProvider = {
  id: string;
  label: string;
  source: 'builtin' | 'custom';
  credentialMode: 'api-key' | 'oauth' | 'none';
  documentationUrl?: string;
  apiKeyUrl?: string;
  configFields: Array<{
    key: 'baseUrl' | 'region';
    label: string;
    type: 'url' | 'select';
    required?: boolean;
    placeholder?: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  config: Record<string, string>;
  defaultModel: string;
  models: string[];
  capabilities: ImageModelCapabilities;
  modelCapabilities?: Record<string, ImageModelCapabilities>;
  configured: boolean;
};

export type CustomImageModel = {
  id: string;
  name?: string;
  capabilities: ImageModelCapabilities;
  defaults?: {
    count?: number;
    size?: string;
    outputFormat?: 'png' | 'jpeg' | 'webp';
  };
};

export type CustomImageProvider = {
  providerId: string;
  baseUrl: string;
  headers?: Record<string, string>;
  imageGeneration: {
    api: 'openai-images';
    name: string;
    documentationUrl?: string;
    apiKeyUrl?: string;
    defaultModel: string;
    auth:
      | { type: 'bearer' }
      | { type: 'header'; headerName: string }
      | { type: 'none' };
    paths?: { generations?: string; edits?: string };
    network?: { allowedHosts: string[] };
    models: CustomImageModel[];
  };
};

export type CustomImageProviderInput = Omit<CustomImageProvider, 'providerId'>;

export async function fetchImageCatalog(): Promise<ImageProvider[]> {
  const response = await fetchJson<{ payload?: { providers?: ImageProvider[] } }>(
    apiUrl('/api/image-generation/catalog'),
  );
  if (!Array.isArray(response.payload?.providers)) throw new Error('Invalid image provider catalog');
  return response.payload.providers;
}

export async function fetchCustomImageProviders(): Promise<CustomImageProvider[]> {
  const response = await fetchJson<{ payload?: { providers?: CustomImageProvider[] } }>(
    apiUrl('/api/image-generation/custom-providers'),
  );
  if (!Array.isArray(response.payload?.providers)) throw new Error('Invalid custom image provider list');
  return response.payload.providers;
}

export async function saveCustomImageProvider(
  providerId: string,
  input: CustomImageProviderInput,
): Promise<void> {
  await fetchJson(apiUrl(`/api/image-generation/custom-providers/${encodeURIComponent(providerId)}`), {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteCustomImageProvider(providerId: string): Promise<void> {
  await fetchJson(apiUrl(`/api/image-generation/custom-providers/${encodeURIComponent(providerId)}`), {
    method: 'DELETE',
  });
}

export async function saveImageProviderCredential(providerId: string, apiKey: string): Promise<void> {
  await fetchJson(apiUrl(`/api/image-generation/providers/${encodeURIComponent(providerId)}/credential`), {
    method: 'PUT',
    body: JSON.stringify({ apiKey }),
  });
}

export async function testImageProvider(
  providerId: string,
  modelId: string,
): Promise<{ images: Array<{ dataUrl: string; mimeType: string; revisedPrompt?: string }> }> {
  const response = await fetchJson<{
    payload?: { images?: Array<{ dataUrl: string; mimeType: string; revisedPrompt?: string }> };
  }>(apiUrl(`/api/image-generation/providers/${encodeURIComponent(providerId)}/test`), {
    method: 'POST',
    body: JSON.stringify({ modelId }),
  });
  if (!Array.isArray(response.payload?.images)) throw new Error('Invalid image generation test response');
  return { images: response.payload.images };
}
