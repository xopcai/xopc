import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, CheckCircle, Loader2, Package, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import {
  getExtensionMarketplacePackageDetail,
  installExtensionFromMarketplace,
  uninstallExtensionFromDisk,
} from '@/features/extensions/extension-marketplace-api';
import { useExtensions } from '@/features/extensions/extension-provider';
import { messages, type MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

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
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const copy = m.appsPage;
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const extensions = useExtensions();
  const { mutate } = useSWRConfig();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const listKey = hasToken ? `marketplace-${debounced}` : null;
  const [detailPkg, setDetailPkg] = useState<string | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [restartHint, setRestartHint] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const { data, isLoading, error } = useSWR(
    listKey,
    async () => {
      const url =
        debounced.length > 0
          ? apiUrl(`/api/marketplace?q=${encodeURIComponent(debounced)}`)
          : apiUrl('/api/marketplace');
      return fetchJson<MarketplaceResponse>(url);
    },
    { revalidateOnFocus: false },
  );

  const installedIds = useMemo(() => new Set(extensions.map((e) => e.id)), [extensions]);

  const refetchExtensions = useCallback(() => {
    void mutate('gateway-extensions-list');
    window.dispatchEvent(new CustomEvent('config-reload'));
  }, [mutate]);

  const runInstall = useCallback(
    async (packageName: string, overwrite: boolean) => {
      setActionError(null);
      setRestartHint(null);
      setRowBusy(packageName);
      try {
        const payload = await installExtensionFromMarketplace({ name: packageName, overwrite });
        refetchExtensions();
        if (payload.requiresGatewayRestart) {
          setRestartHint(copy.marketplaceRestartHint);
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : copy.marketplaceInstallFailed);
        throw e;
      } finally {
        setRowBusy(null);
      }
    },
    [copy.marketplaceInstallFailed, copy.marketplaceRestartHint, refetchExtensions],
  );

  const runUninstall = useCallback(
    async (extensionId: string) => {
      setActionError(null);
      setRestartHint(null);
      setRowBusy(extensionId);
      try {
        const payload = await uninstallExtensionFromDisk(extensionId);
        refetchExtensions();
        if (payload.requiresGatewayRestart) {
          setRestartHint(copy.marketplaceRestartHint);
        }
      } catch (e) {
        setActionError(e instanceof Error ? e.message : copy.marketplaceUninstallFailed);
        throw e;
      } finally {
        setRowBusy(null);
      }
    },
    [copy.marketplaceRestartHint, copy.marketplaceUninstallFailed, refetchExtensions],
  );

  const extensionsList = data?.extensions ?? [];

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
          placeholder={copy.marketplaceSearchPlaceholder}
          className="ui-input h-10 w-full rounded-lg border border-edge bg-surface-base pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted"
        />
      </div>

      {error ? (
        <p className="text-sm text-fg-muted">
          {error instanceof Error ? error.message : copy.marketplaceLoadFailed}
        </p>
      ) : null}
      {actionError ? <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p> : null}
      {restartHint ? <p className="text-sm text-fg-muted">{restartHint}</p> : null}

      {isLoading && !data ? (
        <p className="text-sm text-fg-muted">…</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {extensionsList.length === 0 ? (
            <li className="text-sm text-fg-muted">{copy.marketplaceEmpty}</li>
          ) : (
            extensionsList.map((e) => {
              const installed = installedIds.has(e.id);
              const busy = rowBusy === e.id;
              return (
                <li
                  key={e.id}
                  className="rounded-xl border border-edge bg-surface-base p-4 shadow-surface"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <button
                      type="button"
                      onClick={() => setDetailPkg(e.id)}
                      className="min-w-0 flex-1 rounded-lg text-left transition-colors hover:bg-surface-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
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
                        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{e.description}</p>
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
                    </button>
                    <div className="flex shrink-0 flex-col items-end gap-2 sm:min-w-[7.5rem]">
                      {installed ? (
                        <>
                          <span className="text-[11px] font-medium text-fg-muted">
                            {copy.marketplaceInstalled}
                          </span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (!window.confirm(copy.marketplaceUninstallConfirm)) return;
                              void runUninstall(e.id).catch(() => {
                                /* error surfaced via actionError */
                              });
                            }}
                            className={cn(
                              'inline-flex items-center justify-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg',
                              'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                              'disabled:pointer-events-none disabled:opacity-50',
                            )}
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="size-3.5" strokeWidth={2} aria-hidden />
                            )}
                            {copy.marketplaceUninstall}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void runInstall(e.id, false).catch(() => {
                              /* surfaced */
                            });
                          }}
                          className={cn(
                            'inline-flex w-full items-center justify-center rounded-lg bg-accent px-3 py-2 text-xs font-medium text-accent-fg',
                            'hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                            'disabled:pointer-events-none disabled:opacity-50',
                          )}
                        >
                          {busy ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : null}
                          {copy.marketplaceInstall}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}

      {detailPkg ? (
        <ExtensionMarketplaceDetailDialog
          packageName={detailPkg}
          copy={copy}
          installedIds={installedIds}
          onClose={() => setDetailPkg(null)}
          onInstall={runInstall}
          onUninstall={runUninstall}
        />
      ) : null}
    </div>
  );
}

function ExtensionMarketplaceDetailDialog({
  packageName,
  copy,
  installedIds,
  onClose,
  onInstall,
  onUninstall,
}: {
  packageName: string;
  copy: MessageBundle['appsPage'];
  installedIds: Set<string>;
  onClose: () => void;
  onInstall: (name: string, overwrite: boolean) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const key = hasToken ? `ext-mp-detail-${packageName}` : null;
  const { data, error, isLoading } = useSWR(
    key,
    async () => getExtensionMarketplacePackageDetail(packageName),
    { revalidateOnFocus: false },
  );

  const installed = installedIds.has(packageName);

  const readmeMd =
    data?.readme?.trim() ||
    (data?.description?.trim() ? `### ${data.name}\n\n${data.description}` : `*${copy.marketplaceNoReadme}*`);

  return (
    <Dialog.Root defaultOpen onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[131] flex max-h-[min(90vh,44rem)] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={copy.detailBack}
            >
              <ArrowLeft className="size-5" />
            </button>
            <Dialog.Title className="min-w-0 flex-1 truncate text-center text-sm font-semibold text-fg">
              {copy.marketplaceDetailTitle}
            </Dialog.Title>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex size-9 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-hover hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={copy.detailClose}
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            {isLoading && !data ? (
              <p className="text-sm text-fg-muted">…</p>
            ) : error ? (
              <p className="text-sm text-fg-muted">{copy.marketplaceDetailLoadFailed}</p>
            ) : data ? (
              <>
                <h3 className="text-lg font-semibold text-fg">{data.name}</h3>
                <p className="mt-1 text-xs text-fg-muted">
                  <code className="rounded bg-surface-panel px-1 py-0.5">{data.id}</code>
                </p>
                <dl className="mt-3 grid gap-2 text-xs text-fg-muted sm:grid-cols-2">
                  <div>
                    <dt className="font-medium text-fg">{copy.marketplaceAuthor}</dt>
                    <dd>{data.author.username}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-fg">{copy.marketplaceVersion}</dt>
                    <dd>{data.latestVersion.version}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-fg">{copy.marketplaceDownloads}</dt>
                    <dd>{data.downloads}</dd>
                  </div>
                </dl>
                {data.readme?.trim() ? (
                  <h4 className="mb-2 mt-6 text-sm font-semibold text-fg">
                    {copy.marketplaceDetailReadmeHeading}
                  </h4>
                ) : null}
                <div className="markdown-content min-w-0 break-words text-sm">
                  <MarkdownView content={readmeMd} />
                </div>
              </>
            ) : null}
          </div>

          {data ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge-subtle px-5 py-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (installed) {
                    if (!window.confirm(copy.marketplaceReinstallConfirm)) return;
                  }
                  setBusy(true);
                  void onInstall(packageName, installed)
                    .catch(() => {
                      /* parent sets actionError */
                    })
                    .finally(() => setBusy(false));
                }}
                className={cn(
                  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
                  'bg-accent text-accent-fg hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'disabled:pointer-events-none disabled:opacity-50',
                )}
              >
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                {installed ? copy.marketplaceReinstall : copy.marketplaceInstall}
              </button>
              {installed ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(copy.marketplaceUninstallConfirm)) return;
                    setBusy(true);
                    void onUninstall(packageName)
                      .then(() => onClose())
                      .catch(() => {
                        /* parent */
                      })
                      .finally(() => setBusy(false));
                  }}
                  className={cn(
                    'inline-flex items-center justify-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg',
                    'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    'disabled:pointer-events-none disabled:opacity-50',
                  )}
                >
                  <Trash2 className="size-4 shrink-0" aria-hidden />
                  {copy.marketplaceUninstall}
                </button>
              ) : null}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
