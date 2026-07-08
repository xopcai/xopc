import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, Check, ExternalLink, Loader2, Plus, Search, Settings, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSWRConfig } from 'swr';

import { Button } from '@/components/ui/button';
import { PageTabs } from '@/components/ui/page-tabs';
import { parseAppsMainTab, type AppsMainTab } from '@/features/apps/apps-page.constants';
import {
  useExtensions,
  useExtensionsLoading,
} from '@/features/extensions/extension-provider';
import {
  extensionHasProviderCredentialsSettings,
  extensionShellUiReachable,
} from '@/features/extensions/extension-ui-guards';
import { ExtensionMarketplacePanel } from '@/features/extensions/extension-marketplace';
import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
import { postBundledExtensionActivation } from '@/features/extensions/extension-marketplace-api';
import { extensionPagePath } from '@/features/extensions/extension-paths';
import type { ExtensionApiRow, PageContribution } from '@/features/extensions/types';
import { messages } from '@/i18n/messages';
import type { MessageBundle } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { usePageHeaderStore } from '@/stores/page-header-store';
import { useLocaleStore } from '@/stores/locale-store';

type AppsPageCopy = MessageBundle['appsPage'];

export function AppsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const setPageHeader = usePageHeaderStore((s) => s.setPageHeader);
  const clearPageHeader = usePageHeaderStore((s) => s.clearPageHeader);
  const extensions = useExtensions();
  const loading = useExtensionsLoading();
  const [searchParams, setSearchParams] = useSearchParams();

  const initialTab = parseAppsMainTab(searchParams.get('tab'));
  const initialQ = searchParams.get('q') ?? '';
  const [mainTab, setMainTab] = useState<AppsMainTab>(initialTab);
  const [search, setSearch] = useState(initialQ);
  const [detail, setDetail] = useState<ExtensionApiRow | null>(null);

  // Sync URL → local state during render so the URL→state→URL effect chain doesn't add a render.
  const searchParamsKey = searchParams.toString();
  const trackedSearchParamsKeyRef = useRef(searchParamsKey);
  if (trackedSearchParamsKeyRef.current !== searchParamsKey) {
    trackedSearchParamsKeyRef.current = searchParamsKey;
    const nextTab = parseAppsMainTab(searchParams.get('tab'));
    const nextQ = searchParams.get('q') ?? '';
    setMainTab((prev) => (prev === nextTab ? prev : nextTab));
    setSearch((prev) => (prev === nextQ ? prev : nextQ));
  }

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        const qq = search.trim();
        if (qq) params.set('q', qq);
        else params.delete('q');
        if (mainTab !== 'marketplace') params.set('tab', mainTab);
        else params.delete('tab');
        if (params.toString() === prev.toString()) return prev;
        return params;
      },
      { replace: true },
    );
  }, [mainTab, search, setSearchParams]);

  const bundledExtensions = useMemo(
    () => extensions.filter((e) => e.source === 'bundled'),
    [extensions],
  );
  const userExtensions = useMemo(
    () => extensions.filter((e) => e.source !== 'bundled'),
    [extensions],
  );

  const listForTab = mainTab === 'builtin' ? bundledExtensions : userExtensions;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = listForTab;
    if (q) {
      list = list.filter(
        (e) =>
          (e.name ?? '').toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          (e.description ?? '').toLowerCase().includes(q),
      );
    }
    return list.toSorted((a, b) => {
      if (a.hasUi !== b.hasUi) return a.hasUi ? -1 : 1;
      return (a.name || a.id).localeCompare(b.name || b.id, language);
    });
  }, [listForTab, search, language]);

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
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold tracking-tight text-fg">{m.appsPage.title}</h1>
        </div>
      ),
      end: null,
    });
    return () => clearPageHeader();
  }, [clearPageHeader, m.appsPage.title, setPageHeader]);

  if (loading && mainTab !== 'marketplace') {
    return <AppsPageSkeleton />;
  }

  const showSearch = mainTab !== 'marketplace' && listForTab.length > 0;
  const tabItems = [
    { id: 'marketplace' as const, label: m.appsPage.tabMarketplace },
    { id: 'builtin' as const, label: m.appsPage.tabBuiltin, count: bundledExtensions.length },
    { id: 'user' as const, label: m.appsPage.tabUser, count: userExtensions.length },
  ];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
      <div className="w-full px-3 py-8 sm:px-5 xl:px-6">
        <div className="mb-5 flex flex-col gap-3 border-b border-edge-subtle pb-3 sm:flex-row sm:items-center sm:justify-between dark:border-edge-subtle">
          <PageTabs
            items={tabItems}
            activeTab={mainTab}
            onChange={setMainTab}
            ariaLabel={m.appsPage.appsNavAria}
            tabIdPrefix="apps-tab"
            panelIdPrefix="apps-panel"
            className="flex-wrap"
          />
          {showSearch ? (
            <div className="relative w-full min-w-0 sm:max-w-xs">
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
          ) : null}
        </div>

        {mainTab === 'marketplace' ? (
          <ExtensionMarketplacePanel />
        ) : mainTab === 'builtin' && bundledExtensions.length === 0 ? (
          <EmptyAppsState message={m.appsPage.emptyBuiltin} />
        ) : mainTab === 'user' && userExtensions.length === 0 ? (
          <EmptyAppsState message={m.appsPage.emptyUser} />
        ) : filtered.length === 0 ? (
          <p className="rounded-xl bg-surface-panel px-3 py-8 text-center text-sm text-fg-muted shadow-surface sm:px-5 xl:px-6">
            {m.appsPage.noSearchResults}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ext) => (
              <ExtensionAppCard
                key={ext.id}
                extension={ext}
                copy={m.appsPage}
                showSourceBadge={mainTab === 'user'}
                onOpen={() => setDetail(ext)}
              />
            ))}
          </div>
        )}
      </div>

      {detail ? (
        <ExtensionDetailDialog key={detail.id} extension={detail} copy={m.appsPage} onClose={() => setDetail(null)} />
      ) : null}
    </div>
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

