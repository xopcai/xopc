import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { sceneContentHash } from './targetContract.js';

// The shipped SQLite seed uses UTC datetime() text; runtime revisions use offset-bearing ISO text.
const time = z.string().transform((value) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value)
  .pipe(z.string().datetime({ offset: true })).transform((value) => Date.parse(value)).pipe(z.number().int().nonnegative());
const ids = z.string().transform((value) => JSON.parse(value) as unknown).pipe(z.array(z.string())).transform((value) => JSON.stringify(value));
const condition = z.string().transform((value) => JSON.parse(value) as unknown).pipe(z.record(z.string(), z.unknown()))
  .transform((value) => { sceneContentHash(value); return JSON.stringify(value); });
const definitionSchema = z.strictObject({
  scenario_key: z.string().min(1), version: z.number().int().positive(), title: z.string(), description: z.string(),
  base_prompt: z.string(), base_template_version: z.number().int().positive(), event_types_json: ids,
  condition_json: condition.nullable(), aggregation: z.enum(['subject', 'project', 'workspace']),
  debounce_seconds: z.number().int().nonnegative(), max_window_seconds: z.number().int().positive(),
  context_provider_ids_json: ids, min_confidence: z.number().min(0).max(1), min_value_score: z.number().min(0).max(1),
  cooldown_seconds: z.number().int().nonnegative(), max_runs_per_day: z.number().int().positive(), created_at: time,
});

/** Preserves definitions and every historical revision privately, without installing executable templates. */
export function convertSceneDefinitions(db: DatabaseSync) {
  const read = (table: string) => {
    const rows = db.prepare(`SELECT * FROM ${table} LIMIT 100001`).all();
    if (rows.length > 100_000) throw new Error(`Definition conversion exceeds reviewed limit: ${table}`);
    return rows;
  };
  const current = read('proactive_scenarios').map((row) => definitionSchema.extend({ updated_at: time }).parse(row));
  const versions = read('proactive_scenario_versions').map((row) => definitionSchema.parse(row));
  const keys = new Set(current.map((row) => row.scenario_key));
  if (versions.some((row) => !keys.has(row.scenario_key))) throw new Error('Definition version has no current definition');
  const versionKeys = new Set(versions.map((row) => JSON.stringify([row.scenario_key, row.version])));
  if (current.some((row) => !versionKeys.has(JSON.stringify([row.scenario_key, row.version])))) throw new Error('Current definition version is missing');
  db.exec('SAVEPOINT scene_definition_conversion');
  try {
    const insert = db.prepare('INSERT INTO scene_definition_history VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [kind, rows] of [['current', current], ['version', versions]] as const) {
      for (const row of rows) insert.run(row.scenario_key, kind, row.version, row.title, row.description, row.base_prompt,
        row.base_template_version, row.event_types_json, row.condition_json, row.aggregation, row.debounce_seconds,
        row.max_window_seconds, row.context_provider_ids_json, row.min_confidence, row.min_value_score, row.cooldown_seconds,
        row.max_runs_per_day, row.created_at, 'updated_at' in row ? Number(row.updated_at) : null);
    }
    db.exec('RELEASE scene_definition_conversion');
    return { definitions: current.length, versions: versions.length };
  } catch (error) {
    db.exec('ROLLBACK TO scene_definition_conversion'); db.exec('RELEASE scene_definition_conversion'); throw error;
  }
}
