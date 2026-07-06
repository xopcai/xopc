/**
 * API layer for the command palette — fetches commands and skills with in-memory caching.
 */
import { apiFetch, formatApiHttpError } from '../../api/client';
import type { CommandEntry, PaletteItem } from './command-palette.types';

/** A single skill entry from the catalog. */
export interface SkillCatalogEntry {
  directoryId: string;
  name: string;
  description: string;
  source: 'builtin' | 'workspace' | 'global' | 'extra';
  path: string;
  managed: boolean;
  enabled: boolean;
}

const CACHE_TTL_MS = 60_000;

// --- Commands cache ---
let _commandsCache: CommandEntry[] | null = null;
let _commandsExpiry = 0;
let _commandsInflight: Promise<CommandEntry[]> | null = null;

async function fetchCommands(): Promise<CommandEntry[]> {
  const res = await apiFetch('/api/commands');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: { commands?: CommandEntry[] } };
  return data.payload?.commands ?? [];
}

export async function fetchCommandsCached(forceRefresh = false): Promise<CommandEntry[]> {
  const now = Date.now();
  if (!forceRefresh && _commandsCache && now < _commandsExpiry) {
    return _commandsCache;
  }
  if (_commandsInflight) return _commandsInflight;

  _commandsInflight = fetchCommands()
    .then((commands) => {
      _commandsCache = commands;
      _commandsExpiry = Date.now() + CACHE_TTL_MS;
      return commands;
    })
    .finally(() => {
      _commandsInflight = null;
    });

  return _commandsInflight;
}

// --- Skills cache ---
let _skillsCache: SkillCatalogEntry[] | null = null;
let _skillsExpiry = 0;
let _skillsInflight: Promise<SkillCatalogEntry[]> | null = null;

async function fetchEnabledSkills(): Promise<SkillCatalogEntry[]> {
  const res = await apiFetch('/api/skills');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: { catalog?: unknown[] } };
  if (!data.payload) return [];
  const catalog = Array.isArray(data.payload.catalog)
    ? (data.payload.catalog as SkillCatalogEntry[])
    : [];
  return catalog.filter((s) => s.enabled);
}

export async function fetchSkillsCached(forceRefresh = false): Promise<SkillCatalogEntry[]> {
  const now = Date.now();
  if (!forceRefresh && _skillsCache && now < _skillsExpiry) {
    return _skillsCache;
  }
  if (_skillsInflight) return _skillsInflight;

  _skillsInflight = fetchEnabledSkills()
    .then((skills) => {
      _skillsCache = skills;
      _skillsExpiry = Date.now() + CACHE_TTL_MS;
      return skills;
    })
    .finally(() => {
      _skillsInflight = null;
    });

  return _skillsInflight;
}

/**
 * Fetch all palette items (commands + skills) with caching.
 */
export async function fetchAllPaletteItems(): Promise<PaletteItem[]> {
  const [commands, skills] = await Promise.all([fetchCommandsCached(), fetchSkillsCached()]);

  const commandItems: PaletteItem[] = commands.map((c) => ({
    kind: 'command' as const,
    id: `cmd:${c.id}`,
    name: c.name,
    description: c.description,
    category: c.category,
    aliases: c.aliases,
    acceptsArgs: c.acceptsArgs,
  }));

  const skillItems: PaletteItem[] = skills.map((s) => ({
    kind: 'skill' as const,
    id: `skill:${s.name}`,
    name: s.name,
    description: s.description,
    category: 'skill',
    source: s.source,
  }));

  return [...skillItems, ...commandItems];
}
