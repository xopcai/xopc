import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { uiPatchReducer } from '@/lib/settings-form-draft';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PageTabs, type PageTabItem } from '@/components/ui/page-tabs';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
import {
  SettingsPageFrame,
  SettingsPageHeader,
  SettingsTabPanel,
} from '@/features/settings/settings-page-layout';
import {
  cleanExpiredShares,
  createShare,
  extendShare,
  fetchShares,
  revokeShare,
  type CreateShareParams,
  type ShareItem,
} from '@/features/shares/shares-api';
import {
  ReachabilityHint,
  ShareLinkDialog,
  ShareUrlCopyRows,
  type ShareLinkResult,
} from '@/features/shares/share-link-dialog';
import { SharePolicySection } from '@/features/shares/share-policy-section';
import { WorkspacePathPickerDialog } from '@/features/shares/workspace-path-picker';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/copy-to-clipboard';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';
import { Select, SelectOption } from '@/components/ui/popover-select';

// ── Tab plumbing ──────────────────────────────────────────────────────────────

type SharesTabId = 'shares' | 'policy';
const SHARES_TABS: readonly SharesTabId[] = ['shares', 'policy'] as const;

function parseSharesTab(raw: string | null | undefined): SharesTabId {
  const id = (raw ?? '').trim();
  return SHARES_TABS.includes(id as SharesTabId) ? (id as SharesTabId) : 'shares';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatRelativeTime(isoDate: string, language: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  if (absDiff < 60_000) return language === 'zh' ? '刚刚' : 'just now';
  const minutes = Math.floor(absDiff / 60_000);
  if (minutes < 60) {
    const label = language === 'zh' ? `${minutes} 分钟` : `${minutes}m`;
    return isPast ? (language === 'zh' ? `${label}前` : `${label} ago`) : label;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const label = language === 'zh' ? `${hours} 小时` : `${hours}h`;
    return isPast ? (language === 'zh' ? `${label}前` : `${label} ago`) : label;
  }
  const days = Math.floor(hours / 24);
  const label = language === 'zh' ? `${days} 天` : `${days}d`;
  return isPast ? (language === 'zh' ? `${label}前` : `${label} ago`) : label;
}

const TTL_OPTIONS = [
  { value: 3_600_000, key: '1h' },
  { value: 21_600_000, key: '6h' },
  { value: 86_400_000, key: '24h' },
  { value: 259_200_000, key: '3d' },
  { value: 604_800_000, key: '7d' },
] as const;

// ── Main Panel ────────────────────────────────────────────────────────────────

export function SharesSettingsPanel() {
  const language = useLocaleStore((s) => s.language);
  const t = messages(language).sharesSettings;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = parseSharesTab(searchParams.get('tab'));

  const setActiveTab = useCallback(
    (tab: SharesTabId) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (tab === 'shares') next.delete('tab');
          else next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  if (!hasToken) {
    return (
      <SettingsPageFrame gap="gap-3" padding="px-3 py-8 sm:px-5 xl:px-6">
        <p className="text-sm text-fg-muted">{t.needToken}</p>
      </SettingsPageFrame>
    );
  }

  const tabLabels: Record<SharesTabId, string> = {
    shares: t.tabShares,
    policy: t.tabPolicy,
  };
  const tabItems: PageTabItem<SharesTabId>[] = SHARES_TABS.map((tab) => ({
    id: tab,
    label: tabLabels[tab],
  }));

  return (
    <SettingsPageFrame>
      <SettingsPageHeader title={t.title} subtitle={t.subtitle} />

      <PageTabs
        items={tabItems}
        activeTab={activeTab}
        onChange={setActiveTab}
        ariaLabel={t.tabsAria}
        tabIdPrefix="shares-tab"
        panelIdPrefix="shares-panel"
      />

      <SettingsTabPanel
        id={activeTab}
        activeTab={activeTab}
        tabIdPrefix="shares-tab"
        panelIdPrefix="shares-panel"
        showHeading={false}
      >
          {activeTab === 'shares' ? (
            <SharesManageTab t={t} language={language} />
          ) : (
            <SharePolicySection hasToken={hasToken} />
          )}
      </SettingsTabPanel>
    </SettingsPageFrame>
  );
}

function SharesManageTab({
  t,
  language,
}: {
  t: ReturnType<typeof messages>['sharesSettings'];
  language: 'en' | 'zh';
}) {
  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR('shares-list', fetchShares, { refreshInterval: 30_000 });

  const shares = data?.payload?.shares ?? [];
  const [showExpired, setShowExpired] = useState(false);

  const filteredShares = useMemo(() => {
    if (showExpired) return shares;
    return shares.filter((s) => !s.expired && !s.revoked);
  }, [shares, showExpired]);

  const activeCount = useMemo(() => shares.filter((s) => !s.expired && !s.revoked).length, [shares]);
  const expiredCount = useMemo(() => shares.filter((s) => s.expired || s.revoked).length, [shares]);

  return (
    <div className="flex flex-col gap-6">
      <CreateShareSection t={t} onCreated={() => void mutate()} />

      <SettingsFormSection>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">
            {showExpired ? t.allSharesTitle : t.listTitle}
            {activeCount > 0 && (
              <span className="ml-2 text-xs font-normal text-fg-muted">({activeCount})</span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              className="px-2 py-1"
              onClick={() => void mutate()}
              disabled={isLoading}
            >
              <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
            </Button>
            {expiredCount > 0 && (
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => setShowExpired((v) => !v)}
              >
                {showExpired ? t.hideExpired : t.showExpired}
              </button>
            )}
          </div>
        </div>

        {isLoading && !data ? (
          <p className="flex items-center gap-2 text-sm text-fg-muted">
            <Loader2 className="size-4 animate-spin" />
            {t.loading}
          </p>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <span>{t.error}</span>
            <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => void mutate()}>
              {t.retry}
            </Button>
          </div>
        ) : filteredShares.length === 0 ? (
          <p className="text-sm text-fg-muted">{t.emptyState}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredShares.map((share) => (
              <ShareRow
                key={share.id}
                share={share}
                t={t}
                language={language}
                onRevoked={() => void mutate()}
                onExtended={() => void mutate()}
              />
            ))}
          </div>
        )}

        {expiredCount > 0 && showExpired && (
          <CleanExpiredButton t={t} onCleaned={() => void mutate()} />
        )}
      </SettingsFormSection>
    </div>
  );
}

// ── Create Section ────────────────────────────────────────────────────────────

type CreateShareUi = {
  expanded: boolean;
  path: string;
  isDirectory: boolean;
  agentId: string;
  ttlMs: number;
  maxViews: number | null;
  description: string;
  directoryMode: 'browse' | 'zip-only';
  creating: boolean;
  result: ShareLinkResult | null;
  errorMsg: string | null;
  resultDialogOpen: boolean;
  pickerOpen: boolean;
};

const initialCreateShareUi: CreateShareUi = {
  expanded: true,
  path: '',
  isDirectory: false,
  agentId: '',
  ttlMs: 86_400_000,
  maxViews: null,
  description: '',
  directoryMode: 'browse',
  creating: false,
  result: null,
  errorMsg: null,
  resultDialogOpen: false,
  pickerOpen: false,
};

function CreateShareSection({
  t,
  onCreated,
}: {
  t: ReturnType<typeof messages>['sharesSettings'];
  onCreated: () => void;
}) {
  const [ui, dispatch] = useReducer(uiPatchReducer<CreateShareUi>, initialCreateShareUi);
  const {
    expanded,
    path,
    isDirectory,
    agentId,
    ttlMs,
    maxViews,
    description,
    directoryMode,
    creating,
    result,
    errorMsg,
    resultDialogOpen,
    pickerOpen,
  } = ui;

  const handleCreate = useCallback(async () => {
    if (!path.trim()) return;
    dispatch({ type: 'patch', patch: { creating: true, errorMsg: null, result: null } });
    try {
      const params: CreateShareParams = {
        path: path.trim(),
        ttlMs,
        maxViews,
        description: description.trim() || undefined,
        ...(agentId ? { agentId } : {}),
        ...(isDirectory ? { kind: 'directory', directoryMode } : {}),
      };
      const res = await createShare(params);
      dispatch({ type: 'patch', patch: { result: res.payload, resultDialogOpen: true } });
      onCreated();
    } catch (err) {
      dispatch({
        type: 'patch',
        patch: { errorMsg: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      dispatch({ type: 'patch', patch: { creating: false } });
    }
  }, [path, isDirectory, agentId, ttlMs, maxViews, description, directoryMode, onCreated]);

  const resetForm = useCallback(() => {
    dispatch({
      type: 'patch',
      patch: {
        path: '',
        isDirectory: false,
        agentId: '',
        description: '',
        maxViews: null,
        ttlMs: 86_400_000,
        directoryMode: 'browse',
        result: null,
        errorMsg: null,
      },
    });
  }, []);

  if (!expanded) {
    return (
      <Button type="button" onClick={() => dispatch({ type: 'patch', patch: { expanded: true } })} className="self-start">
        <Plus className="size-4" />
        {t.createTitle}
      </Button>
    );
  }

  return (
    <SettingsFormSection>
      <h2 className="mb-1 text-sm font-semibold text-fg">{t.createTitle}</h2>
      <p className="mb-4 text-xs text-fg-muted">{t.createHint}</p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg">{t.pathLabel}</span>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm',
                path ? 'text-fg' : 'text-fg-subtle',
              )}
            >
              {path ? (
                <>
                  <span aria-hidden>{isDirectory ? '📁' : '📄'}</span>
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {path}
                  </span>
                </>
              ) : (
                <span className="truncate">{t.pathPlaceholder}</span>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => dispatch({ type: 'patch', patch: { pickerOpen: true } })}
            >
              <FileText className="size-4" />
              {path ? t.pathBrowseChange : t.pathBrowse}
            </Button>
          </div>
        </div>

        {isDirectory ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg">{t.directoryModeLabel}</span>
            <Select
              className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              value={directoryMode}
              onChange={(e) =>
                dispatch({
                  type: 'patch',
                  patch: { directoryMode: e.target.value === 'zip-only' ? 'zip-only' : 'browse' },
                })
              }
            >
              <SelectOption value="browse">{t.directoryModeBrowse}</SelectOption>
              <SelectOption value="zip-only">{t.directoryModeZipOnly}</SelectOption>
            </Select>
          </label>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg">{t.ttlLabel}</span>
            <Select
              className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              value={ttlMs}
              onChange={(e) => dispatch({ type: 'patch', patch: { ttlMs: Number(e.target.value) } })}
            >
              {TTL_OPTIONS.map((opt) => (
                <SelectOption key={opt.key} value={opt.value}>
                  {t.ttlOptions[opt.key]}
                </SelectOption>
              ))}
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg">{t.maxViewsLabel}</span>
            <Select
              className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              value={maxViews ?? 'unlimited'}
              onChange={(e) =>
                dispatch({
                  type: 'patch',
                  patch: {
                    maxViews: e.target.value === 'unlimited' ? null : Number(e.target.value),
                  },
                })
              }
            >
              <SelectOption value="unlimited">{t.maxViewsUnlimited}</SelectOption>
              <SelectOption value="1">1</SelectOption>
              <SelectOption value="5">5</SelectOption>
              <SelectOption value="10">10</SelectOption>
              <SelectOption value="50">50</SelectOption>
              <SelectOption value="100">100</SelectOption>
            </Select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg">{t.descriptionLabel}</span>
          <input
            type="text"
            className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder={t.descriptionPlaceholder}
            value={description}
            onChange={(e) => dispatch({ type: 'patch', patch: { description: e.target.value } })}
          />
        </label>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" disabled={creating || !path.trim()} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {creating ? t.creating : t.createButton}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { resetForm(); dispatch({ type: 'patch', patch: { expanded: false } }); }}>
            {t.cancel}
          </Button>
        </div>

        {errorMsg && <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}
      </div>

      <ShareLinkDialog
        open={resultDialogOpen}
        onOpenChange={(open) => {
          dispatch({ type: 'patch', patch: { resultDialogOpen: open, ...(open ? {} : { result: null }) } });
        }}
        result={result}
      />

      <WorkspacePathPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => dispatch({ type: 'patch', patch: { pickerOpen: open } })}
        initialPath={path || undefined}
        selectKind="any"
        onConfirm={(picked) =>
          dispatch({
            type: 'patch',
            patch: {
              path: picked.path,
              isDirectory: picked.isDirectory,
              agentId: picked.agentId,
              directoryMode: 'browse',
            },
          })
        }
      />
    </SettingsFormSection>
  );
}

// ── Share Row ─────────────────────────────────────────────────────────────────

type ShareRowUi = {
  revokeOpen: boolean;
  revoking: boolean;
  linksOpen: boolean;
  urlCopied: boolean;
  copyFailed: boolean;
  extending: boolean;
};

const initialShareRowUi: ShareRowUi = {
  revokeOpen: false,
  revoking: false,
  linksOpen: false,
  urlCopied: false,
  copyFailed: false,
  extending: false,
};

function ShareRow({
  share,
  t,
  language,
  onRevoked,
  onExtended,
}: {
  share: ShareItem;
  t: ReturnType<typeof messages>['sharesSettings'];
  language: string;
  onRevoked: () => void;
  onExtended: () => void;
}) {
  const [ui, dispatch] = useReducer(uiPatchReducer<ShareRowUi>, initialShareRowUi);
  const { revokeOpen, revoking, linksOpen, urlCopied, copyFailed, extending } = ui;

  const isActive = !share.expired && !share.revoked;
  const statusLabel = share.revoked ? t.statusRevoked : share.expired ? t.statusExpired : t.statusActive;
  const statusColor = share.revoked
    ? 'text-red-600 dark:text-red-400'
    : share.expired
      ? 'text-fg-subtle'
      : 'text-emerald-600 dark:text-emerald-400';

  const handleRevoke = useCallback(async () => {
    dispatch({ type: 'patch', patch: { revokeOpen: false, revoking: true } });
    try {
      await revokeShare(share.id);
      onRevoked();
    } catch {
      /* silent */
    } finally {
      dispatch({ type: 'patch', patch: { revoking: false } });
    }
  }, [share.id, onRevoked]);

  const handleCopy = useCallback(async () => {
    dispatch({ type: 'patch', patch: { linksOpen: true, copyFailed: false } });
    const ok = await copyTextToClipboard(share.shareUrl);
    if (!ok) {
      dispatch({ type: 'patch', patch: { copyFailed: true } });
      window.setTimeout(() => dispatch({ type: 'patch', patch: { copyFailed: false } }), 2500);
      return;
    }
    dispatch({ type: 'patch', patch: { urlCopied: true } });
    window.setTimeout(() => dispatch({ type: 'patch', patch: { urlCopied: false } }), 2000);
  }, [share.shareUrl]);

  const handleExtend = useCallback(async () => {
    dispatch({ type: 'patch', patch: { extending: true } });
    try {
      await extendShare(share.id, 86_400_000);
      onExtended();
    } catch {
      /* silent */
    } finally {
      dispatch({ type: 'patch', patch: { extending: false } });
    }
  }, [share.id, onExtended]);

  const linksPanelId = `share-links-${share.id}`;

  return (
    <>
      <div className="rounded-lg bg-surface-panel/80 px-3 py-2.5 shadow-surface">
        <div className="flex items-start gap-3">
          <button
            type="button"
            className={cn(
              'flex min-w-0 flex-1 items-start gap-3 rounded-md text-left',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            )}
            aria-expanded={linksOpen}
            aria-controls={linksPanelId}
            onClick={() => dispatch({ type: 'patch', patch: { linksOpen: !linksOpen } })}
          >
            <ChevronDown
              className={cn(
                'mt-0.5 size-4 shrink-0 text-fg-muted transition-transform',
                linksOpen ? 'rotate-0' : '-rotate-90',
              )}
              aria-hidden
            />
            <FileText className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-fg">{share.fileName}</span>
                <span className={cn('text-xs font-medium', statusColor)}>{statusLabel}</span>
              </div>
              <p className="truncate text-xs text-fg-subtle">{share.workspaceRelativePath}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                <span>{formatFileSize(share.fileSize)}</span>
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {share.expired
                    ? (language === 'zh' ? '已过期' : 'expired')
                    : formatRelativeTime(share.expiresAt, language)}
                </span>
                <span>
                  {t.views}: {share.downloadCount}
                  {share.maxViews !== null && ` ${t.viewsOf} ${share.maxViews}`}
                </span>
                {share.description && (
                  <span className="italic text-fg-subtle">{share.description}</span>
                )}
              </div>
            </div>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {isActive && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1"
                  title={t.copyUrl}
                  onClick={() => void handleCopy()}
                >
                  {urlCopied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1"
                  onClick={() => void handleExtend()}
                  disabled={extending}
                  title={t.extend}
                >
                  {extending ? <Loader2 className="size-3.5 animate-spin" /> : <Clock className="size-3.5" />}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="px-2 py-1 text-red-600 hover:text-red-700 dark:text-red-400"
                  onClick={() => dispatch({ type: 'patch', patch: { revokeOpen: true } })}
                  disabled={revoking}
                >
                  {revoking ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </>
            )}
          </div>
        </div>
        {isActive && linksOpen ? (
          <div
            id={linksPanelId}
            className="mt-3 bg-surface-base/45 py-3 pl-7 pr-3"
          >
            <ShareUrlCopyRows
              shareUrl={share.shareUrl}
              lanUrl={share.lanUrl}
              reachability={share.reachability}
              compact
            />
            {copyFailed ? (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{t.copyFailed}</p>
            ) : null}
            <div className="mt-2">
              <ReachabilityHint reachability={share.reachability} />
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={revokeOpen}
        title={t.revokeConfirmTitle}
        description={t.revokeConfirmBody}
        confirmLabel={t.revokeConfirmLabel}
        cancelLabel={t.cancel}
        destructive
        onConfirm={() => void handleRevoke()}
        onCancel={() => dispatch({ type: 'patch', patch: { revokeOpen: false } })}
      />
    </>
  );
}

// ── Clean Expired Button ──────────────────────────────────────────────────────

function CleanExpiredButton({
  t,
  onCleaned,
}: {
  t: ReturnType<typeof messages>['sharesSettings'];
  onCleaned: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);

  const handleClean = useCallback(async () => {
    setConfirmOpen(false);
    setCleaning(true);
    try {
      await cleanExpiredShares();
      onCleaned();
    } catch {
      /* silent */
    } finally {
      setCleaning(false);
    }
  }, [onCleaned]);

  return (
    <>
      <div className="mt-3 flex justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={cleaning}
          onClick={() => setConfirmOpen(true)}
          className="border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/10"
        >
          {cleaning ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          {t.cleanExpired}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={t.cleanExpiredConfirmTitle}
        description={t.cleanExpiredConfirmBody}
        confirmLabel={t.cleanExpiredConfirmLabel}
        cancelLabel={t.cancel}
        destructive
        onConfirm={() => void handleClean()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
