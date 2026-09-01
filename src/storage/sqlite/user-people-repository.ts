import { USER_CONTEXT_PRINCIPAL_ID } from '../../user-context/domain.js';
import type {
  UserPerson,
  UserPersonHandle,
  UserPersonIndexEntry,
  UserPersonKind,
  UserPersonSource,
  UserRelationshipSummary,
} from '../../user-context/relationships/types.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

type PersonRow = {
  person_id: string;
  display_name: string;
  user_display_name: string | null;
  inferred_kind: UserPersonKind;
  user_kind: UserPersonKind | null;
  hidden: number;
  confidence: number;
  first_observed_at: number;
  last_observed_at: number;
};

type HandleRow = {
  handle_id: string;
  handle_type: UserPersonHandle['type'];
  display_value: string;
  source_instance_id: string;
  verification: UserPersonHandle['verification'];
  first_observed_at: number;
  last_observed_at: number;
};

type SourceRow = {
  source_instance_id: string;
  interaction_count: number;
  first_observed_at: number;
  last_observed_at: number;
};

function sourceMetadata(sourceInstanceId: string): Pick<UserPersonSource, 'connectorId' | 'toolkit'> {
  if (!sourceInstanceId.startsWith('composio:')) return {};
  const connectorId = sourceInstanceId.split(':')[1];
  if (!connectorId) return {};
  return { connectorId, toolkit: connectorId.replace(/^composio-/, '') };
}

function handlesFor(personId: string): UserPersonHandle[] {
  const rows = getSqliteDatabase().prepare(`SELECT handle_id, handle_type, display_value,
    source_instance_id, verification, first_observed_at, last_observed_at
    FROM user_person_handles WHERE person_id = ?
    ORDER BY CASE handle_type WHEN 'email' THEN 0 WHEN 'provider_user' THEN 1 WHEN 'username' THEN 2 ELSE 3 END,
      last_observed_at DESC`).all(personId) as HandleRow[];
  return rows.map((row) => ({
    id: row.handle_id,
    type: row.handle_type,
    value: row.display_value,
    sourceInstanceId: row.source_instance_id,
    verification: row.verification,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
  }));
}

function sourcesFor(personId: string): UserPersonSource[] {
  const rows = getSqliteDatabase().prepare(`SELECT source_instance_id, interaction_count,
    first_observed_at, last_observed_at FROM user_person_source_stats
    WHERE person_id = ? ORDER BY last_observed_at DESC`).all(personId) as SourceRow[];
  return rows.map((row) => ({
    sourceInstanceId: row.source_instance_id,
    ...sourceMetadata(row.source_instance_id),
    interactionCount: row.interaction_count,
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
  }));
}

function fromRow(row: PersonRow, includeDetails = false): UserPerson {
  const handles = handlesFor(row.person_id);
  const sources = sourcesFor(row.person_id);
  const primaryHandle = handles.find((handle) => handle.type === 'email')?.value
    ?? handles.find((handle) => handle.type === 'provider_user' || handle.type === 'username')?.value;
  return {
    id: row.person_id,
    displayName: row.user_display_name ?? row.display_name,
    kind: row.user_kind ?? row.inferred_kind,
    hidden: row.hidden === 1,
    confidence: row.confidence,
    ...(primaryHandle ? { primaryHandle } : {}),
    interactionCount: sources.reduce((total, source) => total + source.interactionCount, 0),
    firstObservedAt: row.first_observed_at,
    lastObservedAt: row.last_observed_at,
    handles: includeDetails ? handles : [],
    sources,
  };
}

