import { USER_CONTEXT_PRINCIPAL_ID } from '../../user-context/domain.js';
import { getSqliteDatabase } from './transaction.js';

export type RemoteContextKind = 'understanding' | 'focus';

/** Check all provenance, including older evidence, without loading private excerpts. */
export function remoteContextEligibleIds(kind: RemoteContextKind, ids: string[]): Set<string> {
  if (!ids.length) return new Set();
  if (ids.length > 200) throw new Error('Context candidate limit exceeded');
  const focus = kind === 'focus';
  const table = focus ? 'user_focuses' : 'user_understandings';
  const versions = focus ? 'user_focus_versions' : 'user_understanding_versions';
  const links = focus ? 'user_focus_evidence_links' : 'understanding_evidence_links';
  const id = focus ? 'focus_id' : 'understanding_id';
  const rows = getSqliteDatabase().prepare(`
    SELECT u.${id} AS id, v.created_by, u.explicitness,
      COUNT(e.evidence_id) AS evidence_count,
      MAX(CASE WHEN e.evidence_id IS NOT NULL AND (
        (e.processing_policy IS NOT NULL AND e.processing_policy <> 'remote_allowed')
        OR e.trust_level = 'untrusted' OR e.principal_id <> u.principal_id
        OR (e.source_run_id IS NOT NULL AND (g.grant_id IS NULL OR g.status <> 'active' OR g.processing_policy <> 'remote_allowed'))
        OR (e.source_type = 'connector' AND (e.processing_policy IS NULL OR e.source_run_id IS NULL))
        OR (e.processing_policy IS NULL AND e.source_type <> 'user' AND e.trust_level <> 'owner')
      ) THEN 1 ELSE 0 END) AS blocked
    FROM ${table} u
    JOIN ${versions} v ON v.version_id = u.current_version_id
    LEFT JOIN ${versions} history ON history.${id} = u.${id}
    LEFT JOIN ${links} l ON l.version_id = history.version_id
    LEFT JOIN context_evidence e ON e.evidence_id = l.evidence_id
    LEFT JOIN understanding_source_runs r ON r.run_id = e.source_run_id
    LEFT JOIN understanding_source_grants g ON g.grant_id = r.grant_id
    WHERE u.principal_id = ? AND u.${id} IN (${ids.map(() => '?').join(',')})
    ${focus ? `AND (u.source_run_id IS NULL OR EXISTS (
      SELECT 1 FROM understanding_source_runs fr JOIN understanding_source_grants fg ON fg.grant_id = fr.grant_id
      WHERE fr.run_id = u.source_run_id AND fg.status = 'active' AND fg.processing_policy = 'remote_allowed'
    ))` : ''}
    GROUP BY u.${id}
  `).all(USER_CONTEXT_PRINCIPAL_ID, ...ids) as Array<{ id: string; created_by: string; explicitness: string; evidence_count: number; blocked: number }>;
  return new Set(rows.filter((row) => !row.blocked && (row.evidence_count > 0
    || (row.explicitness === 'explicit' && row.created_by === 'user'))).map((row) => row.id));
}
