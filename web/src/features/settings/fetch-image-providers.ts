import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { IMAGE_PROVIDERS_SWR_KEY } from '@/features/settings/image-providers-swr-key';
import type { ImageGenProviderCredentialSummary } from '@/features/settings/use-image-provider-credentials';

export async function fetchImageProvidersList(): Promise<ImageGenProviderCredentialSummary[]> {
  const res = await fetchJson<{
    ok?: boolean;
    payload?: { providers?: ImageGenProviderCredentialSummary[] };
  }>(apiUrl(IMAGE_PROVIDERS_SWR_KEY));
  return res?.payload?.providers ?? [];
}
