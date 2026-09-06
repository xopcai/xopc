import {
  fileResourceArtifactUri,
  mergeTurnOutcomeDeliverables,
  parseProductDeliveryEnvelope,
  parseTurnOutcome,
  TurnOutcomeDeliverableSchema,
  turnOutcomeKindFromFileName,
  turnOutcomeMimeTypeFromFileName,
  type ProductReference,
  type TurnOutcome,
  type TurnOutcomeChangedFile,
  type TurnOutcomeDeliverable,
  type TurnOutcomeEvidence,
} from '@xopcai/gateway-contract';

import { parseFileResourceId } from '../files/file-service.js';
import type { TranscriptStoredRow } from './session-context-for-llm.js';

const MAX_OUTCOME_DIFF_CHARS = 200_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fileStatus(kind: unknown): TurnOutcomeChangedFile['status'] {
  if (kind === 'add') return 'added';
  if (kind === 'delete') return 'deleted';
  if (kind === 'move') return 'renamed';
  if (kind === 'update') return 'modified';
  return undefined;
}

function fileDeliverable(
  reference: ProductReference,
  failed: boolean,
): TurnOutcomeDeliverable | null {
  if (reference.kind !== 'file') return null;
  let workspaceRelativePath: string | undefined;
  let managedFile = false;
  try {
    workspaceRelativePath = parseFileResourceId(reference.id).relativePath;
    managedFile = true;
  } catch {
    // File producers may use an opaque resource id.
  }
  const mimeType = turnOutcomeMimeTypeFromFileName(reference.title);
  const available = !failed && managedFile;
  return {
    artifactId: reference.id,
    ...(managedFile ? { sourceFileId: reference.id } : {}),
    title: reference.title,
    kind: turnOutcomeKindFromFileName(reference.title),
    ...(mimeType ? { mimeType } : {}),
    availability: failed ? 'failed' : available ? 'available' : 'missing',
    location: managedFile ? 'workspace' : 'external_host',
    capabilities: !available
      ? ['regenerate']
      : [
          ...(reference.capabilities.includes('preview') ? ['preview' as const] : []),
          'download',
          ...(reference.capabilities.includes('share') ? ['share' as const] : []),
        ],
    ...(available ? { uri: fileResourceArtifactUri(reference.id) } : {}),
    ...(workspaceRelativePath ? { workspaceRelativePath } : {}),
  };
}

function mediaDeliverables(details: Record<string, unknown>): TurnOutcomeDeliverable[] {
  if (!Array.isArray(details.media)) return [];
  return details.media.flatMap((value): TurnOutcomeDeliverable[] => {
    const media = record(value);
    const uri = text(media?.uri);
    if (!uri) return [];
    const artifactId = text(media?.id) ?? uri;
    const title = text(media?.name) ?? 'Generated file';
    const rawType = text(media?.type);
    const kind = rawType === 'photo' || rawType === 'image'
      ? 'image'
      : rawType === 'video'
        ? 'video'
        : rawType === 'audio' || rawType === 'voice'
          ? 'audio'
          : turnOutcomeKindFromFileName(title);
    return [{
      artifactId,
      title,
      kind,
      ...(text(media?.mimeType) ? { mimeType: text(media?.mimeType) } : {}),
      ...(typeof media?.size === 'number' && media.size >= 0 ? { sizeBytes: media.size } : {}),
      availability: 'available',
      location: 'artifact_store',
      capabilities: kind === 'archive' || kind === 'file' ? ['download'] : ['preview', 'download'],
      uri,
    }];
  });
}

