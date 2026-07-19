export type WorkflowSaveConflict =
  | {
      code: 'WORKFLOW_NAME_EXISTS';
      name: string;
      currentRevision: number;
      suggestedName: string;
    }
  | {
      code: 'WORKFLOW_REVISION_CONFLICT';
      currentRevision: number;
    };

export function suggestAvailableWorkflowName(name: string, existingNames: Iterable<string>): string {
  const used = new Set(existingNames);
  if (!used.has(name)) return name;
  for (let suffix = 2; suffix < 1_000; suffix += 1) {
    const candidate = `${name}_${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${name}_${Date.now()}`;
}

export function parseWorkflowSaveConflict(cause: unknown): WorkflowSaveConflict | null {
  if (!(cause instanceof Error)) return null;
  const candidate = cause as Error & { status?: unknown; body?: unknown };
  if (candidate.status !== 409 || !candidate.body || typeof candidate.body !== 'object') return null;
  const body = candidate.body as Record<string, unknown>;
  const currentRevision = typeof body.currentRevision === 'number' ? body.currentRevision : 0;
  if (body.code === 'WORKFLOW_NAME_EXISTS' && typeof body.name === 'string' && typeof body.suggestedName === 'string') {
    return {
      code: 'WORKFLOW_NAME_EXISTS',
      name: body.name,
      currentRevision,
      suggestedName: body.suggestedName,
    };
  }
  if (body.code === 'WORKFLOW_REVISION_CONFLICT') {
    return { code: 'WORKFLOW_REVISION_CONFLICT', currentRevision };
  }
  return null;
}
