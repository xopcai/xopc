import { File, FolderOpen, Puzzle, Settings, Sparkles, Terminal, Zap } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { buildAutomationActionHits } from '@/features/search/global-command-palette/actions-provider';
import type { GlobalHit } from '@/features/search/global-command-palette/types';
import { hitRank, sortHits } from '@/features/search/global-command-palette/rank';
import { buildRouteSeeds } from '@/features/search/global-command-palette/routes-provider';
import { buildQuickSettingHits } from '@/features/search/global-command-palette/settings-provider';
import { fetchCommandsCached, getSkillsCached } from '@/features/chat/command-palette-api';
import type { CommandEntry } from '@/features/chat/command-palette.types';
import { dispatchFillChatComposer } from '@/features/chat/fill-composer-dispatch';
import { searchWorkspaceFiles } from '@/features/chat/at-mention-api';
import { listSessions } from '@/features/sessions/session-api';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { useUiExtensions } from '@/features/extensions/extension-provider';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { fetchJson } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';
import { messages } from '@/i18n/messages';
import { useLocaleStore } from '@/stores/locale-store';
import { useWorkspacePreviewStore } from '@/stores/workspace-preview-store';
import { useWorkspaceEditorAgentStore } from '@/stores/workspace-editor-agent-store';

function useCurrentChatSessionKey(): string | undefined {
  const { pathname } = useLocation();
  const { sessionKey: sessionKeyParam } = useParams();
  if (!pathname.startsWith('/chat')) return undefined;
  if (!sessionKeyParam) return undefined;
  const sk = decodeURIComponent(sessionKeyParam);
  return sk && sk !== 'new' ? sk : undefined;
}

type PaletteRow = { id: string; title: string; subtitle?: string };

type PaletteState =
  | { phase: 'idle'; hits: GlobalHit[] }
  | { phase: 'loading'; hits: GlobalHit[] }
  | { phase: 'ready'; hits: GlobalHit[] }
  | { phase: 'error'; hits: GlobalHit[]; message: string };

type PaletteLayer = 'main' | 'models' | 'agents';

function groupOrder(label: string): number {
  switch (label) {
    case 'Navigate':
      return 0;
    case 'Quick Settings':
      return 1;
    case 'Extensions':
      return 2;
    case 'Sessions':
      return 3;
    case 'Files':
      return 4;
    case 'Commands':
      return 5;
    case 'Skills':
      return 6;
    case 'Actions':
      return 7;
    default:
      return 10;
  }
}

function iconFor(hit: GlobalHit) {
  switch (hit.kind) {
    case 'extension':
      return <Puzzle className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'route':
      return <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'session':
      return <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'file':
      return <File className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'command':
      return <Terminal className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'skill':
      return <Sparkles className="size-3.5 shrink-0 text-accent-fg" aria-hidden />;
    case 'setting':
      return <Settings className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'action':
      return <Zap className="size-3.5 shrink-0 text-accent-fg" aria-hidden />;
    default:
      return null;
  }
}

function wireTextForSlashCommand(c: CommandEntry): string {
  if (c.acceptsArgs) {
    return `/${c.name} `;
  }
  return `/${c.name}`;
}

function fillChatComposerWithNavigate(
  text: string,
  pathname: string,
  navigate: ReturnType<typeof useNavigate>,
  close: () => void,
) {
  close();
  if (pathname.startsWith('/chat')) {
    dispatchFillChatComposer(text);
    return;
  }
  navigate('/chat');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      dispatchFillChatComposer(text);
    });
  });
}

