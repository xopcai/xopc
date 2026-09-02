import { File, FolderKanban, FolderOpen, Puzzle, Settings, Sparkles, Terminal, Zap } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { useDebounce } from 'use-debounce';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import { buildAutomationActionHits } from '@/features/search/global-command-palette/actions-provider';
import { buildDesktopMenuActionHits } from '@/features/search/global-command-palette/desktop-menu-provider';
import {
  commandPaletteGroupCaps,
  commandPaletteGroupSortKey,
} from '@/features/search/global-command-palette/command-palette-groups';
import type { GlobalHit } from '@/features/search/global-command-palette/types';
import { hitRank, sortHits } from '@/features/search/global-command-palette/rank';
import { buildRouteSeeds } from '@/features/search/global-command-palette/routes-provider';
import { searchGlobal } from '@/features/search/global-command-palette/search-api';
import { buildQuickSettingHits } from '@/features/search/global-command-palette/settings-provider';
import { buildSettingsFieldHits } from '@/features/search/global-command-palette/settings-fields-provider';
import { fetchCommandsCached, getSkillsCached } from '@/features/chat/palette/command-palette-api';
import { dispatchFillChatComposer } from '@/features/chat/composer/fill-composer-dispatch';
import { wireTextForSlashCommandEntry } from '@/features/chat/palette/slash-command-wire-text';
import { rememberSelectedAgent } from '@/features/chat/session/new-session-preferences';
import { searchWorkspaceFiles } from '@/features/chat/palette/at-mention-api';
import { listSessions } from '@/features/sessions/session-api';
import { fetchGatewayAgents } from '@/features/settings/agents-admin-api';
import { agentListDisplayName } from '@/features/settings/agents/agent-display-names';
import { fetchGlobalDefaults, updateGlobalDefaults } from '@/features/settings/global-defaults-api';
import { useUiExtensions } from '@/features/extensions/extension-provider';
import { revalidateGatewayConfig } from '@/features/gateway/gateway-config-swr';
import { dispatchConfigReload } from '@/features/gateway/dispatch-config-reload';
import { fetchJson } from '@/lib/fetch';
import { useAsyncResource } from '@/lib/use-async-resource';
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

type PaletteLayer = 'main' | 'models' | 'agents';

async function setGlobalDefaultModel(modelRef: string): Promise<void> {
  const { defaults } = await fetchGlobalDefaults();
  await updateGlobalDefaults({
    ...defaults,
    models: {
      ...defaults.models,
      chat: { primary: modelRef, fallbacks: [] },
    },
  });
}

function selectChatAgentFromPalette(
  agentId: string,
  pathname: string,
  navigate: ReturnType<typeof useNavigate>,
  close: () => void,
) {
  const next = agentId.trim().toLowerCase();
  if (!next) return;
  rememberSelectedAgent(next);
  if (pathname.startsWith('/chat')) {
    window.dispatchEvent(new CustomEvent('xopc-set-chat-agent', { detail: { agentId: next } }));
  } else {
    navigate('/chat/new?projectScope=none', { state: { agentId: next } });
  }
  close();
}

function iconFor(hit: GlobalHit) {
  switch (hit.kind) {
    case 'extension':
      return <Puzzle className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'route':
      return <FolderOpen className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
    case 'project':
      return <FolderKanban className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />;
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

  // Not on a chat page — navigate to /chat/new with query params so the
  // ChatPage `?skill=` / `?slash=` consumption logic fills the composer
  // after the session is created (event dispatch is unreliable here because
  // the composer hasn't mounted yet).
  const skillMatch = text.match(/^\/skill:(\S+)\s*$/);
  const slashMatch = text.match(/^\/(\S+)\s*$/);
  if (skillMatch) {
    navigate(`/chat/new?skill=${encodeURIComponent(skillMatch[1])}`);
  } else if (slashMatch) {
    navigate(`/chat/new?slash=${encodeURIComponent(slashMatch[1])}`);
  } else {
    navigate('/chat/new');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        dispatchFillChatComposer(text);
      });
    });
  }
}

