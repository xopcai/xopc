import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { getSkills } from '@/features/skills/skill-api';

import type { CommandEntry, SkillAvailabilityStatus } from '@/features/chat/palette/command-palette.types';
import { refreshSlashCommandWireIndex } from '@/features/chat/palette/slash-command-wire';

async function readErrorMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (typeof j.error === 'string') return j.error;
  if (j.error && typeof j.error === 'object' && 'message' in j.error) {
    const m = (j.error as { message?: string }).message;
    if (typeof m === 'string') return m;
  }
  return `HTTP ${res.status}`;
}

async function fetchCommands(): Promise<CommandEntry[]> {
  const res = await apiFetch(apiUrl('/api/commands'));
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: { commands?: CommandEntry[] } };
  return data.payload?.commands ?? [];
}

const CACHE_TTL_MS = 60_000;

let _commandsCache: CommandEntry[] | null = null;
let _commandsExpiry = 0;
let _commandsInflight: Promise<CommandEntry[]> | null = null;

let _skillsCache: Awaited<ReturnType<typeof getSkills>> | null = null;
let _skillsExpiry = 0;
let _skillsInflight: ReturnType<typeof getSkills> | null = null;

export interface ChatSkillEntry {
  name: string;
  description: string;
  source?: string;
  enabled: boolean;
  disableModelInvocation?: boolean;
  availableForCurrentAgent: boolean;
  unavailableReason: Exclude<SkillAvailabilityStatus, 'available'> | null;
}

export interface ChatSkillsPayload {
  agentId: string;
  defaultsAllowlist?: string[];
  agentAllowlist?: string[];
  effectiveAllowlist?: string[];
  skills: ChatSkillEntry[];
}

const _chatSkillsCache = new Map<string, { payload: ChatSkillsPayload; expiry: number }>();
const _chatSkillsInflight = new Map<string, Promise<ChatSkillsPayload>>();

export async function fetchCommandsCached(forceRefresh = false): Promise<CommandEntry[]> {
  const now = Date.now();
  if (!forceRefresh && _commandsCache && now < _commandsExpiry) {
    refreshSlashCommandWireIndex(_commandsCache);
    return _commandsCache;
  }
  if (_commandsInflight) return _commandsInflight;

  _commandsInflight = fetchCommands()
    .then((commands) => {
      _commandsCache = commands;
      _commandsExpiry = Date.now() + CACHE_TTL_MS;
      refreshSlashCommandWireIndex(commands);
      return commands;
    })
    .catch((err) => {
      refreshSlashCommandWireIndex([]);
      throw err;
    })
    .finally(() => {
      _commandsInflight = null;
    });

  return _commandsInflight;
}

export async function getChatSkillsCached(agentId: string | undefined, forceRefresh = false): Promise<ChatSkillsPayload> {
  const key = agentId?.trim() || 'main';
  const now = Date.now();
  const cached = _chatSkillsCache.get(key);
  if (!forceRefresh && cached && now < cached.expiry) {
    return cached.payload;
  }
  const inflight = _chatSkillsInflight.get(key);
  if (inflight) return inflight;

  const request = apiFetch(apiUrl(`/api/chat/skills?agentId=${encodeURIComponent(key)}`))
    .then(async (res) => {
      if (!res.ok) throw new Error(await readErrorMessage(res));
      const data = (await res.json()) as { ok?: boolean; payload?: ChatSkillsPayload };
      if (!data.payload || !Array.isArray(data.payload.skills)) {
        throw new Error('Invalid /api/chat/skills response');
      }
      _chatSkillsCache.set(key, { payload: data.payload, expiry: Date.now() + CACHE_TTL_MS });
      return data.payload;
    })
    .finally(() => {
      _chatSkillsInflight.delete(key);
    });
  _chatSkillsInflight.set(key, request);
  return request;
}

export async function addSkillToAgentAllowlist(agentId: string | undefined, skillName: string): Promise<void> {
  const key = agentId?.trim() || 'main';
  const current = await getChatSkillsCached(key, true);
  const selected = new Set(current.effectiveAllowlist ?? current.agentAllowlist ?? []);
  selected.add(skillName);
  const res = await apiFetch(apiUrl(`/api/agents/${encodeURIComponent(key)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skills: [...selected].sort((a, b) => a.localeCompare(b)) }),
  });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  clearChatSkillsCache(key);
}

export function clearChatSkillsCache(agentId?: string): void {
  if (agentId) {
    _chatSkillsCache.delete(agentId);
    return;
  }
  _chatSkillsCache.clear();
}

export async function getSkillsCached(
  forceRefresh = false,
): Promise<Awaited<ReturnType<typeof getSkills>>> {
  const now = Date.now();
  if (!forceRefresh && _skillsCache && now < _skillsExpiry) {
    return _skillsCache;
  }
  if (_skillsInflight) return _skillsInflight;

  _skillsInflight = getSkills()
    .then((payload) => {
      _skillsCache = payload;
      _skillsExpiry = Date.now() + CACHE_TTL_MS;
      return payload;
    })
    .finally(() => {
      _skillsInflight = null;
    });

  return _skillsInflight;
}
