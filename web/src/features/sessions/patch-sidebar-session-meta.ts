import type { SessionMetadata } from '@/features/sessions/session.types';

type SidebarPage = {
  items: SessionMetadata[];
  hasMore: boolean;
};

type SidebarMutate = (
  data?: SidebarPage[] | ((pages?: SidebarPage[]) => SidebarPage[] | undefined),
  opts?: { revalidate?: boolean },
) => Promise<SidebarPage[] | undefined>;

const SIDEBAR_PAGE_SIZE = 20;

function webchatPeerIdFromKey(sessionKey: string): string {
  const m = /:direct:([^/]+)$/i.exec(sessionKey.trim());
  return m?.[1]?.toLowerCase() ?? '';
}

function buildSidebarSessionStub(
  key: string,
  patch?: { name?: string | null; messageCount?: number },
): SessionMetadata {
  const now = new Date().toISOString();
  return {
    key,
    name: patch?.name?.trim() || undefined,
    status: 'active',
    tags: [],
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    messageCount: patch?.messageCount ?? 0,
    estimatedTokens: 0,
    compactedCount: 0,
    sourceChannel: 'webchat',
    sourceChatId: webchatPeerIdFromKey(key),
    customData: {},
  };
}

/**
 * Move or insert a session at the top of page 0 in the SWR cache.
 * No-op when cache is empty — caller should `mutate()` to fetch from the server first.
 */
export function upsertSidebarSessionRow(
  mutate: SidebarMutate,
  sessionKey: string,
  patch?: { name?: string | null; messageCount?: number },
): void {
  const key = sessionKey.trim();
  if (!key) return;

  void mutate(
    (pages) => {
      if (!pages?.length || !pages[0]?.items) {
        return pages;
      }

      const now = new Date().toISOString();
      let existing: SessionMetadata | undefined;

      const stripped = pages.map((page) => {
        const kept: SessionMetadata[] = [];
        for (const s of page.items) {
          if (s.key.trim() === key) {
            existing = existing ?? s;
          } else {
            kept.push(s);
          }
        }
        return { ...page, items: kept };
      });

      const row: SessionMetadata = {
        ...(existing ?? buildSidebarSessionStub(key, patch)),
        ...(patch?.name !== undefined ? { name: patch.name?.trim() || undefined } : {}),
        ...(patch?.messageCount !== undefined ? { messageCount: patch.messageCount } : {}),
        updatedAt: now,
        lastAccessedAt: now,
      };

      const page0 = stripped[0]!;
      const restPage0 = page0.items.slice(0, Math.max(0, SIDEBAR_PAGE_SIZE - 1));
      stripped[0] = { ...page0, items: [row, ...restPage0] };
      return stripped;
    },
    { revalidate: false },
  );
}

/** Patch session name in place, or insert a stub at the top when the row is missing. */
export function patchSidebarSessionName(
  mutate: SidebarMutate,
  sessionKey: string,
  name: string,
): void {
  const key = sessionKey.trim();
  const title = name.trim();
  if (!key || !title) return;

  void mutate(
    (pages) => {
      if (!pages?.length || !pages[0]?.items) return pages;

      let found = false;
      let changed = false;
      const next = pages.map((page) => {
        const items = page.items.map((s) => {
          if (s.key.trim() !== key) return s;
          found = true;
          if (s.name?.trim() === title) return s;
          changed = true;
          return { ...s, name: title, updatedAt: new Date().toISOString() };
        });
        return changed ? { ...page, items } : page;
      });

      if (found) {
        return changed ? next : pages;
      }

      const now = new Date().toISOString();
      const row: SessionMetadata = {
        ...buildSidebarSessionStub(key, { name: title }),
        updatedAt: now,
        lastAccessedAt: now,
      };
      const page0 = next[0]!;
      const restPage0 = page0.items.slice(0, Math.max(0, SIDEBAR_PAGE_SIZE - 1));
      next[0] = { ...page0, items: [row, ...restPage0] };
      return next;
    },
    { revalidate: false },
  );
}

/** After list data is loaded, bump the active session to the top (or insert stub). */
export function bumpSidebarSessionRow(
  mutate: SidebarMutate,
  sessionKey: string,
  patch?: { name?: string | null; messageCount?: number },
): void {
  upsertSidebarSessionRow(mutate, sessionKey, patch);
}
