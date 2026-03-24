import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import type {
  ApiType,
  CustomModel,
  ModelsJsonConfig,
  ProviderConfig,
  ValidationResult,
} from './models-json.types';

export type {
  ApiType,
  CustomModel,
  ModelsJsonConfig,
  ProviderConfig,
  ValidationResult,
} from './models-json.types';

export interface ModelsJsonStatus {
  config: ModelsJsonConfig;
  path: string;
  exists: boolean;
  loadError?: string;
}

export interface ApiKeyTestResult {
  type: 'literal' | 'env' | 'command';
  resolved?: string;
  error?: string;
}

export const API_TYPE_OPTIONS: { value: ApiType; label: string }[] = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI' },
  { value: 'bedrock-converse-stream', label: 'AWS Bedrock' },
  { value: 'openai-codex-responses', label: 'OpenAI Codex' },
  { value: 'google-gemini-cli', label: 'Google Gemini CLI' },
  { value: 'google-vertex', label: 'Google Vertex AI' },
];

function gatewayErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const o = body as { error?: unknown };
  if (typeof o.error === 'string') return o.error;
  if (o.error && typeof o.error === 'object' && 'message' in o.error) {
    const m = (o.error as { message?: unknown }).message;
    return typeof m === 'string' ? m : undefined;
  }
  return undefined;
}

/** Ensures `providers` exists when the gateway returns a partial object. */
export function normalizeModelsJsonConfig(input: unknown): ModelsJsonConfig {
  if (!input || typeof input !== 'object') {
    return { providers: {} };
  }
  const o = input as Record<string, unknown>;
  const raw = o.providers;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return input as ModelsJsonConfig;
  }
  return { ...o, providers: {} } as ModelsJsonConfig;
}

export async function fetchModelsJson(): Promise<ModelsJsonStatus> {
  const res = await apiFetch(apiUrl('/api/models-json'));
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean;
    payload?: ModelsJsonStatus;
    error?: unknown;
  };
  if (!res.ok || !data.ok || !data.payload) {
    throw new Error(gatewayErrorMessage(data) || `HTTP ${res.status}`);
  }
  return {
    ...data.payload,
    config: normalizeModelsJsonConfig(data.payload.config),
  };
}

export async function validateModelsJson(config: ModelsJsonConfig): Promise<ValidationResult> {
  const res = await apiFetch(apiUrl('/api/models-json/validate'), {
    method: 'POST',
    body: JSON.stringify({ config }),
  });
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean;
    payload?: ValidationResult;
    error?: unknown;
  };
  if (!res.ok || !data.ok || !data.payload) {
    throw new Error(gatewayErrorMessage(data) || `HTTP ${res.status}`);
  }
  return data.payload;
}

export async function saveModelsJson(
  config: ModelsJsonConfig,
): Promise<{ saved: boolean; modelCount: number }> {
  const res = await apiFetch(apiUrl('/api/models-json'), {
    method: 'PATCH',
    body: JSON.stringify({ config }),
  });
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean;
    payload?: { saved: boolean; modelCount: number };
    error?: unknown;
  };
  if (!res.ok || !data.ok || !data.payload) {
    throw new Error(gatewayErrorMessage(data) || `HTTP ${res.status}`);
  }
  return data.payload;
}

export async function reloadModelsJson(): Promise<{ modelCount: number; error?: string }> {
  const res = await apiFetch(apiUrl('/api/models-json/reload'), { method: 'POST' });
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean;
    payload?: { modelCount: number; error?: string };
    error?: unknown;
  };
  if (!res.ok || !data.ok || !data.payload) {
    throw new Error(gatewayErrorMessage(data) || `HTTP ${res.status}`);
  }
  return data.payload;
}

export async function testApiKey(value: string): Promise<ApiKeyTestResult> {
  const res = await apiFetch(apiUrl('/api/models-json/test-api-key'), {
    method: 'POST',
    body: JSON.stringify({ value }),
  });
  const data = await res.json().catch(() => ({})) as {
    ok?: boolean;
    payload?: ApiKeyTestResult;
    error?: unknown;
  };
  if (!res.ok || !data.ok || !data.payload) {
    throw new Error(gatewayErrorMessage(data) || `HTTP ${res.status}`);
  }
  return data.payload;
}

export function createCustomProvider(
  baseUrl: string,
  apiKey: string,
  api: ApiType = 'openai-completions',
): ProviderConfig {
  return {
    baseUrl,
    apiKey,
    api,
    models: [],
  };
}

export function createCustomModel(id: string, name?: string, overrides?: Partial<CustomModel>): CustomModel {
  return {
    id,
    name: name || id,
    input: ['text'],
    contextWindow: 128000,
    maxTokens: 16384,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    ...overrides,
  };
}

export function isShellCommand(value: string): boolean {
  return value.startsWith('!');
}

export function isEnvVar(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(value);
}

export function getApiKeyType(value: string): 'shell' | 'env' | 'literal' {
  if (isShellCommand(value)) return 'shell';
  if (isEnvVar(value)) return 'env';
  return 'literal';
}

export function maskApiKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}
