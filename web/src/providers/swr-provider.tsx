import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';

import { apiFetch } from '@/lib/fetch';
import { formatApiHttpError } from '@/lib/http-error-message';

async function defaultFetcher<T>(url: string): Promise<T> {
  const res = await apiFetch(url);
  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = formatApiHttpError(res.status, res.statusText, errorBody.error?.message);
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export function SwrProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: defaultFetcher,
        revalidateOnFocus: false,
        dedupingInterval: 2000,
        shouldRetryOnError: true,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
