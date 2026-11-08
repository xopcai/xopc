import { getSqliteDatabase } from '../storage/sqlite/transaction.js';
import { searchSessionTranscript } from '../storage/sqlite/transcript-repository.js';
import { getSessionInteractionPolicy } from '../agent/session/interaction-policy.js';
import { commandRegistry, type CommandResult } from '../agent/commands/command-registry.js';
import { buildReviewDiffBundle, resolveGitRoot } from '../review/review-git.js';

export type TuiJob = Pick<CommandResult, 'id' | 'command' | 'cwd' | 'status' | 'exitCode' | 'durationMs' | 'aggregatedOutput' | 'tty' | 'cols' | 'rows' | 'outputLength'>;

function projectJob(job: CommandResult): TuiJob {
  return { id: job.id, command: job.command, cwd: job.cwd, status: job.status,
    tty: job.tty, cols: job.cols, rows: job.rows, outputLength: job.outputLength, exitCode: job.exitCode, durationMs: job.durationMs, aggregatedOutput: job.aggregatedOutput.slice(-8000) };
}

export function listTuiJobs(conversationId: string): TuiJob[] {
  return commandRegistry().list(conversationId).map(projectJob);
}

export function getTuiJob(conversationId: string, id: string): TuiJob {
  const job = commandRegistry().get(conversationId, id);
  if (!job) throw new Error('Background job not found in this conversation.');
  return projectJob(job);
}

export async function stopTuiJob(conversationId: string, id: string): Promise<void> {
  const job = await commandRegistry().cancel(conversationId, id);
  if (!job) throw new Error('Background job not found in this conversation.');
}

export function writeTuiJob(conversationId: string, id: string, text: string): void {
  const policy = getSessionInteractionPolicy(conversationId);
  if ((policy.mode === 'plan' || policy.access === 'read-only') && commandRegistry().get(conversationId, id)?.sandbox !== 'read-only') throw new Error('Process input requires a job started inside the read-only OS sandbox.');
  if (!commandRegistry().write(conversationId, id, text)) throw new Error('Background job is unavailable or its input is closed.');
}

export async function getTuiWorkspaceDiff(workspace: string): Promise<string> {
  const bundle = await buildReviewDiffBundle(await resolveGitRoot(workspace), { kind: 'uncommitted' });
  if (!bundle.diff) return 'Working tree is clean.';
  return bundle.diff.length > 1_000_000 ? `${bundle.diff.slice(0, 1_000_000)}\n[Diff preview truncated; inspect the full working tree with Git.]` : bundle.diff;
}

export function resizeTuiJob(conversationId: string, id: string, cols: number, rows: number): void {
  if (!commandRegistry().resize(conversationId, id, cols, rows)) throw new Error("Terminal job is unavailable in this conversation.");
}

export interface TuiHistoryMatch { rowNumber: number; role: string; preview: string }

export function searchTuiHistory(conversationId: string, query: string): TuiHistoryMatch[] {
  if (!query.trim() || query.length > 1000) throw new Error('Search needs 1–1000 characters.');
  const matches = searchSessionTranscript(conversationId, query, { limit: 20, matchMode: 'phrase' });
  if (!matches.length) return [];
  const rows = getSqliteDatabase().prepare(`WITH ordered AS (
    SELECT e.entry_id, ROW_NUMBER() OVER (ORDER BY t.created_at, t.rowid, e.seq) AS rowNumber
    FROM transcript_entries e JOIN transcripts t ON t.transcript_id = e.transcript_id
    WHERE t.conversation_id = ? AND (t.status = 'active' OR t.archive_reason IN ('reset', 'stale'))
  ) SELECT entry_id, rowNumber FROM ordered WHERE entry_id IN (${matches.map(() => '?').join(',')})`)
    .all(conversationId, ...matches.map(match => match.entryId)) as Array<{ entry_id: string; rowNumber: number }>;
  const positions = new Map(rows.map(row => [row.entry_id, row.rowNumber]));
  return matches.filter(match => positions.has(match.entryId)).map(match => ({ rowNumber: positions.get(match.entryId)!, role: match.role ?? 'context', preview: match.content.slice(0, 400) }));
}
