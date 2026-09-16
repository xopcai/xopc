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

/**
 * Move a known session to the top of page 0 in the SWR cache.
 * No-op when cache is empty — caller should `mutate()` to fetch from the server first.
 */
export function upsertSidebarSessionRow(
  mutate: SidebarMutate,
  conversationId: string,
  patch?: { name?: string | null; messageCount?: number },
): void {
  const key = conversationId.trim();
  if (!key) return;

  let missing = false;
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

      if (!existing) { missing = true; return pages; }
      const row: SessionMetadata = {
        ...existing,
        ...(patch?.name !== undefined ? { name: patch.name?.trim() || undefined } : {}),
        ...(patch?.messageCount !== undefined ? { messageCount: patch.messageCount } : {}),
        updatedAt: now,
        lastAccessedAt: now,
      };

      const page0 = stripped[0];
      const restPage0 = page0.items.slice(0, Math.max(0, SIDEBAR_PAGE_SIZE - 1));
      stripped[0] = { ...page0, items: [row, ...restPage0] };
      return stripped;
    },
    { revalidate: false },
  ).then(() => { if (missing) void mutate(); });
}

/** Patch a known row; fetch authoritative metadata when the row is missing. */
export function patchSidebarSessionName(
  mutate: SidebarMutate,
  conversationId: string,
  name: string,
): void {
  const key = conversationId.trim();
  const title = name.trim();
  if (!key || !title) return;

  let missing = false;
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

      missing = true;
      return pages;
    },
    { revalidate: false },
  ).then(() => { if (missing) void mutate(); });
}

/** After list data is loaded, bump the active session to the top (or refresh missing metadata). */
export function bumpSidebarSessionRow(
  mutate: SidebarMutate,
  conversationId: string,
  patch?: { name?: string | null; messageCount?: number },
): void {
  upsertSidebarSessionRow(mutate, conversationId, patch);
}
