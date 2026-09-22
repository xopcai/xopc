import { resolveSkillPresentation } from '@xopcai/composer-core/skill-localization';

import { fetchChatAgents } from '@/features/chat/agent-selection/chat-agents-api';
import { getChatSkillsCached } from '@/features/chat/palette/command-palette-api';
import {
  agentListDisplayDescription,
  agentListDisplayName,
} from '@/features/settings/agents/agent-display-names';
import { listNotes } from '@/features/notes/notes-api';
import { listSessions } from '@/features/sessions/session-api';
import {
  listWorkspaceDir,
  searchWorkspaceFiles as searchManagedFiles,
  type WorkspaceEntry,
} from '@/features/workspace/workspace-api';
import { messages } from '@/i18n/messages';
import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type AtMentionItemKind =
  | 'file' | 'note' | 'session' | 'skill' | 'agent'
  | 'browser_tab' | 'mcp_server' | 'mcp_resource';

interface AtMentionItemBase {
  id: string;
  kind: AtMentionItemKind;
  name: string;
  description: string;
}

export interface AtMentionFileItem extends AtMentionItemBase {
  kind: 'file';
  /** Workspace-relative path, or empty for the browse-up row. */
  relativePath: string;
  isDirectory: boolean;
  isBrowseUp?: boolean;
  isRecent?: boolean;
  fileRef?: {
    sourceId: string;
    expectedVersion: string;
  };
}

export interface AtMentionNoteItem extends AtMentionItemBase {
  kind: 'note';
  noteRef: {
    sourceId: string;
    expectedVersion: string;
  };
}

export interface AtMentionSessionItem extends AtMentionItemBase {
  kind: 'session';
  sessionRef: {
    sourceId: string;
    expectedVersion: string;
  };
}

export interface AtMentionSkillItem extends AtMentionItemBase {
  kind: 'skill';
  canonicalName: string;
}

export interface AtMentionAgentItem extends AtMentionItemBase {
  kind: 'agent';
  agentId: string;
  avatar?: string;
}

export interface AtMentionBrowserTabItem extends AtMentionItemBase {
  kind: 'browser_tab';
  tabRef: { sourceId: string; expectedVersion: string };
  url: string;
}

export interface AtMentionMcpServerItem extends AtMentionItemBase {
  kind: 'mcp_server';
  serverId: string;
}

export interface AtMentionMcpResourceItem extends AtMentionItemBase {
  kind: 'mcp_resource';
  serverId: string;
  resourceRef: { sourceId: string; expectedVersion: string };
  uri: string;
}

export type AtMentionItem =
  | AtMentionFileItem
  | AtMentionNoteItem
  | AtMentionSessionItem
  | AtMentionSkillItem
  | AtMentionAgentItem
  | AtMentionBrowserTabItem
  | AtMentionMcpServerItem
  | AtMentionMcpResourceItem;

export interface AtMentionProviderContext {
  conversationId: string;
  currentAgentId?: string;
  language: 'en' | 'zh';
  selectedContextKeys: ReadonlySet<string>;
  recentPaths: ReadonlySet<string>;
}

export interface AtMentionProvider {
  kind: AtMentionItemKind;
  search(query: string, context: AtMentionProviderContext): Promise<AtMentionItem[]>;
}

const EMPTY_QUERY_CACHE_TTL_MS = 30_000;
let emptyQueryCache: { key: string; at: number; items: AtMentionFileItem[] } | null = null;

function mapFileEntries(
  entries: Array<{ id: string; name: string; path: string; isDirectory: boolean; revision: string }>,
  recentPaths: ReadonlySet<string>,
): AtMentionFileItem[] {
  return entries.map((entry) => ({
    id: `file:${entry.id}`,
    kind: 'file',
    name: entry.name,
    description: entry.path,
    relativePath: entry.path,
    isDirectory: entry.isDirectory,
    ...(recentPaths.has(entry.path) ? { isRecent: true } : {}),
    fileRef: { sourceId: entry.id, expectedVersion: entry.revision },
  }));
}

