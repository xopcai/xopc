import { CheckCircle, ExternalLink, Package, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import useSWR from 'swr';

import { useGatewayStore } from '@/stores/gateway-store';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { cn } from '@/lib/cn';

type RegistryEntry = {
  id: string;
  name: string;
  description?: string;
  npmPackage: string;
  version?: string;
  categories?: string[];
  tags?: string[];
  verified?: boolean;
  homepage?: string;
  author?: string;
};

type MarketplaceResponse = { ok: boolean; extensions: RegistryEntry[] };

export function ExtensionMarketplacePanel({ className }: { className?: string }) {
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const key = hasToken ? `marketplace-${debounced}` : null;

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data, isLoading, error } = useSWR(
    key,
    async () => {
      const url =
        debounced.length > 0
          ? apiUrl(`/api/marketplace?q=${encodeURIComponent(debounced)}`)
          : apiUrl('/api/marketplace');
      return fetchJson<MarketplaceResponse>(url);
    },
    { revalidateOnFocus: false },
  );

  const extensions = data?.extensions ?? [];

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search extensions…"
          className="ui-input h-10 w-full rounded-lg border border-edge bg-surface-base pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted"
        />
      </div>

      {error ? (
        <p className="text-sm text-fg-muted">
          {error instanceof Error ? error.message : 'Failed to load marketplace'}
        </p>
      ) : null}

      {isLoading && !data ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {extensions.length === 0 ? (
            <li className="text-sm text-fg-muted">No extensions from xopc-store.</li>
          ) : (
            extensions.map((e) => (
              <li
                key={e.id}
                className="rounded-xl border border-edge bg-surface-base p-4 shadow-surface"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-fg">{e.name}</h3>
                      {e.verified ? (
                        <CheckCircle
                          className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                          strokeWidth={1.75}
                          aria-label="Verified"
                        />
                      ) : null}
                      {e.version ? (
                        <span className="text-xs text-fg-muted">{e.version}</span>
                      ) : null}
                    </div>
                    {e.description ? (
                      <p className="mt-1 text-sm text-fg-muted">{e.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(e.categories ?? []).map((c) => (
                        <span
                          key={c}
                          className="rounded-md border border-edge bg-surface-panel px-2 py-0.5 text-[11px] text-fg-muted"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-muted">
                      <Package className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                      <code className="rounded bg-surface-panel px-1 py-0.5">{e.npmPackage}</code>
                    </p>
                    {e.homepage ? (
                      <a
                        href={e.homepage}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
                        Homepage
                      </a>
                    ) : null}
                  </div>
                </div>
                <p className="mt-3 text-[11px] text-fg-muted">
                  npm package:{' '}
                  <code className="rounded bg-surface-panel px-1 py-0.5">{e.npmPackage}</code>
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
