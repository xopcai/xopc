import {
  Check,
  Clock,
  Copy,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SettingsFormSection } from '@/features/settings/settings-form-section';
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
import { cn } from '@/lib/cn';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

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

  const {
    data,
    error,
    isLoading,
    mutate,
  } = useSWR(hasToken ? 'shares-list' : null, fetchShares, { refreshInterval: 30_000 });

  const shares = data?.payload?.shares ?? [];
  const [showExpired, setShowExpired] = useState(false);

  const filteredShares = useMemo(() => {
    if (showExpired) return shares;
    return shares.filter((s) => !s.expired && !s.revoked);
  }, [shares, showExpired]);

  const activeCount = useMemo(() => shares.filter((s) => !s.expired && !s.revoked).length, [shares]);
  const expiredCount = useMemo(() => shares.filter((s) => s.expired || s.revoked).length, [shares]);

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-8">
        <p className="text-sm text-fg-muted">{t.needToken}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-app-main flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold text-fg">{t.title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{t.subtitle}</p>
      </div>

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

function CreateShareSection({
  t,
  onCreated,
}: {
  t: ReturnType<typeof messages>['sharesSettings'];
  onCreated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [path, setPath] = useState('');
  const [ttlMs, setTtlMs] = useState(86_400_000);
  const [maxViews, setMaxViews] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<ShareLinkResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!path.trim()) return;
    setCreating(true);
    setErrorMsg(null);
    setResult(null);
    try {
      const params: CreateShareParams = {
        path: path.trim(),
        ttlMs,
        maxViews,
        description: description.trim() || undefined,
      };
      const res = await createShare(params);
      setResult(res.payload);
      setResultDialogOpen(true);
      onCreated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }, [path, ttlMs, maxViews, description, onCreated]);

  const resetForm = useCallback(() => {
    setPath('');
    setDescription('');
    setMaxViews(null);
    setTtlMs(86_400_000);
    setResult(null);
    setErrorMsg(null);
  }, []);

  if (!expanded) {
    return (
      <Button type="button" onClick={() => setExpanded(true)} className="self-start">
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
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg">{t.pathLabel}</span>
          <input
            type="text"
            className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder={t.pathPlaceholder}
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg">{t.ttlLabel}</span>
            <select
              className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              value={ttlMs}
              onChange={(e) => setTtlMs(Number(e.target.value))}
            >
              {TTL_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.value}>
                  {t.ttlOptions[opt.key]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg">{t.maxViewsLabel}</span>
            <select
              className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-accent"
              value={maxViews ?? 'unlimited'}
              onChange={(e) =>
                setMaxViews(e.target.value === 'unlimited' ? null : Number(e.target.value))
              }
            >
              <option value="unlimited">{t.maxViewsUnlimited}</option>
              <option value="1">1</option>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-fg">{t.descriptionLabel}</span>
          <input
            type="text"
            className="rounded-lg border border-edge bg-surface-panel px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder={t.descriptionPlaceholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="flex items-center gap-2 pt-1">
          <Button type="button" disabled={creating || !path.trim()} onClick={() => void handleCreate()}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {creating ? t.creating : t.createButton}
          </Button>
          <Button type="button" variant="ghost" onClick={() => { resetForm(); setExpanded(false); }}>
            {t.cancel}
          </Button>
        </div>

        {errorMsg && <p className="text-sm text-red-600 dark:text-red-400">{errorMsg}</p>}
      </div>

      <ShareLinkDialog
        open={resultDialogOpen}
        onOpenChange={(open) => {
          setResultDialogOpen(open);
          if (!open) setResult(null);
        }}
        result={result}
      />
    </SettingsFormSection>
  );
}

// ── Share Row ─────────────────────────────────────────────────────────────────

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
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [extending, setExtending] = useState(false);

  const isActive = !share.expired && !share.revoked;
  const statusLabel = share.revoked ? t.statusRevoked : share.expired ? t.statusExpired : t.statusActive;
  const statusColor = share.revoked
    ? 'text-red-600 dark:text-red-400'
    : share.expired
      ? 'text-fg-subtle'
      : 'text-emerald-600 dark:text-emerald-400';

  const handleRevoke = useCallback(async () => {
    setRevokeOpen(false);
    setRevoking(true);
    try {
      await revokeShare(share.id);
      onRevoked();
    } catch {
      /* silent */
    } finally {
      setRevoking(false);
    }
  }, [share.id, onRevoked]);

  const handleCopy = useCallback(async () => {
    setLinksOpen((v) => !v);
  }, []);

  const handleExtend = useCallback(async () => {
    setExtending(true);
    try {
      await extendShare(share.id, 86_400_000);
      onExtended();
    } catch {
      /* silent */
    } finally {
      setExtending(false);
    }
  }, [share.id, onExtended]);

  return (
    <>
      <div className="rounded-lg border border-edge-subtle bg-surface-panel px-3 py-2.5">
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 size-4 shrink-0 text-fg-muted" />
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
                {t.views}: {share.viewCount}
                {share.maxViews !== null && ` ${t.viewsOf} ${share.maxViews}`}
              </span>
              {share.description && (
                <span className="italic text-fg-subtle">{share.description}</span>
              )}
            </div>
          </div>
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
                  {linksOpen ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
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
                  onClick={() => setRevokeOpen(true)}
                  disabled={revoking}
                >
                  {revoking ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                </Button>
              </>
            )}
          </div>
        </div>
        {isActive && linksOpen ? (
          <div className="mt-3 border-t border-edge-subtle pt-3 pl-7">
            <ShareUrlCopyRows
              shareUrl={share.shareUrl}
              lanUrl={share.lanUrl}
              reachability={share.reachability}
              compact
            />
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
        onCancel={() => setRevokeOpen(false)}
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