/** Fuzzy path search over the session workspace, including matching directories. */
export async function searchWorkspaceEntries(
  query: string,
  options: {
    conversationId?: string;
    agentId?: string;
    limit?: number;
    recentPaths?: ReadonlySet<string>;
  },
): Promise<AtMentionFileItem[]> {
  const conversationId = options.conversationId?.trim();
  const agentId = options.agentId?.trim();
  const limit = options.limit ?? 15;
  const normalizedQuery = query.trim();
  const recentPaths = options.recentPaths ?? new Set<string>();
  if (conversationId && normalizedQuery.length === 0) {
    const now = Date.now();
    if (
      emptyQueryCache
      && emptyQueryCache.key === conversationId
      && now - emptyQueryCache.at < EMPTY_QUERY_CACHE_TTL_MS
    ) {
      return emptyQueryCache.items.map((item) => ({
        ...item,
        ...(recentPaths.has(item.relativePath) ? { isRecent: true } : { isRecent: undefined }),
      }));
    }
  }

  const requestOptions = { conversationId, agentId };
  const entries = normalizedQuery.length === 0
    ? await listWorkspaceDir('', requestOptions)
    : await searchManagedFiles(normalizedQuery, requestOptions, limit);
  const items = mapFileEntries(entries, recentPaths);

  if (conversationId && normalizedQuery.length === 0) {
    emptyQueryCache = { key: conversationId, at: Date.now(), items };
  }
  return items;
}

/** List one directory level for navigation inside the file provider. */
export async function fetchWorkspaceBrowseEntries(
  dir: string,
  options: { conversationId?: string; agentId?: string },
): Promise<WorkspaceEntry[]> {
  return listWorkspaceDir(dir, {
    conversationId: options.conversationId,
    agentId: options.agentId,
  });
}

function includesQuery(query: string, ...values: Array<string | undefined>): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || values.some((value) => value?.toLocaleLowerCase().includes(needle));
}