function buildExtensionHits(args: {
  query: string;
  navigate: ReturnType<typeof useNavigate>;
  close: () => void;
  uiExtensions: ReturnType<typeof useUiExtensions>;
  extensionsGroupLabel: string;
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
        groupLabel: args.extensionsGroupLabel,
        keywords: [extension.id, extension.name, command.id],
        run: () => {
          args.close();
          if (command.opensPanel !== undefined && command.opensPanel !== '') {
            args.navigate(`/extensions/${encodeURIComponent(extension.id)}`);
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

type PaletteUiState = {
  query: string;
  selectedIndex: number;
  paletteLayer: PaletteLayer;
};

type PaletteUiAction =
  | { type: 'setQuery'; value: string }
  | { type: 'setSelectedIndex'; value: number | ((prev: number) => number) }
  | { type: 'setLayer'; layer: PaletteLayer }
  | { type: 'resetMain' };

function paletteUiReducer(state: PaletteUiState, action: PaletteUiAction): PaletteUiState {
  switch (action.type) {
    case 'setQuery':
      return { ...state, query: action.value };
    case 'setSelectedIndex': {
      const next =
        typeof action.value === 'function' ? action.value(state.selectedIndex) : action.value;
      return { ...state, selectedIndex: next };
    }
    case 'setLayer':
      return { ...state, paletteLayer: action.layer, query: '', selectedIndex: 0 };
    case 'resetMain':
      return { query: '', selectedIndex: 0, paletteLayer: 'main' };
  }
}

const initialPaletteUi: PaletteUiState = {
  query: '',
  selectedIndex: 0,
  paletteLayer: 'main',
};

async function fetchModelPaletteRows(): Promise<PaletteRow[]> {
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
  return rows;
}

async function fetchAgentPaletteRows(language: string): Promise<PaletteRow[]> {
  const data = await fetchGatewayAgents();
  const agSettings = messages(language as 'en' | 'zh').agentsSettings;
  return data.agents.map((agent) => ({
    id: agent.id,
    title: agentListDisplayName(agent, agSettings),
    subtitle: agent.id,
  }));
}

function GlobalCommandPalettePanel({ onClose }: { onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const language = useLocaleStore((s) => s.language);
  const uiExtensions = useUiExtensions();
  const chatSessionKey = useCurrentChatSessionKey();
  const editorAgentId = useWorkspaceEditorAgentStore((s) => s.agentId);
  const setPreviewPath = useWorkspacePreviewStore((s) => s.setPath);

  const [ui, dispatchUi] = useReducer(paletteUiReducer, initialPaletteUi);
  const [skillsVersion, setSkillsVersion] = useState(0);
  const { query, selectedIndex, paletteLayer } = ui;

  const routeSeeds = useMemo(() => buildRouteSeeds(language), [language]);
  const [debouncedQuery] = useDebounce(query, 120);

  useEffect(() => {
    const onConfigReload = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (
        detail &&
        typeof detail === 'object' &&
        'section' in detail &&
        (detail as { section?: unknown }).section === 'skills'
      ) {
        setSkillsVersion((v) => v + 1);
      }
    };
    window.addEventListener('config-reload', onConfigReload);
    return () => window.removeEventListener('config-reload', onConfigReload);
  }, []);

  const openModelPalette = useCallback(() => {
    dispatchUi({ type: 'setLayer', layer: 'models' });
  }, []);

  const openAgentPalette = useCallback(() => {
    dispatchUi({ type: 'setLayer', layer: 'agents' });
  }, []);

  const layerRowsResource = useAsyncResource(
    async () => {
      if (paletteLayer === 'models') return fetchModelPaletteRows();
      if (paletteLayer === 'agents') return fetchAgentPaletteRows(language);
      return [] as PaletteRow[];
    },
    [paletteLayer, language],
    {
      enabled: paletteLayer === 'models' || paletteLayer === 'agents',
      initial: [] as PaletteRow[],
      errorData: [] as PaletteRow[],
    },
  );

  const hitsResource = useAsyncResource(
    async () => {
      const q = debouncedQuery.trim();
      const close = onClose;
      const groups = messages(language).commandPalette.groups;

      const routeHits: Array<Omit<GlobalHit, 'rank'>> = routeSeeds.map((r) => ({
        kind: 'route',
        id: r.id,
        title: r.title,
        subtitle: r.subtitle,
        groupLabel: groups.navigate,
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

      const extensionHits = buildExtensionHits({
        query: q,
        close,
        navigate,
        uiExtensions,
        extensionsGroupLabel: groups.extensions,
      });

      const [commands, skillsPayload, globalSearchHits, sessions, files, desktopMenuActionHits] = await Promise.all([
        fetchCommandsCached(),
        getSkillsCached(),
        q ? searchGlobal(q, { types: ['project'], limit: 8 }).catch(() => []) : [],
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
        buildDesktopMenuActionHits(language, close),
      ]);

      const projectHits: Array<Omit<GlobalHit, 'rank'>> = globalSearchHits.map((h) => ({
        kind: 'project',
        id: h.id,
        title: h.title,
        subtitle: h.subtitle,
        groupLabel: groups.projects,
        keywords: [
          h.payload.project.slug,
          h.payload.project.workspaceRoot ?? '',
          h.payload.project.defaultAgentId ?? '',
          h.payload.project.brief ?? '',
        ],
        run: () => {
          close();
          navigate(h.href);
        },
      }));

      const commandHits: Array<Omit<GlobalHit, 'rank'>> = commands.map((c) => ({
        kind: 'command',
        id: `cmd:${c.id}`,
        title: `/${c.name}`,
        subtitle: c.description,
        groupLabel: groups.commands,
        keywords: [c.id, ...(c.aliases ?? []), c.category ?? ''],
        run: () => {
          fillChatComposerWithNavigate(wireTextForSlashCommandEntry(c), pathname, navigate, close);
        },
      }));

      const skillHits: Array<Omit<GlobalHit, 'rank'>> = skillsPayload.catalog.flatMap((s) => {
        if (!s.enabled || s.disableModelInvocation) return [];
        return [
          {
            kind: 'skill',
            id: `skill:${s.name}`,
            title: `/skill:${s.name}`,
            subtitle: s.description,
            groupLabel: groups.skills,
            keywords: [s.source ?? '', 'skill'],
            run: () => {
              const text = `/skill:${s.name} `;
              fillChatComposerWithNavigate(text, pathname, navigate, close);
            },
          },
        ];
      });

      const sessionHits: Array<Omit<GlobalHit, 'rank'>> = (sessions.items ?? []).map((s) => ({
        kind: 'session',
        id: `session:${s.key}`,
        title: s.name?.trim() || s.key,
        subtitle: s.key,
        groupLabel: groups.sessions,
        keywords: [s.key, ...(s.tags ?? []), s.sourceChannel ?? ''],
        run: () => {
          close();
          navigate(`/chat/${encodeURIComponent(s.key)}`);
        },
      }));

      const fileHits: Array<Omit<GlobalHit, 'rank'>> = files.flatMap((f) => {
        if (f.isDirectory) return [];
        return [
          {
            kind: 'file',
            id: `file:${f.relativePath}`,
            title: f.name,
            subtitle: f.relativePath,
            groupLabel: groups.files,
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
          },
        ];
      });

      const settingsFieldHits = buildSettingsFieldHits(language, navigate, close, groups.navigate);

      const seeds: Array<Omit<GlobalHit, 'rank'>> = [
        ...routeHits,
        ...quickHits,
        ...actionHits,
        ...desktopMenuActionHits,
        ...extensionHits,
        ...settingsFieldHits,
        ...projectHits,
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

      const caps = commandPaletteGroupCaps(language);
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
          commandPaletteGroupSortKey(language, a.groupLabel) -
            commandPaletteGroupSortKey(language, b.groupLabel) ||
          a.rank - b.rank ||
          a.title.localeCompare(b.title),
      );
      return grouped;
    },
    [
      debouncedQuery,
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
      onClose,
      skillsVersion,
    ],
    {
      enabled: paletteLayer === 'main',
      initial: [] as GlobalHit[],
      errorData: [] as GlobalHit[],
    },
  );

  const hits = hitsResource.data;
  const hitsLoading = hitsResource.loading;
  const hitsError = hitsResource.error;

  const displayedLayerRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const src = layerRowsResource.data;
    if (!q) return src;
    return src.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.subtitle?.toLowerCase().includes(q) ?? false),
    );
  }, [layerRowsResource.data, query]);

  const clampKey = `${paletteLayer}|${query}|${String(displayedLayerRows.length)}|${String(hits.length)}`;
  const trackedClampKeyRef = useRef(clampKey);
  if (trackedClampKeyRef.current !== clampKey) {
    trackedClampKeyRef.current = clampKey;
    const max =
      paletteLayer === 'main'
        ? Math.max(0, hits.length - 1)
        : Math.max(0, displayedLayerRows.length);
    if (selectedIndex > max) {
      dispatchUi({ type: 'setSelectedIndex', value: max });
    }
  }

  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(id);
  }, []);

  const handlePaletteKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (paletteLayer !== 'main') {
        dispatchUi({ type: 'resetMain' });
        return;
      }
      onClose();
      return;
    }

    const maxIdx =
      paletteLayer === 'main'
        ? Math.max(0, hits.length - 1)
        : Math.max(0, displayedLayerRows.length);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      dispatchUi({ type: 'setSelectedIndex', value: (i) => Math.min(i + 1, maxIdx) });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      dispatchUi({ type: 'setSelectedIndex', value: (i) => Math.max(0, i - 1) });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (paletteLayer === 'models') {
        if (selectedIndex === 0) {
          dispatchUi({ type: 'resetMain' });
          return;
        }
        const row = displayedLayerRows[selectedIndex - 1];
        if (!row) return;
        void (async () => {
          await setGlobalDefaultModel(row.id);
          void revalidateGatewayConfig();
          dispatchConfigReload();
          onClose();
          dispatchUi({ type: 'resetMain' });
        })();
        return;
      }
      if (paletteLayer === 'agents') {
        if (selectedIndex === 0) {
          dispatchUi({ type: 'resetMain' });
          return;
        }
        const row = displayedLayerRows[selectedIndex - 1];
        if (!row) return;
        selectChatAgentFromPalette(row.id, pathname, navigate, onClose);
        dispatchUi({ type: 'resetMain' });
        return;
      }
      const item = hits[selectedIndex];
      if (item) {
        item.run();
      }
    }
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      handlePaletteKey(event);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const btn = list.querySelector<HTMLElement>(`[data-global-palette-index="${String(selectedIndex)}"]`);
    btn?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedIndex, hits, paletteLayer, displayedLayerRows.length]);

  const subBackLabel = language === 'zh' ? '返回' : 'Back';

  if (paletteLayer === 'models' || paletteLayer === 'agents') {
    const rows = displayedLayerRows;
    const layerLoading = layerRowsResource.loading;
    return (
      <div
        className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 p-4 pt-[min(18vh,7rem)]"
        role="dialog"
        aria-modal="true"
        aria-label={language === 'zh' ? '选择模型或智能体' : 'Model or agent picker'}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => dispatchUi({ type: 'setQuery', value: e.target.value })}
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
                onMouseEnter={() => dispatchUi({ type: 'setSelectedIndex', value: 0 })}
                onClick={() => dispatchUi({ type: 'resetMain' })}
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
                      onMouseEnter={() => dispatchUi({ type: 'setSelectedIndex', value: idx })}
                      onClick={() => {
                        if (paletteLayer === 'models') {
                          void (async () => {
                            await setGlobalDefaultModel(row.id);
                            void revalidateGatewayConfig();
                            dispatchConfigReload();
                            onClose();
                            dispatchUi({ type: 'resetMain' });
                          })();
                        } else {
                          selectChatAgentFromPalette(row.id, pathname, navigate, onClose);
                          dispatchUi({ type: 'resetMain' });
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
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-edge bg-surface-panel shadow-elevated">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => dispatchUi({ type: 'setQuery', value: e.target.value })}
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
              {hitsLoading
                ? language === 'zh'
                  ? '搜索中…'
                  : 'Searching…'
                : hitsError
                  ? hitsError instanceof Error
                    ? hitsError.message
                    : String(hitsError)
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
                    onMouseEnter={() => dispatchUi({ type: 'setSelectedIndex', value: idx })}
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

export function GlobalCommandPaletteHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

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

  if (!open) return null;

  return <GlobalCommandPalettePanel onClose={() => setOpen(false)} />;
}