export function replaceUserPeopleIndex(
  entries: UserPersonIndexEntry[],
  revision: { sourceChangeSequence: number; sourceGrantsUpdatedAt: number },
  principalId = USER_CONTEXT_PRINCIPAL_ID,
  nowMs = Date.now(),
): void {
  runSqliteWriteTransaction((db) => {
    const mergedRows = db.prepare(`SELECT person_id, merged_into_person_id FROM user_people
      WHERE principal_id = ? AND merged_into_person_id IS NOT NULL`)
      .all(principalId) as Array<{ person_id: string; merged_into_person_id: string }>;
    const mergedTargets = new Map(mergedRows.map((row) => [row.person_id, row.merged_into_person_id]));
    const targetFor = (personId: string): string => {
      const seen = new Set<string>();
      let current = personId;
      while (mergedTargets.has(current) && !seen.has(current)) {
        seen.add(current);
        current = mergedTargets.get(current)!;
      }
      return current;
    };
    db.prepare(`DELETE FROM user_person_source_stats
      WHERE person_id IN (SELECT person_id FROM user_people WHERE principal_id = ?)`)
      .run(principalId);
    db.prepare(`DELETE FROM user_person_handles
      WHERE person_id IN (SELECT person_id FROM user_people WHERE principal_id = ?)
        AND verification != 'user_confirmed'`)
      .run(principalId);

    for (const entry of entries) {
      const personId = targetFor(entry.id);
      if (personId === entry.id) db.prepare(`INSERT INTO user_people (
        person_id, principal_id, display_name, inferred_kind, confidence,
        first_observed_at, last_observed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(person_id) DO UPDATE SET
        display_name = excluded.display_name,
        inferred_kind = excluded.inferred_kind,
        confidence = excluded.confidence,
        first_observed_at = MIN(user_people.first_observed_at, excluded.first_observed_at),
        last_observed_at = excluded.last_observed_at,
        updated_at = excluded.updated_at`)
        .run(
          entry.id, principalId, entry.displayName, entry.inferredKind, entry.confidence,
          entry.firstObservedAt, entry.lastObservedAt, nowMs, nowMs,
        );
      for (const handle of entry.handles) {
        db.prepare(`INSERT INTO user_person_handles (
          handle_id, person_id, handle_type, normalized_value, display_value,
          source_instance_id, verification, first_observed_at, last_observed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(handle_type, normalized_value, source_instance_id) DO UPDATE SET
          person_id = excluded.person_id,
          display_value = excluded.display_value,
          verification = CASE WHEN user_person_handles.verification = 'user_confirmed'
            THEN 'user_confirmed' ELSE excluded.verification END,
          first_observed_at = MIN(user_person_handles.first_observed_at, excluded.first_observed_at),
          last_observed_at = excluded.last_observed_at,
          updated_at = excluded.updated_at`)
          .run(
            handle.id, personId, handle.type, handle.value.toLocaleLowerCase(), handle.value,
            handle.sourceInstanceId, handle.verification, handle.firstObservedAt,
            handle.lastObservedAt, nowMs, nowMs,
          );
      }
      for (const source of entry.sources) {
        db.prepare(`INSERT INTO user_person_source_stats (
          person_id, source_instance_id, interaction_count, first_observed_at,
          last_observed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(person_id, source_instance_id) DO UPDATE SET
          interaction_count = user_person_source_stats.interaction_count + excluded.interaction_count,
          first_observed_at = MIN(user_person_source_stats.first_observed_at, excluded.first_observed_at),
          last_observed_at = MAX(user_person_source_stats.last_observed_at, excluded.last_observed_at),
          updated_at = excluded.updated_at`)
          .run(
            personId, source.sourceInstanceId, source.interactionCount,
            source.firstObservedAt, source.lastObservedAt, nowMs,
          );
      }
    }

    db.prepare(`DELETE FROM user_people
      WHERE principal_id = ? AND merged_into_person_id IS NULL AND hidden = 0
        AND user_display_name IS NULL AND user_kind IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_person_source_stats s WHERE s.person_id = user_people.person_id)
        AND NOT EXISTS (SELECT 1 FROM user_person_handles h WHERE h.person_id = user_people.person_id)`)
      .run(principalId);
    db.prepare(`INSERT INTO user_people_index_state (
      principal_id, source_change_sequence, source_grants_updated_at, rebuilt_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(principal_id) DO UPDATE SET
      source_change_sequence = excluded.source_change_sequence,
      source_grants_updated_at = excluded.source_grants_updated_at,
      rebuilt_at = excluded.rebuilt_at`)
      .run(principalId, revision.sourceChangeSequence, revision.sourceGrantsUpdatedAt, nowMs);
  });
}

export function getUserPeopleIndexState(principalId = USER_CONTEXT_PRINCIPAL_ID): {
  sourceChangeSequence: number;
  sourceGrantsUpdatedAt: number;
  rebuiltAt: number;
} | null {
  const row = getSqliteDatabase().prepare(`SELECT source_change_sequence, source_grants_updated_at, rebuilt_at
    FROM user_people_index_state WHERE principal_id = ?`).get(principalId) as {
      source_change_sequence: number;
      source_grants_updated_at: number;
      rebuilt_at: number;
    } | undefined;
  return row ? {
    sourceChangeSequence: row.source_change_sequence,
    sourceGrantsUpdatedAt: row.source_grants_updated_at,
    rebuiltAt: row.rebuilt_at,
  } : null;
}

