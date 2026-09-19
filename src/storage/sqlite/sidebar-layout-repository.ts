import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type SidebarLayout = {
  containerId: string;
  itemIds: string[];
  revision: number;
};

export class SidebarLayoutConflictError extends Error {
  constructor(readonly current: SidebarLayout) {
    super('Sidebar layout changed in another window');
    this.name = 'SidebarLayoutConflictError';
  }
}

export function getSidebarLayout(containerId: string): SidebarLayout {
  const db = getSqliteDatabase();
  const row = db.prepare('SELECT revision FROM sidebar_layouts WHERE container_id = ?').get(containerId) as
    | { revision: number }
    | undefined;
  const positions = db
    .prepare('SELECT item_id FROM sidebar_positions WHERE container_id = ? ORDER BY position ASC')
    .all(containerId) as Array<{ item_id: string }>;
  return { containerId, itemIds: positions.map((position) => position.item_id), revision: row?.revision ?? 0 };
}

export function replaceSidebarLayout(
  containerId: string,
  itemIds: string[],
  expectedRevision: number,
): SidebarLayout {
  return runSqliteWriteTransaction((db) => {
    const current = getSidebarLayout(containerId);
    if (current.revision !== expectedRevision) throw new SidebarLayoutConflictError(current);

    const uniqueItemIds = [...new Set(itemIds)];
    const nextRevision = current.revision + 1;
    db.prepare(
      `INSERT INTO sidebar_layouts (container_id, revision, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(container_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
    ).run(containerId, nextRevision, Date.now());
    db.prepare('DELETE FROM sidebar_positions WHERE container_id = ?').run(containerId);
    const insert = db.prepare(
      'INSERT INTO sidebar_positions (container_id, item_id, position) VALUES (?, ?, ?)',
    );
    uniqueItemIds.forEach((itemId, position) => insert.run(containerId, itemId, position));
    return { containerId, itemIds: uniqueItemIds, revision: nextRevision };
  });
}

export function sortBySidebarLayout<T>(items: T[], layout: SidebarLayout, idOf: (item: T) => string): T[] {
  if (layout.itemIds.length === 0) return items;
  const ranks = new Map(layout.itemIds.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index, rank: ranks.get(idOf(item)) }))
    .sort((a, b) => {
      if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank;
      if (a.rank !== undefined) return 1;
      if (b.rank !== undefined) return -1;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
