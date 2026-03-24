import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';

async function defaultFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`);
    throw err;
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
