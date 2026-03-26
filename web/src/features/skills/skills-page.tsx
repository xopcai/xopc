import * as Dialog from '@radix-ui/react-dialog';
import { Layers, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { interaction } from '@/lib/interaction';
import {
  deleteSkill,
  getSkills,
  reloadSkills,
  uploadSkillZip,
} from '@/features/skills/skill-api';
import type { SkillCatalogEntry } from '@/features/skills/skill.types';
import { messages } from '@/i18n/messages';
import { useGatewayStore } from '@/stores/gateway-store';
import { useLocaleStore } from '@/stores/locale-store';

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? ''));
}

export function SkillsPage() {
  const language = useLocaleStore((s) => s.language);
  const m = messages(language);
  const sk = m.skills;
  const token = useGatewayStore((st) => st.token);
  const hasToken = Boolean(token);

  const [catalog, setCatalog] = useState<SkillCatalogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<{ ok: true } | { ok: false; message: string }> => {
    setLoading(true);
    setError(null);
    try {
      const data = await getSkills();
      setCatalog(data.catalog);
      return { ok: true };
    } catch (e) {
      const message = e instanceof Error ? e.message : sk.loadFailed;
      setError(message);
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, [sk.loadFailed]);

  useEffect(() => {
    if (!hasToken) return;
    void load();
  }, [hasToken, load]);

  const showFeedback = useCallback((kind: 'success' | 'error', message: string, durationMs = 5000) => {
    setActionFeedback({ kind, message });
    window.setTimeout(() => setActionFeedback(null), durationMs);
  }, []);

  const onRefreshClick = async () => {
    setActionFeedback(null);
    const result = await load();
    if (result.ok) {
      showFeedback('success', sk.refreshSuccess);
    } else {
      showFeedback('error', result.message);
    }
  };

  const onReloadClick = async () => {
    setActionFeedback(null);
    setLoading(true);
    setError(null);
    try {
      await reloadSkills();
    } catch (e) {
      const msg = e instanceof Error ? e.message : sk.reloadFailed;
      setError(msg);
      showFeedback('error', msg);
      setLoading(false);
      return;
    }
    const result = await load();
    if (result.ok) {
      showFeedback('success', sk.reloadSuccess);
    } else {
      showFeedback('error', result.message);
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((row) => {
      const blob = [row.name, row.description, row.directoryId, row.path, row.source]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [catalog, searchQuery]);

  const uploadZipFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError(sk.zipOnly);
      return;
    }
    setActionFeedback(null);
    setUploading(true);
    setError(null);
    try {
      await uploadSkillZip(file, { overwrite: true });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : sk.uploadFailed);
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void uploadZipFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes('Files')) {
      setDropActive(true);
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDragLeave = (e: React.DragEvent) => {
    const root = e.currentTarget as HTMLElement;
    const to = e.relatedTarget as Node | null;
    if (to && root.contains(to)) return;
    setDropActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) void uploadZipFile(file);
  };

  const sourceLabel = (source: SkillCatalogEntry['source']): string => {
    switch (source) {
      case 'builtin':
        return sk.source.builtin;
      case 'workspace':
        return sk.source.workspace;
      case 'global':
        return sk.source.global;
      default:
        return source;
    }
  };

  const runDelete = async () => {
    const id = confirmId;
    setConfirmOpen(false);
    setConfirmId(null);
    if (!id) return;
    setActionFeedback(null);
    try {
      await deleteSkill(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : sk.deleteFailed);
    }
  };

  if (!hasToken) {
    return (
      <div className="mx-auto w-full max-w-app-main px-4 py-16 text-center text-sm text-fg-muted sm:px-8">
        {sk.needToken}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-surface-panel">
      <div className="mx-auto flex w-full max-w-app-main flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-fg">
            <Layers className="size-5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden />
            {sk.title}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void onRefreshClick()}
            >
              <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
              {sk.refresh}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={loading}
              onClick={() => void onReloadClick()}
            >
              {sk.reloadRuntime}
            </Button>
          </div>
        </header>

        <p className="text-sm leading-relaxed text-fg-muted">{sk.hint}</p>

        {actionFeedback ? (
          <div
            role="status"
            aria-live="polite"
            className={cn(
              'rounded-lg border px-3 py-2 text-sm',
              actionFeedback.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200',
            )}
          >
            {actionFeedback.message}
          </div>
        ) : error ? (
          <div className="rounded-lg border border-edge bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-edge dark:bg-red-950/40 dark:text-red-300" role="alert">
            {error}
          </div>
        ) : null}

        <section
          className={cn(
            'rounded-2xl bg-surface-base p-6 transition-colors dark:bg-surface-hover/30',
            dropActive && 'bg-accent-soft/40 dark:bg-accent-soft/25',
          )}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <label className="flex cursor-pointer flex-col gap-2">
            <input
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={uploading}
              aria-label={sk.dropHint}
              onChange={onFileChange}
            />
            <span className="text-sm font-medium text-fg">{sk.uploadSection}</span>
            <span className="text-sm text-fg-muted">{sk.dropHint}</span>
            {uploading ? <span className="text-sm text-fg-muted">{sk.uploading}</span> : null}
          </label>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-medium text-fg">{sk.tableTitle}</h2>
            <div className="flex w-full min-w-0 items-center gap-2 rounded-xl bg-surface-base px-3 py-2 transition-colors focus-within:ring-2 focus-within:ring-accent/35 sm:max-w-md dark:bg-surface-hover/40">
              <Search className="size-4 shrink-0 text-fg-disabled" strokeWidth={1.75} aria-hidden />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={sk.searchPlaceholder}
                autoComplete="off"
                className="min-w-0 flex-1 border-0 bg-transparent text-sm text-fg placeholder:text-fg-disabled focus:outline-none focus:ring-0"
              />
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center text-sm text-fg-muted">{sk.loading}</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl bg-surface-base dark:bg-surface-hover/25">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-edge bg-surface-hover/50 dark:border-edge">
                    <th className="px-4 py-3 font-medium text-fg">{sk.col.name}</th>
                    <th className="px-4 py-3 font-medium text-fg">{sk.col.description}</th>
                    <th className="px-4 py-3 font-medium text-fg">{sk.col.source}</th>
                    <th className="px-4 py-3 font-medium text-fg">{sk.col.managed}</th>
                    <th className="px-4 py-3 font-medium text-fg">{sk.col.actions}</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-fg-muted">
                        {sk.empty}
                      </td>
                    </tr>
                  ) : filteredCatalog.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center text-fg-muted">
                        {sk.noSearchResults}
                      </td>
                    </tr>
                  ) : (
                    filteredCatalog.map((row) => (
                      <tr key={row.directoryId} className="border-b border-edge last:border-0 dark:border-edge">
                        <td className="px-4 py-3 font-medium text-fg">{row.name}</td>
                        <td className="max-w-xs truncate px-4 py-3 text-fg-muted" title={row.description || undefined}>
                          {row.description || '—'}
                        </td>
                        <td className="px-4 py-3 text-fg-muted">{sourceLabel(row.source)}</td>
                        <td className="px-4 py-3 text-fg-muted">{row.managed ? sk.yes : sk.no}</td>
                        <td className="px-4 py-3">
                          {row.managed ? (
                            <button
                              type="button"
                              className={cn(
                                'rounded-md px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
                                interaction.transition,
                                interaction.press,
                                interaction.focusRingPanel,
                              )}
                              aria-label={sk.delete}
                              onClick={() => {
                                setConfirmId(row.directoryId);
                                setConfirmOpen(true);
                              }}
                            >
                              {sk.delete}
                            </button>
                          ) : (
                            <span className="text-fg-disabled">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setConfirmId(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="xopcbot-dialog-overlay fixed inset-0 z-[60] bg-scrim" />
          <Dialog.Content className="xopcbot-dialog-content fixed left-1/2 top-1/2 z-[60] w-[min(100%-2rem,24rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-edge bg-surface-panel p-4 shadow-xl dark:border-edge">
            <Dialog.Title className="text-base font-semibold text-fg">{sk.deleteTitle}</Dialog.Title>
            <p className="mt-2 text-sm text-fg-muted">
              {confirmId ? interpolate(sk.deleteMessage, { id: confirmId }) : ''}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)}>
                {sk.cancel}
              </Button>
              <Button type="button" variant="primary" className="bg-red-600 hover:bg-red-700" onClick={() => void runDelete()}>
                {sk.deleteConfirm}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
