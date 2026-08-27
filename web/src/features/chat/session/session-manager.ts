import {
  buildSessionHistoryPath,
  parseSessionMessagePage,
} from '@xopcai/gateway-contract';

import type { Message } from '@/features/chat/messages/messages.types';
import type { SessionInfo } from '@/features/chat/chat.types';
import { sessionWireToUiMessages } from '@/features/chat/messages/agent-messages';
import { fetchSessionActiveRun } from '@/features/chat/session/resolve-resume-run-id';
import { listSessions } from '@/features/sessions/session-api';
import { apiFetch } from '@/lib/fetch';
import { apiFetchWithStartupRetry } from '@/lib/gateway-startup-retry';
import { apiUrl } from '@/lib/url';
import { upsertWebchatEmptyShellCache } from '@/features/chat/session/webchat-empty-shell-cache';

/** `GET /api/sessions?channel=…` filters on {@link SessionMetadata.sourceChannel}. */
export const WEB_UI_SESSION_SOURCE_CHANNELS = 'webchat';

export type SessionAgentConfig = {
  thinkingLevel: string;
  model: string;
  reasoningLevel: string;
  activityDetail: {
    default: 'off' | 'on' | 'stream';
    override: 'off' | 'on' | 'stream' | null;
    effective: 'off' | 'on' | 'stream';
    source: 'session' | 'default';
  };
  effectiveWorkspacePath: string;
  workingDirectoryLocked: boolean;
  workspaceSource: 'project' | 'session_override' | 'agent_default_root' | 'agent_workspace';
};

function parseSessionAgentConfigResponse(raw: unknown): SessionAgentConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid session agent config response');
  }
  const response = raw as { ok?: unknown; payload?: unknown };
  if (response.ok !== true || !response.payload || typeof response.payload !== 'object') {
    throw new Error('Invalid session agent config response');
  }
  const payload = response.payload as Record<string, unknown>;
  const workspaceSource = payload.workspaceSource;
  const rawActivity = payload.activityDetail;
  const activity = rawActivity && typeof rawActivity === 'object'
    ? rawActivity as Record<string, unknown>
    : null;
  const isLevel = (value: unknown): value is 'off' | 'on' | 'stream' =>
    value === 'off' || value === 'on' || value === 'stream';
  if (
    typeof payload.thinkingLevel !== 'string' ||
    typeof payload.model !== 'string' ||
    typeof payload.reasoningLevel !== 'string' ||
    typeof payload.effectiveWorkspacePath !== 'string' ||
    typeof payload.workingDirectoryLocked !== 'boolean' ||
    (workspaceSource !== 'project' &&
      workspaceSource !== 'session_override' &&
      workspaceSource !== 'agent_default_root' &&
      workspaceSource !== 'agent_workspace')
  ) {
    throw new Error('Invalid session agent config response');
  }
  return {
    thinkingLevel: payload.thinkingLevel,
    model: payload.model,
    reasoningLevel: payload.reasoningLevel,
    activityDetail: activity &&
      isLevel(activity.default) &&
      (activity.override === null || isLevel(activity.override)) &&
      isLevel(activity.effective) &&
      (activity.source === 'session' || activity.source === 'default')
      ? {
          default: activity.default,
          override: activity.override,
          effective: activity.effective,
          source: activity.source,
        }
      : {
          default: isLevel(payload.reasoningLevel) ? payload.reasoningLevel : 'on',
          override: isLevel(payload.reasoningLevel) ? payload.reasoningLevel : null,
          effective: isLevel(payload.reasoningLevel) ? payload.reasoningLevel : 'on',
          source: isLevel(payload.reasoningLevel) ? 'session' : 'default',
        },
    effectiveWorkspacePath: payload.effectiveWorkspacePath,
    workingDirectoryLocked: payload.workingDirectoryLocked,
    workspaceSource,
  };
}

const _agentConfigInflight = new Map<string, Promise<SessionAgentConfig>>();

type SessionLoadResult = {
  messages: Message[];
  hasMore: boolean;
  name?: string;
  nextBeforeCursor?: string;
};

const _sessionLoadInflight = new Map<string, Promise<SessionLoadResult>>();
const INITIAL_HISTORY_PAGE_LIMIT = 50;
const INITIAL_HISTORY_MAX_RAW_ROWS = 500;

export type SessionTimelineItem = {
  id: string;
  kind: 'turn' | 'tool' | 'file' | 'command' | 'context' | 'branch' | 'compaction';
  role?: 'user' | 'assistant' | 'system';
  title: string;
  preview?: string;
  timestamp?: number;
  depth: number;
  turn: number;
  displayIndex?: number;
  rowNumber?: number;
  status?: 'running' | 'done' | 'error';
  meta?: { toolName?: string; files?: string[] };
};