export function listUserPeople(options: {
  query?: string;
  kind?: UserPersonKind;
  sourceInstanceId?: string;
  includeHidden?: boolean;
  hiddenOnly?: boolean;
  offset?: number;
  limit?: number;
  principalId?: string;
} = {}): { items: UserPerson[]; total: number; nextOffset?: number } {
  const principalId = options.principalId ?? USER_CONTEXT_PRINCIPAL_ID;
  const clauses = [
    'p.principal_id = ?',
    'p.merged_into_person_id IS NULL',
    'EXISTS (SELECT 1 FROM user_person_source_stats active_source WHERE active_source.person_id = p.person_id)',
  ];
  const params: Array<string | number> = [principalId];
  if (options.hiddenOnly) clauses.push('p.hidden = 1');
  else if (!options.includeHidden) clauses.push('p.hidden = 0');
  if (options.kind) {
    clauses.push('COALESCE(p.user_kind, p.inferred_kind) = ?');
    params.push(options.kind);
  }
  if (options.sourceInstanceId) {
    clauses.push('EXISTS (SELECT 1 FROM user_person_source_stats filtered_source WHERE filtered_source.person_id = p.person_id AND filtered_source.source_instance_id = ?)');
    params.push(options.sourceInstanceId);
  }
  const query = options.query?.trim().toLocaleLowerCase();
  if (query) {
    clauses.push(`(LOWER(COALESCE(p.user_display_name, p.display_name)) LIKE ? OR EXISTS (
      SELECT 1 FROM user_person_handles search_handle
      WHERE search_handle.person_id = p.person_id AND search_handle.normalized_value LIKE ?
    ))`);
    params.push(`%${query}%`, `%${query}%`);
  }
  const where = clauses.join(' AND ');
  const total = Number((getSqliteDatabase().prepare(`SELECT COUNT(*) AS count FROM user_people p WHERE ${where}`)
    .get(...params) as { count: number }).count);
  const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 30)));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const rows = getSqliteDatabase().prepare(`SELECT p.* FROM user_people p WHERE ${where}
    ORDER BY p.last_observed_at DESC, COALESCE(p.user_display_name, p.display_name) ASC
    LIMIT ? OFFSET ?`).all(...params, limit, offset) as PersonRow[];
  return {
    items: rows.map((row) => fromRow(row)),
    total,
    ...(offset + rows.length < total ? { nextOffset: offset + rows.length } : {}),
  };
}

export function getUserPerson(personId: string, principalId = USER_CONTEXT_PRINCIPAL_ID): UserPerson | null {
  const row = getSqliteDatabase().prepare(`SELECT * FROM user_people
    WHERE person_id = ? AND principal_id = ? AND merged_into_person_id IS NULL`)
    .get(personId, principalId) as PersonRow | undefined;
  return row ? fromRow(row, true) : null;
}

export function updateUserPerson(personId: string, patch: {
  displayName?: string | null;
  kind?: UserPersonKind | null;
  hidden?: boolean;
}, principalId = USER_CONTEXT_PRINCIPAL_ID): UserPerson | null {
  const current = getUserPerson(personId, principalId);
  if (!current) return null;
  runSqliteWriteTransaction((db) => db.prepare(`UPDATE user_people SET
    user_display_name = ?, user_kind = ?, hidden = ?, updated_at = ?
    WHERE person_id = ? AND principal_id = ?`).run(
    patch.displayName === undefined ? getUserDisplayName(personId) : patch.displayName,
    patch.kind === undefined ? getUserKind(personId) : patch.kind,
    patch.hidden === undefined ? Number(current.hidden) : Number(patch.hidden),
    Date.now(), personId, principalId,
  ));
  return getUserPerson(personId, principalId);
}

function getUserDisplayName(personId: string): string | null {
  return (getSqliteDatabase().prepare('SELECT user_display_name AS value FROM user_people WHERE person_id = ?')
    .get(personId) as { value: string | null } | undefined)?.value ?? null;
}

function getUserKind(personId: string): UserPersonKind | null {
  return (getSqliteDatabase().prepare('SELECT user_kind AS value FROM user_people WHERE person_id = ?')
    .get(personId) as { value: UserPersonKind | null } | undefined)?.value ?? null;
}

