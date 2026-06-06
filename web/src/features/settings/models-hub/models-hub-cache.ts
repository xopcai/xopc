import { invalidateConfiguredModelsCache } from '@/features/chat/api/registry-api';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { apiUrl } from '@/lib/url';
import { mutate } from 'swr';

/** SWR key for GET /api/models-json in the models hub. */
export const MODELS_JSON_SWR_KEY = 'models-json-config';

/** Revalidate all data sources that drive the Models & credentials hub service cards. */
export async function revalidateModelsHubCaches(): Promise<void> {
  await Promise.all([
    revalidateGatewayConfig(),
    mutate(apiUrl('/api/providers/meta')),
    mutate(MODELS_JSON_SWR_KEY),
    invalidateConfiguredModelsCache(),
  ]);
}
