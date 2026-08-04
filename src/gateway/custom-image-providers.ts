import { z } from 'zod';

import {
  ImageGenerationProviderSchema,
  type ModelsJsonConfig,
  type ProviderConfig,
  validateModelsConfig,
} from '../config/models-json.js';

const PROVIDER_ID_REGEX = /^[a-z0-9]([a-z0-9-_]*[a-z0-9])?$/;

export const CustomImageProviderInputSchema = z.object({
  baseUrl: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  imageGeneration: ImageGenerationProviderSchema,
}).strict();

export type CustomImageProviderInput = z.infer<typeof CustomImageProviderInputSchema>;

export interface CustomImageProviderRecord extends CustomImageProviderInput {
  providerId: string;
}

export function listCustomImageProviders(config: ModelsJsonConfig): CustomImageProviderRecord[] {
  return Object.entries(config.providers).flatMap(([providerId, provider]) => {
    if (!provider.imageGeneration) return [];
    return [{
      providerId,
      baseUrl: provider.baseUrl!,
      ...(provider.headers ? { headers: { ...provider.headers } } : {}),
      imageGeneration: structuredClone(provider.imageGeneration),
    }];
  });
}

export function upsertCustomImageProvider(
  config: ModelsJsonConfig,
  providerIdRaw: string,
  input: unknown,
): ModelsJsonConfig {
  const providerId = normalizeProviderId(providerIdRaw);
  const parsed = CustomImageProviderInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }

  const current = config.providers[providerId] ?? {};
  const { headers: _currentHeaders, ...currentWithoutHeaders } = current;
  const next: ModelsJsonConfig = structuredClone(config);
  next.providers[providerId] = {
    ...currentWithoutHeaders,
    baseUrl: parsed.data.baseUrl,
    ...(parsed.data.headers ? { headers: parsed.data.headers } : {}),
    imageGeneration: parsed.data.imageGeneration,
  } satisfies ProviderConfig;
  assertValid(next);
  return next;
}

export function deleteCustomImageProvider(
  config: ModelsJsonConfig,
  providerIdRaw: string,
): ModelsJsonConfig {
  const providerId = normalizeProviderId(providerIdRaw);
  const current = config.providers[providerId];
  if (!current?.imageGeneration) {
    throw new Error(`Custom image provider not found: ${providerId}`);
  }

  const next: ModelsJsonConfig = structuredClone(config);
  const hasTextConfiguration = Boolean(
    current.api
      || current.apiKey
      || current.authHeader !== undefined
      || current.models?.length
      || (current.modelOverrides && Object.keys(current.modelOverrides).length > 0)
      || current.modelDiscovery,
  );
  if (hasTextConfiguration) {
    const { imageGeneration: _removed, ...remaining } = current;
    next.providers[providerId] = remaining;
  } else {
    delete next.providers[providerId];
  }
  assertValid(next);
  return next;
}

function normalizeProviderId(value: string): string {
  const providerId = value.trim();
  if (!PROVIDER_ID_REGEX.test(providerId)) {
    throw new Error(
      'Provider ID must start/end with alphanumeric and contain only lowercase letters, numbers, hyphens, and underscores',
    );
  }
  return providerId;
}

function assertValid(config: ModelsJsonConfig): void {
  const validation = validateModelsConfig(config);
  if (!validation.valid) {
    throw new Error(
      validation.errors
        .filter((entry) => entry.severity === 'error')
        .map((entry) => `${entry.path}: ${entry.message}`)
        .join('; '),
    );
  }
}