async function requestPayload<T>(path: string): Promise<T> {
  const response = await apiFetch(apiUrl(path));
  const body = await response.json().catch(() => ({})) as { payload?: T; error?: unknown };
  if (!response.ok || !body.payload) {
    throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`);
  }
  return body.payload;
}

type McpResourcePayloadItem = {
  id: string;
  version: string;
  serverId: string;
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

let mcpResourcesCache: { expiresAt: number; items: McpResourcePayloadItem[] } | null = null;

async function getMcpResources(): Promise<McpResourcePayloadItem[]> {
  if (mcpResourcesCache && Date.now() < mcpResourcesCache.expiresAt) return mcpResourcesCache.items;
  const payload = await requestPayload<{ resources: McpResourcePayloadItem[] }>('/api/mcp/resources');
  mcpResourcesCache = { expiresAt: Date.now() + 30_000, items: payload.resources };
  return payload.resources;
}

export const atMentionProviders: readonly AtMentionProvider[] = [
  {
    kind: 'file',
    search: (query, context) => searchWorkspaceEntries(query, {
      conversationId: context.conversationId,
      agentId: context.currentAgentId,
      limit: 10,
      recentPaths: context.recentPaths,
    }),
  },
  {
    kind: 'note',
    async search(query, context) {
      const payload = await listNotes({
        ...(query.trim() ? { search: query.trim() } : {}),
        limit: 5,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      return payload.items
        .filter((note) => note.status !== 'trashed' && !context.selectedContextKeys.has(`note:${note.id}`))
        .map((note): AtMentionNoteItem => ({
          id: `note:${note.id}`,
          kind: 'note',
          name: note.title?.trim() || note.snippet?.trim() || messages(context.language).chat.commandPalette.untitledNote,
          description: note.snippet?.trim() || '',
          noteRef: { sourceId: note.id, expectedVersion: String(note.updatedAt) },
        }));
    },
  },
  {
    kind: 'session',
    async search(query, context) {
      const payload = await listSessions({
        ...(query.trim() ? { search: query.trim() } : {}),
        limit: 5,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      });
      return payload.items
        .filter((session) => session.key !== context.conversationId
          && !context.selectedContextKeys.has(`session:${session.key}`))
        .map((session): AtMentionSessionItem => ({
          id: `session:${session.key}`,
          kind: 'session',
          name: session.name?.trim() || session.key,
          description: `${session.messageCount} messages`,
          sessionRef: { sourceId: session.key, expectedVersion: session.updatedAt },
        }));
    },
  },
  {
    kind: 'skill',
    async search(query, context) {
      const payload = await getChatSkillsCached(context.currentAgentId, context.conversationId);
      return payload.skills.flatMap((skill): AtMentionSkillItem[] => {
        if (!skill.availableForCurrentAgent) return [];
        const presentation = resolveSkillPresentation(skill, context.language);
        if (!includesQuery(query, skill.name, presentation.displayName, presentation.description, ...presentation.searchTerms)) {
          return [];
        }
        return [{
          id: `skill:${skill.name}`,
          kind: 'skill',
          name: presentation.displayName,
          description: presentation.description,
          canonicalName: skill.name,
        }];
      }).slice(0, 5);
    },
  },
  {
    kind: 'agent',
    async search(query, context) {
      const payload = await fetchChatAgents();
      const agentMessages = messages(context.language).agentsSettings;
      return payload.items.flatMap((agent): AtMentionAgentItem[] => {
        const name = agentListDisplayName(agent, agentMessages);
        const description = agentListDisplayDescription(agent, agentMessages);
        if (!includesQuery(query, agent.id, name, description)) return [];
        return [{
          id: `agent:${agent.id}`,
          kind: 'agent',
          name,
          description,
          agentId: agent.id,
          ...(agent.avatar ? { avatar: agent.avatar } : {}),
        }];
      }).slice(0, 5);
    },
  },
  {
    kind: 'browser_tab',
    async search(query, context) {
      const params = new URLSearchParams({ conversationId: context.conversationId });
      const payload = await requestPayload<{ tabs: Array<{
        id: string; title: string; url: string; documentId: string; active: boolean;
      }> }>(`/api/browser/tabs?${params}`);
      return payload.tabs.flatMap((tab): AtMentionBrowserTabItem[] => {
        if (!includesQuery(query, tab.title, tab.url)) return [];
        if (context.selectedContextKeys.has(`browser_tab:${tab.id}`)) return [];
        return [{
          id: `browser-tab:${tab.id}`,
          kind: 'browser_tab',
          name: tab.title || tab.url,
          description: tab.url,
          url: tab.url,
          tabRef: { sourceId: tab.id, expectedVersion: tab.documentId },
        }];
      });
    },
  },
  {
    kind: 'mcp_server',
    async search(query) {
      if (query.startsWith('mcp:')) return [];
      const payload = await requestPayload<{ mergedServerIds: string[] }>('/api/mcp/servers');
      return payload.mergedServerIds.flatMap((serverId): AtMentionMcpServerItem[] => {
        if (!includesQuery(query, serverId, 'mcp')) return [];
        return [{
          id: `mcp-server:${serverId}`,
          kind: 'mcp_server',
          name: serverId,
          description: 'MCP server',
          serverId,
        }];
      }).slice(0, 5);
    },
  },
  {
    kind: 'mcp_resource',
    async search(query, context) {
      const browse = query.match(/^mcp:([^/]+)\/(.*)$/u);
      if (!query.trim() || (query.startsWith('mcp:') && !browse)) return [];
      let serverId = '';
      let needle = '';
      if (browse) {
        try {
          serverId = decodeURIComponent(browse[1]);
        } catch {
          return [];
        }
        needle = browse[2]?.trim().toLocaleLowerCase() ?? '';
      } else {
        needle = query.trim().toLocaleLowerCase();
      }
      const resources = await getMcpResources();
      return resources
        .filter((resource) => !serverId || resource.serverId === serverId)
        .filter((resource) => !needle || [
          resource.name, resource.title, resource.description, resource.uri, resource.serverId,
        ].some((value) => value?.toLocaleLowerCase().includes(needle)))
        .filter((resource) => !context.selectedContextKeys.has(`mcp_resource:${resource.id}`))
        .map((resource): AtMentionMcpResourceItem => ({
          id: `mcp-resource:${resource.id}`,
          kind: 'mcp_resource',
          name: resource.title || resource.name,
          description: resource.description || `${resource.serverId} · ${resource.uri}`,
          serverId: resource.serverId,
          uri: resource.uri,
          resourceRef: { sourceId: resource.id, expectedVersion: resource.version },
        }));
    },
  },
];
