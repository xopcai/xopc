import { apiFetch, formatApiHttpError } from '../api/client';

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

export interface SkillsPayload {
  catalog: SkillCatalogEntry[];
}

export async function fetchSkills(): Promise<SkillsPayload> {
  const res = await apiFetch('/api/skills');
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(formatApiHttpError(res.status, res.statusText, body.error?.message));
  }
  const data = (await res.json()) as { ok?: boolean; payload?: { catalog?: unknown[]; managed?: unknown[] } };
  if (!data.payload) {
    throw new Error('Invalid response');
  }
  const catalog: SkillCatalogEntry[] = Array.isArray(data.payload.catalog)
    ? (data.payload.catalog as SkillCatalogEntry[])
    : [];
  return { catalog };
}