export function summarizeUserPeople(principalId = USER_CONTEXT_PRINCIPAL_ID): UserRelationshipSummary {
  const row = getSqliteDatabase().prepare(`SELECT
    SUM(CASE WHEN hidden = 0 AND COALESCE(user_kind, inferred_kind) = 'person' THEN 1 ELSE 0 END) AS people,
    SUM(CASE WHEN hidden = 0 AND COALESCE(user_kind, inferred_kind) IN ('bot', 'service', 'group') THEN 1 ELSE 0 END) AS automated,
    SUM(CASE WHEN hidden = 0 AND COALESCE(user_kind, inferred_kind) = 'unknown' THEN 1 ELSE 0 END) AS needs_review,
    SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden,
    MAX(last_observed_at) AS last_updated_at
    FROM user_people p WHERE principal_id = ? AND merged_into_person_id IS NULL
      AND EXISTS (SELECT 1 FROM user_person_source_stats s WHERE s.person_id = p.person_id)`)
    .get(principalId) as { people: number | null; automated: number | null; needs_review: number | null; hidden: number | null; last_updated_at: number | null };
  const sources = Number((getSqliteDatabase().prepare(`SELECT COUNT(DISTINCT source_instance_id) AS count
    FROM user_person_source_stats s JOIN user_people p ON p.person_id = s.person_id
    WHERE p.principal_id = ? AND p.merged_into_person_id IS NULL`).get(principalId) as { count: number }).count);
  return {
    people: Number(row.people ?? 0),
    automatedAccounts: Number(row.automated ?? 0),
    needsReview: Number(row.needs_review ?? 0),
    hidden: Number(row.hidden ?? 0),
    sources,
    ...(row.last_updated_at == null ? {} : { lastUpdatedAt: row.last_updated_at }),
  };
}

export function mergeUserPeople(
  sourcePersonId: string,
  targetPersonId: string,
  principalId = USER_CONTEXT_PRINCIPAL_ID,
): UserPerson | null {
  if (sourcePersonId === targetPersonId) return getUserPerson(targetPersonId, principalId);
  const source = getUserPerson(sourcePersonId, principalId);
  const target = getUserPerson(targetPersonId, principalId);
  if (!source || !target) return null;
  runSqliteWriteTransaction((db) => {
    const duplicateHandles = db.prepare(`SELECT source.handle_id FROM user_person_handles source
      JOIN user_person_handles target
        ON target.person_id = ? AND target.handle_type = source.handle_type
        AND target.normalized_value = source.normalized_value
        AND target.source_instance_id = source.source_instance_id
      WHERE source.person_id = ?`).all(targetPersonId, sourcePersonId) as Array<{ handle_id: string }>;
    for (const duplicate of duplicateHandles) db.prepare('DELETE FROM user_person_handles WHERE handle_id = ?').run(duplicate.handle_id);
    db.prepare('UPDATE user_person_handles SET person_id = ?, updated_at = ? WHERE person_id = ?')
      .run(targetPersonId, Date.now(), sourcePersonId);
    const sourceStats = db.prepare('SELECT * FROM user_person_source_stats WHERE person_id = ?')
      .all(sourcePersonId) as Array<SourceRow & { last_source_item_id: string | null }>;
    for (const stat of sourceStats) {
      db.prepare(`INSERT INTO user_person_source_stats (
        person_id, source_instance_id, interaction_count, first_observed_at,
        last_observed_at, last_source_item_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(person_id, source_instance_id) DO UPDATE SET
        interaction_count = user_person_source_stats.interaction_count + excluded.interaction_count,
        first_observed_at = MIN(user_person_source_stats.first_observed_at, excluded.first_observed_at),
        last_observed_at = MAX(user_person_source_stats.last_observed_at, excluded.last_observed_at),
        last_source_item_id = CASE WHEN excluded.last_observed_at >= user_person_source_stats.last_observed_at
          THEN excluded.last_source_item_id ELSE user_person_source_stats.last_source_item_id END,
        updated_at = excluded.updated_at`).run(
        targetPersonId, stat.source_instance_id, stat.interaction_count,
        stat.first_observed_at, stat.last_observed_at, stat.last_source_item_id, Date.now(),
      );
    }
    db.prepare('DELETE FROM user_person_source_stats WHERE person_id = ?').run(sourcePersonId);
    db.prepare(`UPDATE user_people SET merged_into_person_id = ?, updated_at = ?
      WHERE person_id = ? AND principal_id = ?`).run(targetPersonId, Date.now(), sourcePersonId, principalId);
  });
  return getUserPerson(targetPersonId, principalId);
}
