import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Settings,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSWRConfig } from 'swr';

import {
  extensionExposesGatewayShellUi,
  useExtensions,
  useExtensionsLoading,
} from '@/features/extensions/extension-provider';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import type { ExtensionApiRow, PageContribution } from '@/features/extensions/types';
import { messages } from '@/i18n/messages';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useLocaleStore } from '@/stores/locale-store';

type AppsPageCopy = MessageBundle['appsPage'];
type AppsTab = 'all' | 'ui' | 'backend';

export function AppsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const extensions = useExtensions();
  const loading = useExtensionsLoading();
  const { mutate } = useSWRConfig();
  const [tab, setTab] = useState<AppsTab>('all');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ExtensionApiRow | null>(null);

  const filtered = useMemo(() => {
    let list = extensions;
    if (tab === 'ui') list = list.filter((e) => e.hasUi);
    if (tab === 'backend') list = list.filter((e) => !e.hasUi);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          (e.name ?? '').toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => {
      if (a.hasUi !== b.hasUi) return a.hasUi ? -1 : 1;
      return (a.name || a.id).localeCompare(b.name || b.id, language);
    });
  }, [extensions, tab, search, language]);

  /** Keep dialog + cards in sync after SWR refetch (detail was a stale row reference). */
  useEffect(() => {
    setDetail((prev) => {
      if (!prev) return prev;
      const next = extensions.find((e) => e.id === prev.id);
      if (!next) return null;
      const eligPrev = activationEligibleFor(prev);
      const eligNext = activationEligibleFor(next);
      if (eligPrev === eligNext && prev.active === next.active) return prev;
      return next;
    });
  }, [extensions]);

  useLayoutEffect(() => {
    setPageHeader({
      startExtra: null,
      main: (
        <div className="w-full min-w-0 px-3 sm:px-5 xl:px-6">
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight text-fg">{m.appsPage.title}</h1>
        </div>
      ),
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, m.appsPage.title, setPageHeader]);

  if (loading) {
    return <AppsPageSkeleton />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-fg">{m.appsPage.title}</h1>
          <p className="mt-1 text-sm text-fg-muted">{m.appsPage.subtitle}</p>
        </header>

        {extensions.length === 0 ? (
          <EmptyAppsState message={m.appsPage.empty} />
        ) : (
          <>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <TabChip active={tab === 'all'} onClick={() => setTab('all')} label={m.appsPage.tabAll} />
                <TabChip
                  active={tab === 'ui'}
                  onClick={() => setTab('ui')}
                  label={m.appsPage.tabWithUi}
                />
                <TabChip
                  active={tab === 'backend'}
                  onClick={() => setTab('backend')}
                  label={m.appsPage.tabBackend}
                />
              </div>
              <div className="relative w-full sm:max-w-xs">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
                  aria-hidden
                />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={m.appsPage.searchPlaceholder}
                  className="w-full rounded-lg border border-edge bg-surface-base py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  autoComplete="off"
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <p className="rounded-xl border border-dashed border-edge-subtle bg-surface-hover/30 px-4 py-8 text-center text-sm text-fg-muted dark:bg-surface-hover/15">
                {m.appsPage.noSearchResults}
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((ext) => (
                  <ExtensionAppCard
                    key={ext.id}
                    extension={ext}
                    copy={m.appsPage}
                    onOpen={() => setDetail(ext)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {detail ? (
        <ExtensionDetailDialog
          key={detail.id}
          extension={detail}
          copy={m.appsPage}
          onClose={() => setDetail(null)}
          onAfterToggle={async () => {
            await mutate('gateway-extensions-list');
          }}
        />
      ) : null}
    </div>
  );
}

function TabChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        active
          ? 'border-accent/40 bg-accent-soft text-accent-fg'
          : 'border-edge bg-surface-base text-fg-muted hover:bg-surface-hover hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

function activationEligibleFor(ext: ExtensionApiRow): boolean {
  return ext.activationEligible ?? ext.active;
}

function providerLabel(ext: ExtensionApiRow, copy: AppsPageCopy): string {
  if (ext.source === 'bundled') return copy.providerBundled;
  if (ext.source === 'global') return copy.providerGlobal;
  if (ext.source === 'workspace') return copy.providerWorkspace;
  return copy.providerOther;
}

function bundledRunCaption(ext: ExtensionApiRow, copy: AppsPageCopy): string {
  const eligible = activationEligibleFor(ext);
  if (eligible && ext.active) return copy.runStateLive;
  if (eligible && !ext.active) return copy.runStatePendingOn;
  if (!eligible && ext.active) return copy.runStatePendingOff;
  return copy.runStateOff;
}

function ExtensionAppCard({
  extension: ext,
  copy,
  onOpen,
}: {
  extension: ExtensionApiRow;
  copy: AppsPageCopy;
  onOpen: () => void;
}) {
  const eligible = activationEligibleFor(ext);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex w-full flex-col rounded-xl border border-edge bg-surface-base p-4 text-left shadow-sm transition-colors',
        'hover:border-edge-subtle hover:bg-surface-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'dark:hover:bg-surface-hover/25',
      )}
    >
      <div className="flex gap-3">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-base font-semibold text-accent-fg"
          aria-hidden
        >
          {(ext.name || ext.id).charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-fg">{ext.name}</h2>
              {ext.version ? (
                <span className="text-[11px] text-fg-muted">v{ext.version}</span>
              ) : null}
            </div>
            {eligible ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                <Check className="size-3" strokeWidth={2.5} aria-hidden />
                {copy.statusEnabled}
              </span>
            ) : (
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-accent text-accent"
                aria-hidden
              >
                <Plus className="size-4" strokeWidth={2.5} />
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-fg-muted">
            {ext.description?.trim() || copy.cardNoDescription}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
              {ext.hasUi ? copy.badgeKindUi : copy.badgeKindBackend}
            </span>
            {ext.source === 'bundled' ? (
              <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                {copy.badgeBundled}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}

function ExtensionDetailDialog({
  extension: ext,
  copy,
  onClose,
  onAfterToggle,
}: {
  extension: ExtensionApiRow;
  copy: AppsPageCopy;
  onClose: () => void;
  onAfterToggle: () => void | Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const pages = ext.ui?.contributions?.pages ?? [];
  const settingsPanels = ext.ui?.contributions?.settingsPanels ?? [];
  const chatWidgets = ext.ui?.contributions?.chatWidgets ?? [];
  const sidebarPanels = ext.ui?.contributions?.sidebarPanels ?? [];
  const primaryPage: PageContribution | undefined = pages.find((p) => p.showInNav) ?? pages[0];
  const primarySettingsPanel = settingsPanels[0];
  const openPath = primaryPage ? extensionPagePath(ext.id, primaryPage) : null;
  const settingsPath = primarySettingsPanel
    ? `/settings/ext/${ext.id}/${primarySettingsPanel.id}`
    : null;

  const eligible = activationEligibleFor(ext);
  const isBundled = ext.source === 'bundled';

  const toggleBundled = async (next: boolean) => {
    setErrorMessage(null);
    setSaving(true);
    try {
      await fetchJson<{ ok: true; payload: { requiresGatewayRestart: boolean } }>(
        apiUrl('/api/extensions/bundled/activation'),
        { method: 'POST', body: JSON.stringify({ extensionId: ext.id, enabled: next }) },
      );
      await onAfterToggle();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : copy.toggleError);
    } finally {
      setSaving(false);
    }
  };

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
              {copy.detailTitle}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {ext.name} ({ext.id})
            </Dialog.Description>
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
            <div className="flex flex-wrap items-start gap-4">
              <div
                className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-xl font-semibold text-accent-fg"
                aria-hidden
              >
                {(ext.name || ext.id).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold text-fg">{ext.name}</h3>
                <p className="mt-0.5 text-sm text-fg-muted">
                  {copy.detailProviderPrefix} {providerLabel(ext, copy)}
                </p>
                {ext.version ? (
                  <p className="mt-1 text-xs text-fg-muted">v{ext.version}</p>
                ) : null}
              </div>
              {isBundled ? (
                <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                  <button
                    type="button"
                    disabled={saving}
                    aria-busy={saving}
                    onClick={() => void toggleBundled(!eligible)}
                    className={cn(
                      'relative inline-flex max-w-full rounded-full py-1.5 text-sm font-medium',
                      'transition-[color,background-color,border-color,opacity] duration-200 ease-out',
                      'focus-visible:outline-none focus-visible:ring-2 motion-reduce:transition-none',
                      eligible
                        ? 'border-2 border-red-500/50 text-red-600 hover:bg-red-500/10 focus-visible:ring-red-500/40 dark:text-red-400'
                        : 'border-2 border-transparent bg-accent text-white hover:opacity-90 focus-visible:ring-accent',
                      saving && 'cursor-wait opacity-80',
                    )}
                  >
                    <span className="block whitespace-nowrap px-4 text-center leading-none">
                      {eligible ? copy.actionDisable : copy.actionEnable}
                    </span>
                    <Loader2
                      className={cn(
                        'pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-current opacity-90',
                        saving ? 'animate-spin' : 'invisible',
                      )}
                      aria-hidden
                    />
                  </button>
                </div>
              ) : null}
            </div>

            <p className="mt-5 text-sm leading-relaxed text-fg">
              {ext.description?.trim() || copy.detailNoDescription}
            </p>

            {!ext.hasUi ? (
              <p className="mt-3 text-xs text-fg-muted">{copy.backendOnlyHint}</p>
            ) : null}

            <p className="mt-2 text-xs text-fg-muted">{bundledRunCaption(ext, copy)}</p>

            {errorMessage ? (
              <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-fg" role="alert">
                {errorMessage}
              </p>
            ) : null}

            {!isBundled ? (
              <p className="mt-4 rounded-lg border border-edge-subtle bg-surface-hover/40 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/20">
                {copy.cliManageHint}
              </p>
            ) : null}

            {ext.hasUi && (pages.length > 0 || settingsPanels.length > 0 || chatWidgets.length > 0) ? (
              <section className="mt-8">
                <h4 className="mb-3 text-sm font-semibold text-fg">{copy.detailSectionFeatures}</h4>
                <div className="flex flex-wrap gap-1.5">
                  <ContributionBadge
                    template={copy.badgePages}
                    count={pages.length}
                    hidden={pages.length === 0}
                  />
                  <ContributionBadge
                    template={copy.badgeSettings}
                    count={settingsPanels.length}
                    hidden={settingsPanels.length === 0}
                  />
                  <ContributionBadge
                    template={copy.badgeWidgets}
                    count={chatWidgets.length}
                    hidden={chatWidgets.length === 0}
                  />
                  <ContributionBadge
                    template={copy.badgeSidebar}
                    count={sidebarPanels.length}
                    hidden={sidebarPanels.length === 0}
                  />
                </div>
              </section>
            ) : null}

            {extensionExposesGatewayShellUi(ext) && (openPath || settingsPath) ? (
              <div className="mt-6 flex flex-wrap gap-2 border-t border-edge-subtle pt-4">
                {openPath ? (
                  <Link
                    to={openPath}
                    onClick={onClose}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg',
                      'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                  >
                    <ExternalLink className="size-4 shrink-0 opacity-80" aria-hidden />
                    {copy.open}
                  </Link>
                ) : null}
                {settingsPath ? (
                  <Link
                    to={settingsPath}
                    onClick={onClose}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg',
                      'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    )}
                  >
                    <Settings className="size-4 shrink-0 opacity-80" aria-hidden />
                    {copy.openSettings}
                  </Link>
                ) : null}
              </div>
            ) : null}

            <p className="mt-6 text-[11px] leading-relaxed text-fg-muted">{copy.restartNote}</p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ContributionBadge({
  template,
  count,
  hidden,
}: {
  template: string;
  count: number;
  hidden: boolean;
}) {
  if (hidden || count === 0) return null;
  return (
    <span className="inline-flex items-center rounded-md bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-fg-muted">
      {template.replace(/\{\{count\}\}/g, String(count))}
    </span>
  );
}

function AppsPageSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <div className="mb-6 h-8 w-40 max-w-full animate-pulse rounded-md bg-surface-hover" />
        <div className="mb-2 h-4 w-full max-w-md animate-pulse rounded bg-surface-hover" />
        <div className="mb-5 h-9 w-full max-w-lg animate-pulse rounded-full bg-surface-hover" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl border border-edge bg-surface-base" />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyAppsState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[min(40vh,16rem)] flex-col items-center justify-center rounded-xl border border-dashed border-edge-subtle bg-surface-hover/40 px-4 py-12 text-center dark:bg-surface-hover/20">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
