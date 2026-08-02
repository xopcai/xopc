import { apiFetch } from '@/lib/fetch';
import { apiUrl } from '@/lib/url';

export type ActivityTarget =
  | { kind: 'goal'; id: string }
  | { kind: 'session'; id: string };

export type ActivityTargetAvailability = 'checking' | 'available' | 'missing';

function decodePathSegment(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded || null;
  } catch {
    return null;
  }
}

export function parseActivityTarget(href: string | undefined): ActivityTarget | null {
  if (!href) return null;
  const pathname = href.split(/[?#]/, 1)[0];
  const goalMatch = /^\/goals\/([^/]+)\/?$/.exec(pathname);
  if (goalMatch) {
    const id = decodePathSegment(goalMatch[1]);
    return id ? { kind: 'goal', id } : null;
  }
  const sessionMatch = /^\/chat\/([^/]+)\/?$/.exec(pathname);
  if (sessionMatch) {
    const id = decodePathSegment(sessionMatch[1]);
    if (!id || id === 'new') return null;
    return { kind: 'session', id };
  }
  return null;
}

export async function checkActivityTarget(
  target: ActivityTarget,
  signal?: AbortSignal,
): Promise<Exclude<ActivityTargetAvailability, 'checking'>> {
  const path = target.kind === 'goal'
    ? `/api/goals/${encodeURIComponent(target.id)}`
    : `/api/sessions/${encodeURIComponent(target.id)}?limit=1`;
  try {
    const response = await apiFetch(apiUrl(path), { signal });
    return response.status === 404 ? 'missing' : 'available';
  } catch (error) {
    if (signal?.aborted) throw error;
    // Only a definitive 404 makes a target stale. Transient gateway or network
    // failures must not disable a link that may still be valid.
    return 'available';
  }
}
