import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDebounce } from 'use-debounce';

import {
  atMentionProviders,
  fetchWorkspaceBrowseEntries,
  type AtMentionFileItem,
  type AtMentionItem,
  type AtMentionItemKind,
} from '@/features/chat/palette/at-mention-api';
import { getRecentAtPaths } from '@/features/chat/palette/at-mention-recent';
import { useLocaleStore } from '@/stores/locale-store';

const DEBOUNCE_MS = 150;
const PROVIDER_ORDER: readonly AtMentionItemKind[] = [
  'file', 'note', 'session', 'browser_tab', 'skill', 'agent', 'mcp_server', 'mcp_resource',
];

export interface AtRange {
  start: number;
  end: number;
  query: string;
}

export interface AtMentionSection {
  kind: AtMentionItemKind;
  items: AtMentionItem[];
  loading: boolean;
  error: string | null;
}

type ProviderState = Record<AtMentionItemKind, Omit<AtMentionSection, 'kind'>>;

function emptyProviderState(loading: boolean): ProviderState {
  const state = { items: [], loading, error: null };
  return {
    file: { ...state },
    note: { ...state },
    session: { ...state },
    skill: { ...state },
    agent: { ...state },
    browser_tab: { ...state },
    mcp_server: { ...state },
    mcp_resource: { ...state },
  };
}

/** Returns the unfinished `@query` immediately before the caret, excluding email addresses. */
export function detectAtRange(text: string, cursor: number): AtRange | null {
  const boundedCursor = Math.min(Math.max(cursor, 0), text.length);
  if (boundedCursor < 1) return null;
  const before = text.slice(0, boundedCursor);
  const match = before.match(/@((?:\\.|[^\s])*)$/);
  if (!match || match.index === undefined) return null;
  const start = match.index;
  if (start > 0 && /[a-zA-Z0-9_]/.test(text[start - 1])) return null;
  const query = (match[1] ?? '').replace(/\\([\\\s])/gu, '$1');
  return { start, end: boundedCursor, query };
}

export function escapeAtQuery(query: string): string {
  return query.replace(/[\\\s]/gu, (value) => `\\${value}`);
}

function isBrowseModeQuery(query: string): boolean {
  const normalized = query.trim();
  return normalized.length > 0
    && normalized.endsWith('/')
    && !normalized.startsWith('mcp:')
    && !/^https?:\/\//i.test(normalized);
}

export function browseDirFromQuery(query: string): string {
  return query.replace(/\/+$/, '').trim();
}

export function browseParentDir(dir: string): string {
  const normalized = dir.replace(/\/+$/, '');
  if (!normalized) return '';
  const separator = normalized.lastIndexOf('/');
  return separator <= 0 ? '' : normalized.slice(0, separator);
}

function clampPaletteIndex(index: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(index, length - 1);
}

function toFileItem(entry: {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  revision: string;
}): AtMentionFileItem {
  return {
    id: `file:${entry.id}`,
    kind: 'file',
    name: entry.name,
    description: entry.path,
    relativePath: entry.path,
    isDirectory: entry.isDirectory,
    fileRef: { sourceId: entry.id, expectedVersion: entry.revision },
  };
}

