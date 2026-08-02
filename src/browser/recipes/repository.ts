import { getSqliteDatabase, runSqliteWriteTransaction } from '../../storage/sqlite/transaction.js';
import type { BrowserRecipe, BrowserRecipeRun, BrowserRecipeRunEvent } from './types.js';

type RecipeRow = { recipe_id: string; revision: number; name: string; description: string | null; status: BrowserRecipe['status']; yaml_source: string; risk_level: BrowserRecipe['risk']; domains_json: string; created_at_ms: number; updated_at_ms: number };
type RunRow = { run_id: string; recipe_id: string; recipe_revision: number; recipe_yaml: string; status: BrowserRecipeRun['status']; args_json: string; result_json: string | null; error: string | null; created_at_ms: number; started_at_ms: number | null; ended_at_ms: number | null; duration_ms: number | null };
type EventRow = { event_id: string; run_id: string; seq: number; type: string; data_json: string | null; created_at_ms: number };

const RECIPE_SELECT = `SELECT recipe_id, revision, name, description, status, yaml_source, risk_level, domains_json, created_at_ms, updated_at_ms FROM browser_recipes`;
const RUN_SELECT = `SELECT run_id, recipe_id, recipe_revision, recipe_yaml, status, args_json, result_json, error, created_at_ms, started_at_ms, ended_at_ms, duration_ms FROM browser_recipe_runs`;

function recipeFromRow(row: RecipeRow): BrowserRecipe {
  return { id: row.recipe_id, revision: row.revision, name: row.name, description: row.description ?? undefined, status: row.status, yaml: row.yaml_source, risk: row.risk_level, domains: JSON.parse(row.domains_json), createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms };
}

function runFromRow(row: RunRow): BrowserRecipeRun {
  return { id: row.run_id, recipeId: row.recipe_id, recipeRevision: row.recipe_revision, recipeYaml: row.recipe_yaml, status: row.status, args: JSON.parse(row.args_json), result: row.result_json ? JSON.parse(row.result_json) : undefined, error: row.error ?? undefined, createdAtMs: row.created_at_ms, startedAtMs: row.started_at_ms ?? undefined, endedAtMs: row.ended_at_ms ?? undefined, durationMs: row.duration_ms ?? undefined };
}

export function listBrowserRecipes(): BrowserRecipe[] {
  return (getSqliteDatabase().prepare(`${RECIPE_SELECT} ORDER BY updated_at_ms DESC`).all() as RecipeRow[]).map(recipeFromRow);
}

export function getBrowserRecipe(id: string): BrowserRecipe | null {
  const row = getSqliteDatabase().prepare(`${RECIPE_SELECT} WHERE recipe_id = ?`).get(id) as RecipeRow | undefined;
  return row ? recipeFromRow(row) : null;
}

export function saveBrowserRecipe(recipe: BrowserRecipe): void {
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO browser_recipes (recipe_id, revision, name, description, status, yaml_source, risk_level, domains_json, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(recipe_id) DO UPDATE SET revision=excluded.revision, name=excluded.name, description=excluded.description, status=excluded.status, yaml_source=excluded.yaml_source, risk_level=excluded.risk_level, domains_json=excluded.domains_json, updated_at_ms=excluded.updated_at_ms`).run(recipe.id, recipe.revision, recipe.name, recipe.description ?? null, recipe.status, recipe.yaml, recipe.risk, JSON.stringify(recipe.domains), recipe.createdAtMs, recipe.updatedAtMs));
}

export function deleteBrowserRecipe(id: string): boolean {
  return runSqliteWriteTransaction((db) => db.prepare('DELETE FROM browser_recipes WHERE recipe_id = ?').run(id).changes > 0);
}

export function saveBrowserRecipeRun(run: BrowserRecipeRun): void {
  runSqliteWriteTransaction((db) => db.prepare(`INSERT INTO browser_recipe_runs (run_id, recipe_id, recipe_revision, recipe_yaml, status, args_json, result_json, error, created_at_ms, started_at_ms, ended_at_ms, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET status=excluded.status, result_json=excluded.result_json, error=excluded.error, started_at_ms=excluded.started_at_ms, ended_at_ms=excluded.ended_at_ms, duration_ms=excluded.duration_ms`).run(run.id, run.recipeId, run.recipeRevision, run.recipeYaml, run.status, JSON.stringify(run.args), run.result === undefined ? null : JSON.stringify(run.result), run.error ?? null, run.createdAtMs, run.startedAtMs ?? null, run.endedAtMs ?? null, run.durationMs ?? null));
}

export function getBrowserRecipeRun(id: string): BrowserRecipeRun | null {
  const row = getSqliteDatabase().prepare(`${RUN_SELECT} WHERE run_id = ?`).get(id) as RunRow | undefined;
  return row ? runFromRow(row) : null;
}

export function listBrowserRecipeRuns(recipeId?: string): BrowserRecipeRun[] {
  const rows = recipeId
    ? getSqliteDatabase().prepare(`${RUN_SELECT} WHERE recipe_id = ? ORDER BY created_at_ms DESC LIMIT 100`).all(recipeId)
    : getSqliteDatabase().prepare(`${RUN_SELECT} ORDER BY created_at_ms DESC LIMIT 100`).all();
  return (rows as RunRow[]).map(runFromRow);
}

export function hasActiveBrowserRecipeRuns(recipeId: string): boolean {
  return Boolean(getSqliteDatabase().prepare(
    `SELECT 1 FROM browser_recipe_runs WHERE recipe_id = ? AND status IN ('queued', 'running') LIMIT 1`,
  ).get(recipeId));
}

export function listActiveBrowserRecipeRuns(): BrowserRecipeRun[] {
  return (getSqliteDatabase().prepare(
    `${RUN_SELECT} WHERE status IN ('queued', 'running') ORDER BY created_at_ms ASC`,
  ).all() as RunRow[]).map(runFromRow);
}

export function nextBrowserRecipeRunEventSeq(runId: string): number {
  const row = getSqliteDatabase().prepare(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM browser_recipe_run_events WHERE run_id = ?',
  ).get(runId) as { seq: number };
  return row.seq;
}

export function appendBrowserRecipeRunEvent(event: BrowserRecipeRunEvent): void {
  runSqliteWriteTransaction((db) => db.prepare('INSERT INTO browser_recipe_run_events (event_id, run_id, seq, type, data_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?)').run(event.id, event.runId, event.seq, event.type, event.data === undefined ? null : JSON.stringify(event.data), event.createdAtMs));
}

export function listBrowserRecipeRunEvents(runId: string): BrowserRecipeRunEvent[] {
  const rows = getSqliteDatabase().prepare('SELECT event_id, run_id, seq, type, data_json, created_at_ms FROM browser_recipe_run_events WHERE run_id = ? ORDER BY seq ASC').all(runId) as EventRow[];
  return rows.map((row) => ({ id: row.event_id, runId: row.run_id, seq: row.seq, type: row.type, data: row.data_json ? JSON.parse(row.data_json) : undefined, createdAtMs: row.created_at_ms }));
}
