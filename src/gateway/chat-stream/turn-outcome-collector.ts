import type {
  AgentStreamRunStatus,
  ProductDeliveryEnvelope,
  ProductReference,
  TurnOutcome,
  TurnOutcomeChangedFile,
  TurnOutcomeDeliverable,
  TurnOutcomeEvidence,
} from '@xopcai/gateway-contract';
import {
  fileResourceArtifactUri,
  parseProductDeliveryEnvelope,
  TurnOutcomeDeliverableSchema,
  turnOutcomeKindFromFileName,
  turnOutcomeMimeTypeFromFileName,
} from '@xopcai/gateway-contract';

import { parseFileResourceId } from '../../files/file-service.js';

import type { ChatStreamEvent } from './protocol.js';

const VERIFICATION_COMMAND = /(^|[\s:/_-])(test|vitest|jest|pytest|lint|typecheck|type-check|build)([\s:/_-]|$)/i;
const MAX_OUTCOME_DIFF_CHARS = 200_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fileStatus(kind: unknown): TurnOutcomeChangedFile['status'] {
  if (kind === 'add') return 'added';
  if (kind === 'delete') return 'deleted';
  if (kind === 'move') return 'renamed';
  if (kind === 'update') return 'modified';
  return undefined;
}

function changedFiles(changes: unknown[]): TurnOutcomeChangedFile[] {
  return changes.flatMap((value): TurnOutcomeChangedFile[] => {
    const row = asRecord(value);
    const path = optionalString(row?.moveTo) ?? optionalString(row?.path);
    if (!path) return [];
    return [{
      path,
      ...(fileStatus(row?.kind) ? { status: fileStatus(row?.kind) } : {}),
      ...(typeof row?.added === 'number' ? { added: Math.max(0, row.added) } : {}),
      ...(typeof row?.removed === 'number' ? { removed: Math.max(0, row.removed) } : {}),
    }];
  });
}

function explicitArtifacts(details: Record<string, unknown>): TurnOutcomeDeliverable[] {
  if (!Array.isArray(details.artifacts)) return [];
  return details.artifacts.flatMap((value): TurnOutcomeDeliverable[] => {
    const parsed = TurnOutcomeDeliverableSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

function fileReferenceDeliverable(
  reference: ProductReference,
  operation: ProductDeliveryEnvelope['operation'],
  environment: 'workspace' | 'worktree' | 'remote_runtime',
): TurnOutcomeDeliverable | null {
  if (reference.kind !== 'file') return null;
  let workspaceRelativePath: string | undefined;
  try {
    workspaceRelativePath = parseFileResourceId(reference.id).relativePath;
  } catch {
    // External producers may use their own stable file ids.
  }
  const mimeType = turnOutcomeMimeTypeFromFileName(reference.title);
  const available = operation !== 'failed';
  const capabilities: TurnOutcomeDeliverable['capabilities'] = available
    ? [
        ...(reference.capabilities.includes('preview') ? ['preview' as const] : []),
        'download',
        ...(reference.capabilities.includes('share') ? ['share' as const] : []),
      ]
    : ['regenerate'];
  return {
    artifactId: reference.id,
    title: reference.title,
    kind: turnOutcomeKindFromFileName(reference.title),
    ...(mimeType ? { mimeType } : {}),
    availability: available ? 'available' : 'failed',
    location: environment,
    capabilities,
    ...(available && environment === 'workspace'
      ? { uri: fileResourceArtifactUri(reference.id) }
      : {}),
    ...(workspaceRelativePath ? { workspaceRelativePath } : {}),
  };
}

function productDeliveryArtifacts(
  delivery: ProductDeliveryEnvelope | null,
  environment: 'workspace' | 'worktree' | 'remote_runtime',
): TurnOutcomeDeliverable[] {
  if (!delivery) return [];
  return [delivery.primary, ...(delivery.related ?? [])].flatMap((reference) => {
    if (!reference) return [];
    const artifact = fileReferenceDeliverable(reference, delivery.operation, environment);
    return artifact ? [artifact] : [];
  });
}

export class TurnOutcomeCollector {
  private readonly deliverables = new Map<string, TurnOutcomeDeliverable>();
  private readonly evidence = new Map<string, TurnOutcomeEvidence>();
  private readonly files = new Map<string, TurnOutcomeChangedFile>();
  private readonly diffs: string[] = [];
  private added = 0;
  private removed = 0;
  private failedToolCount = 0;

  constructor(
    private readonly runId: string,
    private readonly environment: 'workspace' | 'worktree' | 'remote_runtime' = 'workspace',
  ) {}

  capture(event: ChatStreamEvent): void {
    if (event.type === 'tool_end') {
      if (event.payload.status !== 'success') {
        this.failedToolCount += 1;
        return;
      }
      const details = asRecord(event.payload.result?.details) ?? {};
      const artifacts = [
        ...explicitArtifacts(details),
        ...productDeliveryArtifacts(
          parseProductDeliveryEnvelope(details.delivery),
          this.environment,
        ),
      ];
      for (const artifact of artifacts) {
        this.deliverables.set(artifact.artifactId, artifact);
      }
      return;
    }

    if (event.type === 'patch_applied') {
      for (const file of changedFiles(event.payload.changes)) {
        this.files.set(file.path, file);
      }
      return;
    }

    if (event.type === 'turn_diff') {
      for (const path of event.payload.files) {
        if (!this.files.has(path)) this.files.set(path, { path });
      }
      if (event.payload.diff.trim()) this.diffs.push(event.payload.diff);
      this.added += Math.max(0, event.payload.added);
      this.removed += Math.max(0, event.payload.removed);
      return;
    }

    if (event.type === 'command_completed' && VERIFICATION_COMMAND.test(event.payload.command)) {
      const status = event.payload.exitCode === 0 && !event.payload.timedOut ? 'passed' : 'failed';
      this.evidence.set(event.payload.toolCallId, {
        evidenceId: `${this.runId}:${event.payload.toolCallId}:check`,
        kind: 'check',
        label: event.payload.command,
        status,
        command: event.payload.command,
        ...(event.payload.durationMs !== undefined ? { durationMs: event.payload.durationMs } : {}),
      });
    }
  }

  finalize(status: AgentStreamRunStatus, summary?: string): TurnOutcome {
    const evidence = [...this.evidence.values()];
    const partial = this.failedToolCount > 0
      || evidence.some((item) => item.status === 'failed')
      || [...this.deliverables.values()].some((item) => item.availability === 'failed');
    const fullDiff = this.diffs.join('\n');
    const diffTruncated = fullDiff.length > MAX_OUTCOME_DIFF_CHARS;
    return {
      version: 1,
      outcomeId: `${this.runId}:outcome`,
      runId: this.runId,
      turnId: this.runId,
      status: status === 'error' ? 'failed' : status === 'cancelled' || partial ? 'partial' : 'succeeded',
      ...(summary?.trim() ? { summary: summary.trim() } : {}),
      deliverables: [...this.deliverables.values()],
      ...(this.files.size > 0 || this.diffs.length > 0
        ? {
            changeSet: {
              changeSetId: `${this.runId}:changes`,
              files: [...this.files.values()],
              added: this.added,
              removed: this.removed,
              diff: diffTruncated ? fullDiff.slice(0, MAX_OUTCOME_DIFF_CHARS) : fullDiff,
              ...(diffTruncated ? { diffTruncated: true } : {}),
              environment: this.environment,
            },
          }
        : {}),
      evidence,
      createdAt: new Date().toISOString(),
    };
  }
}