export function useAtMentionPicker(
  value: string,
  cursor: number,
  options: {
    conversationId: string | null;
    currentAgentId?: string;
    slashPaletteOpen: boolean;
    isComposing?: boolean;
    selectedContextKeys?: ReadonlySet<string>;
    prepareSession?: () => Promise<string | null>;
    /** When provided, skips internal `detectAtRange` computation. */
    precomputedAtRange?: AtRange | null;
  },
) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [providerState, setProviderState] = useState<ProviderState>(() => emptyProviderState(false));
  const requestGeneration = useRef(0);
  const language = useLocaleStore((state) => state.language);

  const atRange = useMemo(() => {
    if (options.isComposing || options.slashPaletteOpen) return null;
    if (options.precomputedAtRange !== undefined) return options.precomputedAtRange;
    return detectAtRange(value, cursor);
  }, [value, cursor, options.slashPaletteOpen, options.isComposing, options.precomputedAtRange]);

  const pickerActive = atRange !== null;
  const rawQuery = pickerActive ? atRange.query : '';
  const [debouncedQueryRaw] = useDebounce(rawQuery, DEBOUNCE_MS);
  const debouncedQuery = pickerActive ? debouncedQueryRaw : '';
  const conversationId = options.conversationId?.trim() ?? '';
  const selectedContextKeys = options.selectedContextKeys ?? new Set<string>();
  const selectedContextKeysKey = [...selectedContextKeys].sort().join('\0');

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!pickerActive) {
      setProviderState(emptyProviderState(false));
      return;
    }
    if (!conversationId) {
      setProviderState(emptyProviderState(Boolean(options.prepareSession)));
      if (options.prepareSession) {
        void options.prepareSession().catch(() => {
          if (requestGeneration.current === generation) setProviderState(emptyProviderState(false));
        });
      }
      return;
    }

    const context = {
      conversationId,
      currentAgentId: options.currentAgentId,
      language,
      selectedContextKeys: new Set(selectedContextKeysKey ? selectedContextKeysKey.split('\0') : []),
      recentPaths: new Set(getRecentAtPaths(conversationId)),
    };

    if (/^mcp:[^/]+\//u.test(debouncedQuery)) {
      const loadingState = emptyProviderState(false);
      loadingState.mcp_resource = { items: [], loading: true, error: null };
      setProviderState(loadingState);
      const provider = atMentionProviders.find((candidate) => candidate.kind === 'mcp_resource')!;
      void provider.search(debouncedQuery, context)
        .then((items) => {
          if (requestGeneration.current !== generation) return;
          setProviderState((current) => ({
            ...current,
            mcp_resource: { items, loading: false, error: null },
          }));
        })
        .catch((error: unknown) => {
          if (requestGeneration.current !== generation) return;
          setProviderState((current) => ({
            ...current,
            mcp_resource: {
              items: [], loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
      return;
    }

    if (isBrowseModeQuery(debouncedQuery)) {
      const loadingState = emptyProviderState(false);
      loadingState.file = { items: [], loading: true, error: null };
      setProviderState(loadingState);
      const dir = browseDirFromQuery(debouncedQuery);
      void fetchWorkspaceBrowseEntries(dir, { conversationId, agentId: options.currentAgentId })
        .then((entries) => {
          if (requestGeneration.current !== generation) return;
          const browseUp: AtMentionFileItem = {
            id: `browse-up:${dir}`,
            kind: 'file',
            name: '..',
            description: browseParentDir(dir) || '/',
            relativePath: '',
            isDirectory: true,
            isBrowseUp: true,
          };
          setProviderState((current) => ({
            ...current,
            file: { items: [browseUp, ...entries.map(toFileItem)], loading: false, error: null },
          }));
        })
        .catch((error: unknown) => {
          if (requestGeneration.current !== generation) return;
          setProviderState((current) => ({
            ...current,
            file: {
              items: [], loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
      return;
    }

    setProviderState(emptyProviderState(true));
    for (const provider of atMentionProviders) {
      void provider.search(debouncedQuery, context)
        .then((items) => {
          if (requestGeneration.current !== generation) return;
          setProviderState((current) => ({
            ...current,
            [provider.kind]: { items, loading: false, error: null },
          }));
        })
        .catch((error: unknown) => {
          if (requestGeneration.current !== generation) return;
          setProviderState((current) => ({
            ...current,
            [provider.kind]: {
              items: [], loading: false,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        });
    }
  }, [
    pickerActive,
    conversationId,
    debouncedQuery,
    language,
    options.currentAgentId,
    options.prepareSession,
    selectedContextKeysKey,
  ]);

  const sections = useMemo<AtMentionSection[]>(() => PROVIDER_ORDER.map((kind) => ({
    kind,
    ...providerState[kind],
  })), [providerState]);
  const items = pickerActive ? sections.flatMap((section) => section.items) : [];
  const loading = pickerActive && sections.some((section) => section.loading);
  const errors = sections.flatMap((section) => section.error ? [section.error] : []);
  const error = !loading && items.length === 0 ? (errors[0] ?? null) : null;

  const selectionKey = `${atRange?.start ?? ''}:${atRange?.end ?? ''}:${debouncedQuery}`;
  useEffect(() => setSelectedIndex(0), [selectionKey]);
  const resolvedSelectedIndex = clampPaletteIndex(selectedIndex, items.length);

  const onNavigate = useCallback((direction: 'up' | 'down') => {
    if (items.length === 0) return;
    setSelectedIndex((index) => direction === 'down'
      ? (index + 1) % items.length
      : (index - 1 + items.length) % items.length);
  }, [items.length]);

  return {
    open: pickerActive,
    atRange,
    sections,
    items,
    selectedIndex: resolvedSelectedIndex,
    query: atRange?.query ?? '',
    loading,
    error,
    onNavigate,
    setSelectedIndex,
  };
}
