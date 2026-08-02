import { LOCAL_USER_ID } from '../../user-context/owner.js';
import { getSqliteDatabase, runSqliteWriteTransaction } from './transaction.js';

export type SupportMode = 'efficient' | 'coach' | 'companion' | 'auto';

export interface RelationshipSettings {
  supportMode: SupportMode;
  proactiveEnabled: boolean;
  quietStart?: string;
  quietEnd?: string;
  allowedTopics: string[];
  blockedTopics: string[];
  updatedAt: number;
}

type RelationshipSettingsRow = {
  support_mode: SupportMode;
  proactive_enabled: number;
  quiet_start: string | null;
  quiet_end: string | null;
  allowed_topics_json: string;
  blocked_topics_json: string;
  updated_at: number;
};

function fromRow(row: RelationshipSettingsRow): RelationshipSettings {
  return {
    supportMode: row.support_mode,
    proactiveEnabled: row.proactive_enabled === 1,
    ...(row.quiet_start ? { quietStart: row.quiet_start } : {}),
    ...(row.quiet_end ? { quietEnd: row.quiet_end } : {}),
    allowedTopics: JSON.parse(row.allowed_topics_json) as string[],
    blockedTopics: JSON.parse(row.blocked_topics_json) as string[],
    updatedAt: row.updated_at,
  };
}

export function getRelationshipSettings(): RelationshipSettings {
  const row = getSqliteDatabase()
    .prepare(
      `SELECT support_mode, proactive_enabled, quiet_start, quiet_end,
              allowed_topics_json, blocked_topics_json, updated_at
       FROM relationship_settings WHERE owner_id = ?`,
    )
    .get(LOCAL_USER_ID) as RelationshipSettingsRow;
  return fromRow(row);
}

export function updateRelationshipSettings(
  patch: Partial<Omit<RelationshipSettings, 'updatedAt'>>,
): RelationshipSettings {
  const current = getRelationshipSettings();
  const next = { ...current, ...patch, updatedAt: Date.now() };
  runSqliteWriteTransaction((db) => {
    db.prepare(
      `UPDATE relationship_settings
       SET support_mode = ?, proactive_enabled = ?, quiet_start = ?, quiet_end = ?,
           allowed_topics_json = ?, blocked_topics_json = ?, updated_at = ?
       WHERE owner_id = ?`,
    ).run(
      next.supportMode,
      Number(next.proactiveEnabled),
      next.quietStart ?? null,
      next.quietEnd ?? null,
      JSON.stringify(next.allowedTopics),
      JSON.stringify(next.blockedTopics),
      next.updatedAt,
      LOCAL_USER_ID,
    );
  });
  return next;
}

export function buildRelationshipPrompt(settings: RelationshipSettings): string {
  const modeGuidance: Record<SupportMode, string> = {
    efficient: 'Prioritize direct action and concise answers. Acknowledge emotion briefly only when it materially helps.',
    coach: 'Help the user clarify goals and move forward. Ask focused questions and turn reflection into practical next steps.',
    companion: 'Acknowledge the user’s experience before offering solutions. Do not rush advice; ask whether they want listening or action when unclear.',
    auto: 'Infer whether the user needs listening, validation, analysis, advice, or action. Ask one concise question when the need is ambiguous.',
  };
  return [
    '## Support mode',
    modeGuidance[settings.supportMode],
    'Never claim to have human feelings, encourage exclusivity or dependency, use guilt, or present yourself as a replacement for human relationships or professional care.',
    'Treat inferred emotions as hypotheses, not facts. In high-risk situations, encourage timely support from trusted people or appropriate emergency/professional services.',
  ].join('\n\n');
}

export function isProactiveSupportAllowed(
  settings: RelationshipSettings,
  input: { now: Date; topic: string },
): boolean {
  if (!settings.proactiveEnabled) return false;
  const topic = input.topic.trim().toLocaleLowerCase();
  const blocked = settings.blockedTopics.map((value) => value.toLocaleLowerCase());
  if (blocked.includes(topic)) return false;
  const allowed = settings.allowedTopics.map((value) => value.toLocaleLowerCase());
  if (allowed.length > 0 && !allowed.includes(topic)) return false;
  if (!settings.quietStart || !settings.quietEnd) return true;
  const minutes = input.now.getHours() * 60 + input.now.getMinutes();
  const toMinutes = (value: string) => {
    const [hours, minute] = value.split(':').map(Number);
    return hours! * 60 + minute!;
  };
  const start = toMinutes(settings.quietStart);
  const end = toMinutes(settings.quietEnd);
  const inQuietHours = start <= end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
  return !inQuietHours;
}
