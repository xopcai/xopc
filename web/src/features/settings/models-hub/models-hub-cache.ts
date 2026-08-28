import { invalidateConfiguredModelsCache } from '@/features/chat/api/registry-api';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { apiUrl } from '@/lib/url';
import { mutate } from 'swr';

/** SWR key for GET /api/models-json in the models hub. */
export const MODELS_JSON_SWR_KEY = 'models-json-config';
export const MODEL_CATALOG_SWR_KEY = 'model-catalog';
export const CAPABILITY_READINESS_SWR_KEY = 'capability-readiness';

/** Revalidate all data sources that drive the Models & services cards. */
export async function revalidateModelsHubCaches(): Promise<void> {
  await Promise.all([
    revalidateGatewayConfig(),
    mutate(apiUrl('/api/providers/meta')),
    mutate(MODELS_JSON_SWR_KEY),
    mutate(MODEL_CATALOG_SWR_KEY),
    mutate(CAPABILITY_READINESS_SWR_KEY),
    invalidateConfiguredModelsCache(),
  ]);
}