function installSourceBadgeLabel(ext: ExtensionApiRow, copy: AppsPageCopy): string {
  if (ext.source === 'global') return copy.badgeSourceGlobal;
  if (ext.source === 'workspace') return copy.badgeSourceWorkspace;
  return copy.badgeSourceOther;
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
  showSourceBadge,
  onOpen,
}: {
  extension: ExtensionApiRow;
  copy: AppsPageCopy;
  /** When true, show a short global/workspace/other pill (user-installed tab). */
  showSourceBadge: boolean;
  onOpen: () => void;
}) {
  const eligible = activationEligibleFor(ext);
  const uiTitle = ext.hasUi ? copy.cardTooltipHasUi : copy.cardTooltipNoUi;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'group flex w-full flex-col rounded-xl bg-surface-panel p-4 text-left shadow-surface transition-colors',
        'hover:bg-surface-hover/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
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
            <span
              title={uiTitle}
              className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted"
            >
              {ext.hasUi ? copy.badgeKindUi : copy.badgeKindBackend}
            </span>
            {ext.source === 'bundled' ? (
              <span className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
                {copy.badgeBundled}
              </span>
            ) : showSourceBadge ? (
              <span
                title={providerLabel(ext, copy)}
                className="rounded-md bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-fg-muted"
              >
                {installSourceBadgeLabel(ext, copy)}
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
}: {
  extension: ExtensionApiRow;
  copy: AppsPageCopy;
  onClose: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [bundledToggleBusy, setBundledToggleBusy] = useState(false);
  const [bundledToggleErr, setBundledToggleErr] = useState<string | null>(null);
  const [bundledRestartHint, setBundledRestartHint] = useState(false);

  // Reflect *user intent* — the persisted enabled/disabled config — rather than
  // whether the gateway has actually loaded the process yet. Without this,
  // disabling a still-running extension leaves the button labelled "停用",
  // making the toggle look like it did nothing on subsequent clicks.
  const bundledConfiguredOn = ext.activationEligible === true;

  const onBundledActivationToggle = useCallback(async () => {
    if (ext.source !== 'bundled') return;
    setBundledToggleErr(null);
    setBundledRestartHint(false);
    setBundledToggleBusy(true);
    try {
      const { requiresGatewayRestart } = await postBundledExtensionActivation({
        extensionId: ext.id,
        enabled: !bundledConfiguredOn,
      });
      await mutate('gateway-extensions-list');
      dispatchConfigReload();
      setBundledRestartHint(requiresGatewayRestart);
    } catch (e) {
      setBundledToggleErr(e instanceof Error ? e.message : copy.builtinToggleFailed);
    } finally {
      setBundledToggleBusy(false);
    }
  }, [bundledConfiguredOn, copy.builtinToggleFailed, ext.id, ext.source, mutate]);

  const pages = ext.ui?.contributions?.pages ?? [];
  const settingsPanels = ext.ui?.contributions?.settingsPanels ?? [];
  const chatWidgets = ext.ui?.contributions?.chatWidgets ?? [];
  const sidebarPanels = ext.ui?.contributions?.sidebarPanels ?? [];
  const primaryPage: PageContribution | undefined = pages.find((p) => p.showInNav) ?? pages[0];
  const primarySettingsPanel = settingsPanels[0];
  const openPath = primaryPage ? extensionPagePath(ext.id, primaryPage) : null;
  const settingsPath = primarySettingsPanel
    ? `/settings/ext/${ext.id}/${primarySettingsPanel.id}`
    : ext.hasConfigSchema || extensionHasProviderCredentialsSettings(ext)
      ? `/settings/ext/${ext.id}`
      : null;

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

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
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
            </div>

            <p className="mt-5 text-sm leading-relaxed text-fg">
              {ext.description?.trim() || copy.detailNoDescription}
            </p>

            {!ext.hasUi ? (
              <p className="mt-3 text-xs text-fg-muted">{copy.backendOnlyHint}</p>
            ) : null}

            <p className="mt-2 text-xs text-fg-muted">{bundledRunCaption(ext, copy)}</p>

            {ext.source === 'bundled' ? (
              <>
                <p className="mt-4 rounded-lg border border-edge-subtle bg-surface-hover/40 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/20">
                  {copy.builtinConfigHint}
                </p>
                <div className="mt-3 rounded-lg border border-edge-subtle bg-surface-hover/40 p-3 dark:bg-surface-hover/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-fg">{copy.builtinRuntimeToggle}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={bundledToggleBusy}
                      onClick={() => void onBundledActivationToggle()}
                      className="shrink-0 py-1.5 text-xs"
                    >
                      {bundledToggleBusy ? (
                        <>
                          <Loader2 className="mr-1.5 size-3.5 shrink-0 animate-spin" aria-hidden />
                          {copy.builtinToggleBusy}
                        </>
                      ) : bundledConfiguredOn ? (
                        copy.builtinToggleDisable
                      ) : (
                        copy.builtinToggleEnable
                      )}
                    </Button>
                  </div>
                  {bundledToggleErr ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{bundledToggleErr}</p>
                  ) : null}
                  {bundledRestartHint ? (
                    <p className="mt-2 text-xs text-fg-muted">{copy.builtinToggleRestartHint}</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="mt-4 rounded-lg border border-edge-subtle bg-surface-hover/40 px-3 py-2 text-xs text-fg-muted dark:bg-surface-hover/20">
                {copy.cliManageHint}
              </p>
            )}

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

            {extensionShellUiReachable(ext) && (openPath || settingsPath) ? (
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-base">
      <div className="w-full px-3 py-8 sm:px-5 xl:px-6">
        <div className="mb-6 h-8 w-40 max-w-full animate-pulse rounded-md bg-surface-hover" />
        <div className="mb-2 h-4 w-full max-w-md animate-pulse rounded bg-surface-hover" />
        <div className="mb-5 h-9 w-full max-w-lg animate-pulse rounded-full bg-surface-hover" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(['ap0', 'ap1', 'ap2', 'ap3', 'ap4', 'ap5'] as const).map((k) => (
            <div key={k} className="h-36 animate-pulse rounded-xl bg-surface-panel shadow-surface" />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyAppsState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[min(40vh,16rem)] flex-col items-center justify-center rounded-xl bg-surface-panel px-4 py-12 text-center shadow-surface">
      <p className="text-sm text-fg-muted">{message}</p>
    </div>
  );
}
