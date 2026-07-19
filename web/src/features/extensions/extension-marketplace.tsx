import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowLeft, CheckCircle, Loader2, Package, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useState } from 'react';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';

import { MarkdownView } from '@/components/markdown/markdown-view';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getExtensionMarketplacePackageDetail,
  installExtensionFromMarketplace,
  uninstallExtensionFromDisk,
} from '@/features/extensions/extension-marketplace-api';
import { useExtensions } from '@/features/extensions/extension-provider';
import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
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

type MarketplaceUi = {
  q: string;
  debounced: string;
  detailPkg: string | null;
  rowBusy: string | null;
  actionError: string | null;
  restartHint: string | null;
};

const initialMarketplaceUi: MarketplaceUi = {
  q: '',
  debounced: '',
  detailPkg: null,
  rowBusy: null,
  actionError: null,
  restartHint: null,
};

export function ExtensionMarketplacePanel({ className }: { className?: string }) {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const copy = m.extensionsPage;
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const extensions = useExtensions();
  const { mutate } = useSWRConfig();
  const [ui, dispatch] = useReducer(uiPatchReducer<MarketplaceUi>, initialMarketplaceUi);
  const { q, debounced, detailPkg, rowBusy, actionError, restartHint } = ui;
  const listKey = hasToken ? `marketplace-${debounced}` : null;

  useEffect(() => {
    const t = window.setTimeout(() => dispatch({ type: 'patch', patch: { debounced: q.trim() } }), 300);
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
    dispatchConfigReload();
  }, [mutate]);

  const runInstall = useCallback(
    async (packageName: string, overwrite: boolean) => {
      dispatch({ type: 'patch', patch: { actionError: null, restartHint: null, rowBusy: packageName } });
      try {
        const payload = await installExtensionFromMarketplace({ name: packageName, overwrite });
        refetchExtensions();
        if (payload.requiresGatewayRestart) {
          dispatch({ type: 'patch', patch: { restartHint: copy.marketplaceRestartHint } });
        }
      } catch (e) {
        dispatch({
          type: 'patch',
          patch: { actionError: e instanceof Error ? e.message : copy.marketplaceInstallFailed },
        });
        throw e;
      } finally {
        dispatch({ type: 'patch', patch: { rowBusy: null } });
      }
    },
    [copy.marketplaceInstallFailed, copy.marketplaceRestartHint, refetchExtensions],
  );

  const runUninstall = useCallback(
    async (extensionId: string) => {
      dispatch({ type: 'patch', patch: { actionError: null, restartHint: null, rowBusy: extensionId } });
      try {
        const payload = await uninstallExtensionFromDisk(extensionId);
        refetchExtensions();
        if (payload.requiresGatewayRestart) {
          dispatch({ type: 'patch', patch: { restartHint: copy.marketplaceRestartHint } });
        }
      } catch (e) {
        dispatch({
          type: 'patch',
          patch: { actionError: e instanceof Error ? e.message : copy.marketplaceUninstallFailed },
        });
        throw e;
      } finally {
        dispatch({ type: 'patch', patch: { rowBusy: null } });
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
          onChange={(e) => dispatch({ type: 'patch', patch: { q: e.target.value } })}
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
        <ul className="flex flex-col gap-3" aria-label={copy.marketplaceLoading}>
          {[0, 1, 2].map((index) => (
            <li key={index} className="rounded-xl bg-surface-panel p-4 shadow-surface">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-2.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-full max-w-xl" />
                  <Skeleton className="h-4 w-2/3 max-w-md" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            </li>
          ))}
        </ul>
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
                    onClick={() => dispatch({ type: 'patch', patch: { detailPkg: e.id } })}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        dispatch({ type: 'patch', patch: { detailPkg: e.id } });
                      }
                    }}
                    className={cn(
                      'flex w-full cursor-pointer flex-wrap items-start gap-3 rounded-xl bg-surface-panel p-4 text-left shadow-surface',
                      'transition-[transform,background-color,box-shadow] duration-150 ease-out',
                      'hover:bg-surface-hover/40',
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
                          onClick={() => dispatch({ type: 'patch', patch: { detailPkg: e.id } })}
                          className={cn(
                            'inline-flex w-full items-center justify-center rounded-lg border border-edge px-3 py-2 text-xs font-medium text-fg',
                            'transition-[transform,background-color] active:scale-[0.98]',
                            'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                          )}
                        >
                          {copy.marketplaceReview}
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
          onClose={() => dispatch({ type: 'patch', patch: { detailPkg: null } })}
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
  copy: MessageBundle['extensionsPage'];
  extensions: ExtensionApiRow[];
  onClose: () => void;
  onInstall: (name: string, overwrite: boolean) => Promise<void>;
  onUninstall: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [riskAccepted, setRiskAccepted] = useState(false);
  const hasToken = useGatewayStore((s) => Boolean(s.token));
  const key = hasToken ? `ext-mp-detail-${packageName}` : null;
  const { data, error, isLoading } = useSWR(
    key,
    async () => getExtensionMarketplacePackageDetail(packageName),
    { revalidateOnFocus: false },
  );

  const installKind = extensionInstallKind(extensions, packageName);
  const userInstalled = installKind === 'user';
  const permissions = data?.manifest?.permissions;
  const permissionEntries = permissions && typeof permissions === 'object' && !Array.isArray(permissions)
    ? Object.entries(permissions)
    : [];

  const readmeMd =
    data?.readme?.trim() ||
    (data?.description?.trim() ? `### ${data.name}\n\n${data.description}` : `*${copy.marketplaceNoReadme}*`);

  return (
    <Dialog.Root defaultOpen onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="xopc-dialog-overlay fixed inset-0 z-[130] bg-scrim" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[131] flex h-[min(44rem,calc(100vh-1.5rem))] w-[min(42rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated"
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
              <div className="space-y-4" aria-label={copy.marketplaceLoading}>
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-28" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-36 w-full" />
              </div>
            ) : error ? (
              <div className="rounded-lg border border-red-300/70 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/30">
                <p className="font-medium text-red-700 dark:text-red-300">{copy.marketplaceDetailLoadFailed}</p>
                <p className="mt-1 break-words text-red-600 dark:text-red-400">
                  {error instanceof Error ? error.message : copy.marketplaceLoadFailed}
                </p>
              </div>
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
                {installKind !== 'bundled' ? (
                  <section className="mt-5 space-y-3 rounded-lg border border-edge bg-surface-base p-4">
                    <div className="flex items-start gap-2.5">
                      {data.installability.available ? (
                        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <h4 className="text-sm font-semibold text-fg">
                          {data.installability.available
                            ? copy.marketplaceRiskTitle
                            : copy.marketplaceUnavailableTitle}
                        </h4>
                        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                          {data.installability.available
                            ? copy.marketplaceCodeRisk
                            : data.installability.reason ?? copy.marketplaceUnavailableBody}
                        </p>
                      </div>
                    </div>

                    {data.installability.available ? (
                      <>
                        <dl className="grid gap-2 text-xs text-fg-muted sm:grid-cols-2">
                          <div>
                            <dt className="font-medium text-fg">{copy.marketplaceIntegrity}</dt>
                            <dd>{copy.marketplaceIntegrityVerified}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-fg">{copy.marketplaceDependencies}</dt>
                            <dd>{data.packageSummary?.dependencyCount ?? 0}</dd>
                          </div>
                        </dl>
                        <div className="text-xs text-fg-muted">
                          <p className="font-medium text-fg">{copy.marketplacePermissions}</p>
                          {permissionEntries.length > 0 ? (
                            <ul className="mt-1 space-y-1">
                              {permissionEntries.map(([name, value]) => (
                                <li key={name} className="break-words">
                                  <code>{name}</code>: {Array.isArray(value) ? value.join(', ') : String(value)}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1">{copy.marketplacePermissionsNone}</p>
                          )}
                        </div>
                        {(data.packageSummary?.lifecycleScripts.length ?? 0) > 0 ? (
                          <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                            {copy.marketplaceLifecycleScripts}: {data.packageSummary?.lifecycleScripts.join(', ')}
                          </p>
                        ) : null}
                        <label className="flex cursor-pointer items-start gap-2 text-sm text-fg">
                          <input
                            type="checkbox"
                            checked={riskAccepted}
                            onChange={(event) => setRiskAccepted(event.target.checked)}
                            className="mt-0.5 size-4 rounded border-edge accent-[var(--color-accent)]"
                          />
                          <span>{copy.marketplaceRiskConfirm}</span>
                        </label>
                      </>
                    ) : null}
                  </section>
                ) : null}
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
                    to="/extensions?tab=builtin"
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
                    disabled={busy || !data.installability.available || !riskAccepted}
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
