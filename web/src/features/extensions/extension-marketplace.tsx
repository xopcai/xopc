import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, CheckCircle, Loader2, Package, Search, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import {
  getExtensionMarketplacePackageDetail,
  installExtensionFromMarketplace,
  uninstallExtensionFromDisk,
} from '@/features/extensions/extension-marketplace-api';
import { useExtensions } from '@/features/extensions/extension-provider';
import type { ExtensionApiRow } from '@/features/extensions/types';
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

/** Same catalog id on disk: bundled vs user/global/workspace. */
function extensionInstallKind(
  extensions: ExtensionApiRow[],
  catalogId: string,
): 'absent' | 'bundled' | 'user' {
  const row = extensions.find((x) => x.id === catalogId);
  if (!row) return 'absent';
  if (row.source === 'bundled') return 'bundled';
  return 'user';
}

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
              const kind = extensionInstallKind(extensions, e.id);
              const busy = rowBusy === e.id;
              return (
                <li key={e.id} className="list-none">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`${e.name}, ${copy.marketplaceDetailTitle}`}
                    onClick={() => setDetailPkg(e.id)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        setDetailPkg(e.id);
                      }
                    }}
                    className={cn(
                      'flex w-full cursor-pointer flex-wrap items-start gap-3 rounded-xl border border-edge bg-surface-base p-4 text-left shadow-surface',
                      'transition-[transform,background-color,border-color,box-shadow] duration-150 ease-out',
                      'hover:border-edge-subtle hover:bg-surface-hover/40',
                      'active:scale-[0.992] active:bg-surface-hover/55',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                      'dark:hover:bg-surface-hover/25 dark:active:bg-surface-hover/35',
                    )}
                  >
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
                    </div>
                    <div
                      role="group"
                      className="flex shrink-0 flex-col items-end gap-2 sm:min-w-[9rem]"
                      onClick={(ev) => ev.stopPropagation()}
                      onKeyDown={(ev) => ev.stopPropagation()}
                    >
                      {kind === 'bundled' ? (
                        <span className="rounded-md bg-surface-hover px-2 py-1 text-[11px] font-medium text-fg-muted">
                          {copy.marketplaceBuiltin}
                        </span>
                      ) : kind === 'user' ? (
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
                              'transition-colors active:scale-[0.98] active:bg-surface-hover/80',
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
                            'inline-flex w-full items-center justify-center rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white',
                            'shadow-surface transition-[transform,background-color] active:scale-[0.98]',
                            'hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base',
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
          extensions={extensions}
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
  extensions,
  onClose,
  onInstall,
  onUninstall,
}: {
  packageName: string;
  copy: MessageBundle['appsPage'];
  extensions: ExtensionApiRow[];
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

  const installKind = extensionInstallKind(extensions, packageName);
  const userInstalled = installKind === 'user';

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

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
              {installKind === 'bundled' ? (
                <div className="flex w-full flex-col items-stretch gap-2">
                  <p className="text-sm leading-relaxed text-fg-muted">{copy.marketplaceBuiltinManageHint}</p>
                  <Link
                    to="/apps?tab=builtin"
                    onClick={onClose}
                    className="inline-flex w-fit items-center justify-center rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {copy.marketplaceBuiltinGoBuiltin}
                  </Link>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (userInstalled) {
                        if (!window.confirm(copy.marketplaceReinstallConfirm)) return;
                      }
                      setBusy(true);
                      void onInstall(packageName, userInstalled)
                        .catch(() => {
                          /* parent sets actionError */
                        })
                        .finally(() => setBusy(false));
                    }}
                    className={cn(
                      'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium',
                      'bg-accent text-white shadow-surface hover:bg-accent-hover',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel',
                      'disabled:pointer-events-none disabled:opacity-50',
                    )}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                    {userInstalled ? copy.marketplaceReinstall : copy.marketplaceInstall}
                  </button>
                  {userInstalled ? (
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
                </>
              )}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
