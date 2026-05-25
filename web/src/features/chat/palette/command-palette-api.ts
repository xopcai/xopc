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

export async function fetchCommands(): Promise<CommandEntry[]> {
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

const _skillsCache = new Map<string, Awaited<ReturnType<typeof getSkills>>>();
const _skillsExpiry = new Map<string, number>();
let _skillsInflight: ReturnType<typeof getSkills> | null = null;
let _skillsInflightLang: string | undefined;

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
  lang?: string,
  forceRefresh = false,
): Promise<Awaited<ReturnType<typeof getSkills>>> {
  const key = lang ?? 'en';
  const now = Date.now();
  if (!forceRefresh && _skillsCache.has(key) && now < (_skillsExpiry.get(key) ?? 0)) {
    return _skillsCache.get(key)!;
  }
  if (_skillsInflight && _skillsInflightLang === key) return _skillsInflight;

  _skillsInflightLang = key;
  _skillsInflight = getSkills(lang)
    .then((payload) => {
      _skillsCache.set(key, payload);
      _skillsExpiry.set(key, Date.now() + CACHE_TTL_MS);
      return payload;
    })
    .finally(() => {
      _skillsInflight = null;
      _skillsInflightLang = undefined;
    });

  return _skillsInflight;
}
