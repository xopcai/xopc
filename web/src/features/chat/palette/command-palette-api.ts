import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

import { getSkills } from '@/features/skills/skill-api';

import type { CommandEntry } from '@/features/chat/palette/command-palette.types';
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