export function projectTurnOutcome(params: {
  rows: readonly TranscriptStoredRow[];
  turnId: string;
  runStatus?: 'success' | 'cancelled' | 'error';
  summary?: string;
}): TurnOutcome {
  const deliverables = new Map<string, TurnOutcomeDeliverable>();
  const files = new Map<string, TurnOutcomeChangedFile>();
  const evidence = new Map<string, TurnOutcomeEvidence>();
  const diffs: string[] = [];
  let added = 0;
  let removed = 0;
  let failedToolCount = 0;
  let createdAtMs = 0;
  let verificationSummary: Record<string, unknown> | null = null;

  for (const source of params.rows) {
    const row = source as TranscriptStoredRow & Record<string, unknown>;
    if (row.turnId !== params.turnId) continue;
    if (row.type === 'custom' && row.customType === 'coding_verification') {
      verificationSummary = record(row.data);
    }
    const timestamp = typeof row.timestamp === 'number'
      ? row.timestamp
      : Date.parse(typeof row.timestamp === 'string' ? row.timestamp : '');
    if (Number.isFinite(timestamp)) createdAtMs = Math.max(createdAtMs, timestamp);
    if (row.role !== 'toolResult' && row.role !== 'tool') continue;
    const details = record(row.details) ?? {};
    if (row.isError === true && record(details.verification)?.kind !== 'check') failedToolCount += 1;
    const explicit = Array.isArray(details.artifacts)
      ? details.artifacts.flatMap((value): TurnOutcomeDeliverable[] => {
          const parsed = TurnOutcomeDeliverableSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    for (const item of explicit) deliverables.set(item.artifactId, item);

    const delivery = parseProductDeliveryEnvelope(details.delivery);
    if (delivery) {
      for (const reference of [delivery.primary, ...(delivery.related ?? [])]) {
        if (!reference) continue;
        const item = fileDeliverable(reference, delivery.operation === 'failed');
        if (item) deliverables.set(item.artifactId, item);
      }
    }
    for (const item of mediaDeliverables(details)) {
      if (!deliverables.has(item.artifactId)) deliverables.set(item.artifactId, item);
    }

    if (row.toolName === 'apply_patch') {
      for (const value of Array.isArray(details.changes) ? details.changes : []) {
        const change = record(value);
        const path = text(change?.moveTo) ?? text(change?.path);
        if (!path) continue;
        files.set(path, {
          path,
          ...(fileStatus(change?.kind) ? { status: fileStatus(change?.kind) } : {}),
          ...(typeof change?.added === 'number' ? { added: Math.max(0, change.added) } : {}),
          ...(typeof change?.removed === 'number' ? { removed: Math.max(0, change.removed) } : {}),
        });
      }
      if (text(details.diff)) diffs.push(text(details.diff)!);
      if (typeof details.added === 'number') added += Math.max(0, details.added);
      if (typeof details.removed === 'number') removed += Math.max(0, details.removed);
    }

    const verification = record(details.verification);
    if (verification?.kind === 'check' && text(verification.command)) {
      const toolCallId = text(row.toolCallId) ?? `check-${evidence.size + 1}`;
      const command = text(verification.command)!;
      evidence.set(toolCallId, {
        evidenceId: `${params.turnId}:${toolCallId}:check`,
        kind: 'check',
        label: command,
        // Without a final snapshot, a previously passing check may be stale.
        status: verification.status === 'failed' ? 'failed' : 'warning',
        command,
        ...(typeof details.durationMs === 'number' ? { durationMs: Math.max(0, details.durationMs) } : {}),
      });
    }
  }

  if (verificationSummary) {
    evidence.clear();
    for (const raw of Array.isArray(verificationSummary.evidence) ? verificationSummary.evidence : []) {
      const item = record(raw);
      if (item?.kind !== 'check' || !text(item.command) || !text(item.toolCallId)) continue;
      const id = `${params.turnId}:${item.toolCallId}:check`;
      evidence.set(id, {
        evidenceId: id, kind: 'check', label: String(item.command), command: String(item.command),
        status: item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : 'warning',
        ...(text(item.revision) ? { revision: text(item.revision) } : {}),
        ...(text(item.logPath) ? { logPath: text(item.logPath) } : {}),
        ...(typeof item.durationMs === 'number' ? { durationMs: Math.max(0, item.durationMs) } : {}),
      });
    }
  }

  const evidenceItems = [...evidence.values()];
  const collectedArtifacts = [...deliverables.values()];
  const artifactItems = mergeTurnOutcomeDeliverables(collectedArtifacts);
  const partial = (!verificationSummary && failedToolCount > 0)
    || evidenceItems.some((item) => item.status !== 'passed')
    || (verificationSummary?.required === true && verificationSummary.changed === true && !evidenceItems.some((item) => item.status === 'passed'))
    || collectedArtifacts.some((item) => item.availability !== 'available');
  const diff = diffs.join('\n');
  const diffTruncated = diff.length > MAX_OUTCOME_DIFF_CHARS;
  const createdAt = new Date(createdAtMs || Date.now()).toISOString();
  return {
    version: 1,
    outcomeId: `${params.turnId}:outcome`,
    runId: params.turnId,
    turnId: params.turnId,
    status: params.runStatus === 'error'
      ? 'failed'
      : params.runStatus === 'cancelled' || partial
        ? 'partial'
        : 'succeeded',
    ...(params.summary?.trim() ? { summary: params.summary.trim() } : {}),
    deliverables: artifactItems,
    ...(files.size > 0 || diffs.length > 0 ? {
      changeSet: {
        changeSetId: `${params.turnId}:changes`,
        files: [...files.values()],
        added,
        removed,
        diff: diffTruncated ? diff.slice(0, MAX_OUTCOME_DIFF_CHARS) : diff,
        ...(diffTruncated ? { diffTruncated: true } : {}),
        environment: 'workspace',
      },
    } : {}),
    evidence: evidenceItems,
    createdAt,
  };
}

export function backfillStructuredTurnOutcomes(
  rows: readonly TranscriptStoredRow[],
): TranscriptStoredRow[] {
  const existing = new Map<string, TurnOutcome>();
  const lastIndex = new Map<string, number>();
  for (const [index, source] of rows.entries()) {
    const row = source as TranscriptStoredRow & Record<string, unknown>;
    if (row.type === 'custom' && row.customType === 'turn_outcome') {
      const outcome = parseTurnOutcome(row.data);
      if (outcome) existing.set(outcome.turnId, outcome);
    }
    if (typeof row.turnId === 'string' && row.turnId) lastIndex.set(row.turnId, index);
  }

  const projected = new Map<string, TurnOutcome>();
  for (const turnId of lastIndex.keys()) {
    const outcome = projectTurnOutcome({ rows, turnId });
    if (outcome.deliverables.length > 0) projected.set(turnId, outcome);
  }
  if (projected.size === 0 && existing.size === 0) return [...rows];

  const result: TranscriptStoredRow[] = [];
  for (const [index, source] of rows.entries()) {
    const row = source as TranscriptStoredRow & Record<string, unknown>;
    if (row.type === 'custom' && row.customType === 'turn_outcome') {
      const outcome = parseTurnOutcome(row.data);
      const candidate = outcome ? projected.get(outcome.turnId) : undefined;
      if (outcome) {
        const deliverables = mergeTurnOutcomeDeliverables([...outcome.deliverables, ...(candidate?.deliverables ?? [])]);
        result.push({
          ...row,
          data: {
            ...outcome,
            deliverables,
            status: outcome.status === 'failed'
              ? 'failed'
              : candidate?.status === 'partial' || deliverables.some((item) => item.availability !== 'available')
                ? 'partial'
                : outcome.status,
          },
        } as TranscriptStoredRow);
        continue;
      }
    }
    result.push(source);
    const turnId = typeof row.turnId === 'string' ? row.turnId : undefined;
    if (!turnId || lastIndex.get(turnId) !== index) continue;
    const outcome = projected.get(turnId);
    if (!outcome || existing.has(turnId)) continue;
    result.push({
      type: 'custom',
      customType: 'turn_outcome',
      data: outcome,
      timestamp: outcome.createdAt,
    });
  }
  return result;
}