function buildExtensionHits(args: {
  query: string;
  navigate: ReturnType<typeof useNavigate>;
  close: () => void;
  uiExtensions: ReturnType<typeof useUiExtensions>;
}): Array<Omit<GlobalHit, 'rank'>> {
  const hits: Array<Omit<GlobalHit, 'rank'>> = [];
  for (const extension of args.uiExtensions) {
    const list = extension.ui?.contributions?.commands;
    if (!Array.isArray(list)) continue;
    for (const command of list) {
      if (!command || typeof command.id !== 'string' || typeof command.title !== 'string') continue;
      hits.push({
        kind: 'extension',
        id: `ext:${extension.id}:${command.id}`,
        title: command.title,
        subtitle: extension.name,
        groupLabel: 'Extensions',
        keywords: [extension.id, extension.name, command.id],
        run: () => {
          args.close();
          if (command.opensPanel !== undefined && command.opensPanel !== '') {
            args.navigate(`/apps/${encodeURIComponent(extension.id)}`);
          } else {
            window.dispatchEvent(
              new CustomEvent('extension-command', {
                detail: { extensionId: extension.id, commandId: command.id },
              }),
            );
          }
        },
      });
    }
  }
  return hits;
}

export function GlobalCommandPaletteHost() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const language = useLocaleStore((s) => s.language);
  const uiExtensions = useUiExtensions();
  const chatSessionKey = useCurrentChatSessionKey();
  const editorAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);
  const setPreviewPath = useWorkspacePreviewStore((s) => s.setPath);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<PaletteState>({ phase: 'idle', hits: [] });

  const [paletteLayer, setPaletteLayer] = useState<PaletteLayer>('main');
  const [modelRows, setModelRows] = useState<PaletteRow[]>([]);
  const [agentRows, setAgentRows] = useState<PaletteRow[]>([]);
  const [layerLoading, setLayerLoading] = useState(false);

  const routeSeeds = useMemo(() => buildRouteSeeds(language), [language]);

  const openModelPalette = useCallback(async () => {
    setPaletteLayer('models');
    setQuery('');
    setSelectedIndex(0);
    setLayerLoading(true);
    try {
      const data = await fetchJson<{
        payload?: {
          providers?: Array<{ models?: Array<{ ref: string; name: string; available?: boolean }> }>;
        };
      }>(apiUrl('/api/registry'));
      const rows: PaletteRow[] = [];
      for (const p of data.payload?.providers ?? []) {
        for (const m of p.models ?? []) {
          if (m.available === false) continue;
          rows.push({
            id: m.ref,
            title: m.name || m.ref,
            subtitle: m.ref,
          });
        }
      }
      rows.sort((a, b) => a.title.localeCompare(b.title));
      setModelRows(rows);
    } catch {
      setModelRows([]);
    } finally {
      setLayerLoading(false);
    }
  }, []);

  const openAgentPalette = useCallback(async () => {
    setPaletteLayer('agents');
    setQuery('');
    setSelectedIndex(0);
    setLayerLoading(true);
    try {
      const data = await fetchGatewayAgents();
      const agSettings = messages(language).agentsSettings;
      setAgentRows(
        data.agents.map((agent) => ({
          id: agent.id,
          title: agentListDisplayName(agent, agSettings),
          subtitle: agent.id,
        })),
      );
    } catch {
      setAgentRows([]);
    } finally {
      setLayerLoading(false);
    }
  }, [language]);

  const displayedLayerRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = paletteLayer === 'models' ? modelRows : paletteLayer === 'agents' ? agentRows : [];
    if (!q) return src;
    return src.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.subtitle?.toLowerCase().includes(q) ?? false),
    );
  }, [paletteLayer, modelRows, agentRows, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
    setPaletteLayer('main');
    setModelRows([]);
    setAgentRows([]);
    setState({ phase: 'idle', hits: [] });
    window.setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    setSelectedIndex((i) =>
      Math.min(i, Math.max(0, displayedLayerRows.length > 0 ? displayedLayerRows.length - 1 : 0)),
    );
  }, [displayedLayerRows.length, paletteLayer, query]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (!open) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        if (paletteLayer !== 'main') {
          setPaletteLayer('main');
          setQuery('');
          setSelectedIndex(0);
          return;
        }
        setOpen(false);
        return;
      }

      const maxIdx =
        paletteLayer === 'main'
          ? Math.max(0, state.hits.length - 1)
          : Math.max(0, displayedLayerRows.length);

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, maxIdx));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        if (paletteLayer === 'models') {
          if (selectedIndex === 0) {
            setPaletteLayer('main');
            setQuery('');
            return;
          }
          const row = displayedLayerRows[selectedIndex - 1];
          if (!row) return;
          void (async () => {
            await fetchJson(apiUrl('/api/config'), {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agents: { defaults: { model: row.id } } }),
            });
            void revalidateGatewayConfig();
            window.dispatchEvent(new CustomEvent('config-reload'));
            setOpen(false);
            setPaletteLayer('main');
          })();
          return;
        }
        if (paletteLayer === 'agents') {
          if (selectedIndex === 0) {
            setPaletteLayer('main');
            setQuery('');
            return;
          }
          const row = displayedLayerRows[selectedIndex - 1];
          if (!row) return;
          window.dispatchEvent(new CustomEvent('xopc-set-chat-agent', { detail: { agentId: row.id } }));
          setOpen(false);
          setPaletteLayer('main');
          return;
        }
        const item = state.hits[selectedIndex];
        if (item) {
          item.run();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, selectedIndex, state.hits, paletteLayer, displayedLayerRows, layerLoading]);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener('open-command-palette', handler);
    return () => window.removeEventListener('open-command-palette', handler);
  }, []);

  useEffect(() => {
    const handler = () => setOpen((p) => !p);
    window.addEventListener('toggle-command-palette', handler);
    return () => window.removeEventListener('toggle-command-palette', handler);
  }, []);

  useEffect(() => {
    if (!open || paletteLayer !== 'main') return;

    const q = query.trim();
    const rid = ++requestIdRef.current;
    let cancelled = false;

    const debounce = window.setTimeout(() => {
      void (async () => {
        try {
          setState((prev) => ({ phase: 'loading', hits: prev.hits }));

          const close = () => setOpen(false);

          const routeHits: Array<Omit<GlobalHit, 'rank'>> = routeSeeds.map((r) => ({
            kind: 'route',
            id: r.id,
            title: r.title,
            subtitle: r.subtitle,
            groupLabel: 'Navigate',
            keywords: [...(r.keywords ?? []), r.path],
            run: () => {
              close();
              navigate(r.path);
            },
          }));

          const quickHits = buildQuickSettingHits(language, {
            closePalette: close,
            openModelPalette,
            openAgentPalette,
          });

          const actionHits = buildAutomationActionHits(language, navigate, close);

          const extensionHits = buildExtensionHits({ query: q, close, navigate, uiExtensions });

          const [commands, skillsPayload, sessions, files] = await Promise.all([
            fetchCommandsCached(),
            getSkillsCached(),
            listSessions({ search: q || undefined, limit: 8, offset: 0 }).catch(() => ({ items: [] })),
            (async () => {
              const sk = chatSessionKey?.trim();
              const aid = editorAgentId.trim();
              if (!sk && !aid) return [];
              const items = await searchWorkspaceFiles(q, {
                sessionKey: sk || undefined,
                agentId: sk ? undefined : aid || undefined,
                limit: 10,
              }).catch(() => []);
              return items;
            })(),
          ]);

          const commandHits: Array<Omit<GlobalHit, 'rank'>> = commands.map((c) => ({
            kind: 'command',
            id: `cmd:${c.id}`,
            title: `/${c.name}`,
            subtitle: c.description,
            groupLabel: 'Commands',
            keywords: [c.id, ...(c.aliases ?? []), c.category ?? ''],
            run: () => {
              fillChatComposerWithNavigate(wireTextForSlashCommand(c), pathname, navigate, close);
            },
          }));

          const skillHits: Array<Omit<GlobalHit, 'rank'>> = skillsPayload.catalog
            .filter((s) => s.enabled && !s.disableModelInvocation)
            .map((s) => ({
              kind: 'skill',
              id: `skill:${s.name}`,
              title: `/skill:${s.name}`,
              subtitle: s.description,
              groupLabel: 'Skills',
              keywords: [s.source ?? '', 'skill'],
              run: () => {
                const text = `/skill:${s.name} `;
                fillChatComposerWithNavigate(text, pathname, navigate, close);
              },
            }));

          const sessionHits: Array<Omit<GlobalHit, 'rank'>> = (sessions.items ?? []).map((s) => ({
            kind: 'session',
            id: `session:${s.key}`,
            title: s.name?.trim() || s.key,
            subtitle: s.key,
            groupLabel: 'Sessions',
            keywords: [s.key, ...(s.tags ?? []), s.sourceChannel ?? ''],
            run: () => {
              close();
              navigate(`/chat/${encodeURIComponent(s.key)}`);
            },
          }));

          const fileHits: Array<Omit<GlobalHit, 'rank'>> = files
            .filter((f) => !f.isDirectory)
            .map((f) => ({
              kind: 'file',
              id: `file:${f.relativePath}`,
              title: f.name,
              subtitle: f.relativePath,
              groupLabel: 'Files',
              keywords: [f.relativePath],
              run: () => {
                close();
                const rel = f.relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
                const openPreview = () => setPreviewPath(rel);
                if (pathname.startsWith('/chat')) {
                  openPreview();
                  return;
                }
                navigate('/chat');
                window.setTimeout(() => openPreview(), 0);
              },
            }));

          const seeds: Array<Omit<GlobalHit, 'rank'>> = [
            ...routeHits,
            ...quickHits,
            ...actionHits,
            ...extensionHits,
            ...sessionHits,
            ...fileHits,
            ...commandHits,
            ...skillHits,
          ];

          const ranked: GlobalHit[] = [];
          for (const s of seeds) {
            const r = hitRank(s, q);
            if (r === null) continue;
            ranked.push({ ...s, rank: r });
          }

          const caps: Record<string, number> = {
            Navigate: 12,
            'Quick Settings': 12,
            Actions: 8,
            Extensions: 8,
            Sessions: 8,
            Files: 10,
            Commands: 6,
            Skills: 6,
          };
          const sorted = sortHits(ranked);
          const grouped: GlobalHit[] = [];
          const seen: Record<string, number> = {};
          for (const h of sorted) {
            const n = (seen[h.groupLabel] ?? 0) + 1;
            if (n > (caps[h.groupLabel] ?? 6)) continue;
            seen[h.groupLabel] = n;
            grouped.push(h);
            if (grouped.length >= 36) break;
          }
          grouped.sort(
            (a, b) =>
              groupOrder(a.groupLabel) - groupOrder(b.groupLabel) ||
              a.rank - b.rank ||
              a.title.localeCompare(b.title),
          );

          if (cancelled || rid !== requestIdRef.current) return;
          setState({ phase: 'ready', hits: grouped });
          setSelectedIndex((i) => Math.min(i, Math.max(0, grouped.length - 1)));
        } catch (e) {
          if (cancelled || rid !== requestIdRef.current) return;
          setState({
            phase: 'error',
            hits: [],
            message: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      window.clearTimeout(debounce);
    };
  }, [
    open,
    query,
    routeSeeds,
    uiExtensions,
    navigate,
    chatSessionKey,
    editorAgentId,
    pathname,
    setPreviewPath,
    language,
    openModelPalette,
    openAgentPalette,
    paletteLayer,
  ]);

  useLayoutEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const btn = list.querySelector<HTMLElement>(`[data-global-palette-index="${String(selectedIndex)}"]`);
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [open, selectedIndex, state.hits, paletteLayer, displayedLayerRows.length]);

  if (!open) return null;

  const hits = state.hits;
  const subBackLabel = language === 'zh' ? '返回' : 'Back';

  if (paletteLayer === 'models' || paletteLayer === 'agents') {
    const rows = displayedLayerRows;
    return (
      <div
        className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[min(18vh,7rem)]"
        role="dialog"
        aria-modal="true"
        aria-label={language === 'zh' ? '选择模型或智能体' : 'Model or agent picker'}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              paletteLayer === 'models'
                ? language === 'zh'
                  ? '搜索模型…'
                  : 'Search models…'
                : language === 'zh'
                  ? '搜索智能体…'
                  : 'Search agents…'
            }
            className="border-b border-edge bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-muted"
            autoComplete="off"
            autoCorrect="off"
          />
          <ul
            ref={listRef}
            className="max-h-[min(60vh,26rem)] overflow-y-auto p-2 text-sm [scrollbar-gutter:stable]"
            role="listbox"
          >
            <li>
              <button
                type="button"
                data-global-palette-index={0}
                className={[
                  'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-fg-muted',
                  selectedIndex === 0 ? 'bg-surface-hover' : 'hover:bg-surface-muted',
                ].join(' ')}
                onMouseEnter={() => setSelectedIndex(0)}
                onClick={() => {
                  setPaletteLayer('main');
                  setQuery('');
                  setSelectedIndex(0);
                }}
              >
                ← {subBackLabel}
              </button>
            </li>
            {layerLoading ? (
              <li className="rounded-lg px-3 py-6 text-center text-fg-muted">
                {language === 'zh' ? '加载中…' : 'Loading…'}
              </li>
            ) : rows.length === 0 ? (
              <li className="rounded-lg px-3 py-6 text-center text-fg-muted">
                {language === 'zh' ? '无结果' : 'No results'}
              </li>
            ) : (
              rows.map((row, i) => {
                const idx = i + 1;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      data-global-palette-index={idx}
                      className={[
                        'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left',
                        selectedIndex === idx ? 'bg-surface-hover text-fg' : 'text-fg hover:bg-surface-muted',
                      ].join(' ')}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onClick={() => {
                        if (paletteLayer === 'models') {
                          void (async () => {
                            await fetchJson(apiUrl('/api/config'), {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ agents: { defaults: { model: row.id } } }),
                            });
                            void revalidateGatewayConfig();
                            window.dispatchEvent(new CustomEvent('config-reload'));
                            setOpen(false);
                            setPaletteLayer('main');
                          })();
                        } else {
                          window.dispatchEvent(
                            new CustomEvent('xopc-set-chat-agent', { detail: { agentId: row.id } }),
                          );
                          setOpen(false);
                          setPaletteLayer('main');
                        }
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <div className="min-w-0 truncate font-medium">{row.title}</div>
                        {row.subtitle ? (
                          <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{row.subtitle}</div>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>
    );
  }

  let lastGroup = '';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[min(18vh,7rem)]"
      role="dialog"
      aria-modal="true"
      aria-label="Global search"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            language === 'zh' ? '搜索…（会话 / 文件 / 设置 / 命令）' : 'Search… (sessions, files, settings, commands)'
          }
          className="border-b border-edge bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-fg-muted"
          autoComplete="off"
          autoCorrect="off"
        />
        <ul
          ref={listRef}
          className="max-h-[min(60vh,26rem)] overflow-y-auto p-2 text-sm [scrollbar-gutter:stable]"
          role="listbox"
          aria-activedescendant={
            hits[selectedIndex] ? `global-hit-${hits[selectedIndex].id}` : undefined
          }
        >
          {hits.length === 0 ? (
            <li className="rounded-lg px-3 py-6 text-center text-fg-muted">
              {state.phase === 'loading'
                ? language === 'zh'
                  ? '搜索中…'
                  : 'Searching…'
                : state.phase === 'error'
                  ? state.message
                  : language === 'zh'
                    ? '无结果'
                    : 'No results'}
            </li>
          ) : (
            hits.map((h, idx) => {
              const header = h.groupLabel !== lastGroup ? h.groupLabel : '';
              lastGroup = h.groupLabel;
              return (
                <li key={h.id}>
                  {header ? (
                    <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                      {header}
                    </div>
                  ) : null}
                  <button
                    id={`global-hit-${h.id}`}
                    data-global-palette-index={idx}
                    type="button"
                    className={[
                      'flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left',
                      idx === selectedIndex ? 'bg-surface-hover text-fg' : 'text-fg hover:bg-surface-muted',
                    ].join(' ')}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => h.run()}
                  >
                    <span className="mt-0.5">{iconFor(h)}</span>
                    <span className="min-w-0 flex-1">
                      <div className="min-w-0 truncate font-medium">{h.title}</div>
                      {h.subtitle ? (
                        <div className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{h.subtitle}</div>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}
