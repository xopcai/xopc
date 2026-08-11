export const XOPC_CLOUD_PROVIDER_ID = 'xopc-cloud';
export const DEFAULT_XOPC_MODEL_ROUTER_URL = 'https://router.xopc.ai/v1';

export function resolveXopcModelRouterUrl(override?: string): string {
  return (
    override
    ?? process.env.XOPC_MODEL_ROUTER_URL
    ?? DEFAULT_XOPC_MODEL_ROUTER_URL
  ).replace(/\/+$/, '');
}