const _timelineInflight = new Map<string, Promise<SessionTimelineItem[]>>();

export function parseWebchatSessionKeyForCreate(
  sessionKey: string,
): { agentId: string; channel: string; chatId: string } | null {
  const parts = sessionKey.trim().split(':');
  if (parts.length < 6) return null;
  const [scope, agentId, channel, accountId, peerKind, ...peerParts] = parts;
  const chatId = peerParts.join(':').trim();
  if (scope !== 'agent') return null;
  if (!agentId?.trim()) return null;
  if (channel !== 'webchat') return null;
  if (accountId !== 'default' || peerKind !== 'direct') return null;
  if (!chatId) return null;
  return { agentId: agentId.trim().toLowerCase(), channel, chatId };
}

async function readErrorMessage(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: string | { message?: string };
  };
  return typeof body.error === 'string' ? body.error : body.error?.message ?? `HTTP ${res.status}`;
}

/** Session list + history via REST; auth from `apiFetch` (gateway token store). */
export class SessionManager {
  /** All webchat sessions, paginated by source channel. */
  async loadSessions(): Promise<SessionInfo[]> {
    const pageSize = 100;
    const out: SessionInfo[] = [];
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const data = await listSessions({
        channel: WEB_UI_SESSION_SOURCE_CHANNELS,
        limit: pageSize,
        offset,
      });
      for (const s of data.items) {
        out.push({
          key: s.key,
          sessionId: s.sessionId,
          name: s.name,
          updatedAt: s.updatedAt,
          messageCount: s.messageCount,
          sourceChannel: s.sourceChannel,
          sourceChatId: s.sourceChatId,
          projectId: s.projectId,
          customData: s.customData,
          routing: s.routing,
        });
      }
      if (!data.hasMore) break;
      offset += pageSize;
    }
    const sorted = out.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    upsertWebchatEmptyShellCache(sorted);
    return sorted;
  }

  async loadSessionAgentConfig(sessionKey: string): Promise<SessionAgentConfig> {
    const existing = _agentConfigInflight.get(sessionKey);
    if (existing) return existing;

    const pending = (async () => {
      const res = await apiFetch(
        apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseSessionAgentConfigResponse(await res.json());
    })().finally(() => {
      _agentConfigInflight.delete(sessionKey);
    });

    _agentConfigInflight.set(sessionKey, pending);
    return pending;
  }

  async patchSessionAgentConfig(
    sessionKey: string,
    patch: {
      thinkingLevel?: string;
      model?: string | null;
      workingDirectory?: string;
    },
  ): Promise<void> {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/agent-config`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error ?? `HTTP ${res.status}`);
    }
  }

  async patchTaskConversationModel(taskId: string, model: string): Promise<void> {
    const res = await apiFetch(apiUrl(`/api/tasks/${encodeURIComponent(taskId)}/conversation/config`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
  }

  /** Gateway read-only active webchat run (`GET /api/sessions/:key/run`). */
  fetchSessionActiveRun(sessionKey: string) {
    return fetchSessionActiveRun(sessionKey);
  }

  async loadSession(
    sessionKey: string,
    offset = 0,
    beforeCursor?: string | null,
    taskId?: string,
  ): Promise<SessionLoadResult> {
    const dedupeKey = `${taskId ?? sessionKey}\0${offset}\0${beforeCursor ?? ''}`;
    const existing = _sessionLoadInflight.get(dedupeKey);
    if (existing) return existing;

    const pending = (async () => {
      const loadPage = async (pageOffset: number, pageBeforeCursor?: string | null) => {
        const res = await apiFetchWithStartupRetry(
          apiUrl(taskId
            ? `/api/tasks/${encodeURIComponent(taskId)}/conversation/history?${new URLSearchParams({
                limit: String(INITIAL_HISTORY_PAGE_LIMIT),
                ...(pageBeforeCursor ? { before: pageBeforeCursor } : { offset: String(pageOffset) }),
              }).toString()}`
            : buildSessionHistoryPath(sessionKey, {
                limit: INITIAL_HISTORY_PAGE_LIMIT,
                before: pageBeforeCursor,
                offset: pageBeforeCursor ? undefined : pageOffset,
              })),
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        return parseSessionMessagePage(await res.json());
      };

      let data = await loadPage(offset, beforeCursor);
      let raw = data.session.messages;
      let messages = sessionWireToUiMessages(raw);
      let hasMore = data.pagination.hasMore;
      let nextBeforeCursor = data.pagination.nextBeforeCursor;
      const loadedName =
        typeof data.session.name === 'string' && data.session.name.trim()
          ? data.session.name.trim()
          : undefined;
      // The history endpoint pages raw transcript rows, while the UI merges many assistant/tool
      // rows into one visible turn. A long tool-heavy tail can make the first page start with an
      // orphan assistant bubble. For the initial tail load, pull older raw pages until the visible
      // slice starts at a user row or history is exhausted.
      while (
        offset === 0 &&
        !beforeCursor &&
        hasMore &&
        nextBeforeCursor &&
        raw.length < INITIAL_HISTORY_MAX_RAW_ROWS &&
        messages[0]?.role === 'assistant'
      ) {
        data = await loadPage(0, nextBeforeCursor);
        const olderRaw = data.session.messages;
        if (olderRaw.length === 0) break;
        raw = [...olderRaw, ...raw];
        messages = sessionWireToUiMessages(raw);
        hasMore = data.pagination.hasMore;
        nextBeforeCursor = data.pagination.nextBeforeCursor;
      }

      return {
        messages,
        hasMore,
        name: loadedName,
        nextBeforeCursor,
      };
    })().finally(() => {
      _sessionLoadInflight.delete(dedupeKey);
    });

    _sessionLoadInflight.set(dedupeKey, pending);
    return pending;
  }

  async loadTimeline(sessionKey: string, taskId?: string): Promise<SessionTimelineItem[]> {
    const cacheKey = taskId ?? sessionKey;
    const existing = _timelineInflight.get(cacheKey);
    if (existing) return existing;

    const pending = (async () => {
      const res = await apiFetchWithStartupRetry(
        apiUrl(taskId
          ? `/api/tasks/${encodeURIComponent(taskId)}/conversation/timeline`
          : `/api/sessions/${encodeURIComponent(sessionKey)}/timeline`),
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = (await res.json()) as {
        ok: true;
        items: SessionTimelineItem[];
      };
      if (data.ok !== true || !Array.isArray(data.items)) {
        throw new Error('Invalid session timeline response');
      }
      return data.items;
    })().finally(() => {
      _timelineInflight.delete(cacheKey);
    });

    _timelineInflight.set(cacheKey, pending);
    return pending;
  }

  async createSession(options?: { agentId?: string; projectId?: string | null }): Promise<SessionInfo> {
    const body: Record<string, unknown> = { channel: 'webchat' };
    const raw = options?.agentId?.trim();
    if (raw) body.agentId = raw.toLowerCase();
    const projectId = options?.projectId?.trim();
    if (projectId) body.projectId = projectId;
    const res = await apiFetch(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { session: SessionInfo };
    return data.session;
  }

  async ensureSessionExists(sessionKey: string): Promise<void> {
    const trimmed = sessionKey.trim();
    if (!trimmed) throw new Error('Session key is required');

    const resolved = await apiFetch(apiUrl('/api/sessions/resolve'), {
      method: 'POST',
      body: JSON.stringify({ sessionKey: trimmed }),
    });
    if (resolved.ok) return;
    if (resolved.status !== 404) {
      throw new Error(await readErrorMessage(resolved));
    }

    const parsed = parseWebchatSessionKeyForCreate(trimmed);
    if (!parsed) {
      throw new Error('Session not found');
    }

    const created = await apiFetch(apiUrl('/api/sessions'), {
      method: 'POST',
      body: JSON.stringify({
        channel: parsed.channel,
        agentId: parsed.agentId,
        chat_id: parsed.chatId,
      }),
    });
    if (!created.ok) {
      throw new Error(await readErrorMessage(created));
    }
  }

  /** Lightweight name read after auto-title (matches `ui` SessionManager). */
  async fetchSessionName(sessionKey: string): Promise<string | undefined> {
    const res = await apiFetchWithStartupRetry(
      apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}?offset=0&limit=1`),
    );
    if (!res.ok) return undefined;
    const data = (await res.json()) as { session?: { name?: string } };
    const n = data.session?.name;
    return typeof n === 'string' && n.trim() ? n.trim() : undefined;
  }

  updateUrl(sessionKey: string): void {
    const newHash = `#/chat/${encodeURIComponent(sessionKey)}`;
    if (location.hash !== newHash) {
      const s = window.history.state;
      const next =
        s && typeof s === 'object' && !Array.isArray(s) ? { ...(s as Record<string, unknown>) } : s;
      history.replaceState(next, '', newHash);
    }
  }

  parseSessionFromHash(): string | null {
    const hash = location.hash.slice(1);
    const m = hash.match(/^\/chat\/(.+)$/) || hash.match(/^chat\/(.+)$/);
    const key = m ? decodeURIComponent(m[1]) : null;
    return key && key !== 'new' ? key : null;
  }

  /** Delete one user turn (user + assistant/tool rows) or a raw LLM index range. */
  async deleteMessages(
    sessionKey: string,
    opts: { userRoundIndex: number },
  ): Promise<void> {
    const res = await apiFetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionKey)}/messages`), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error ?? `HTTP ${res.status}`);
    }
  }
}
