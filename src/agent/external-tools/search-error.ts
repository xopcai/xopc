export class ExternalToolSearchError extends Error {
  constructor(readonly phase: 'create_session' | 'search', readonly toolkits: string[], cause: unknown) {
    super(`Composio tool discovery failed during ${phase}`, { cause });
    this.name = 'ExternalToolSearchError';
  }
}

/** Expose diagnostic metadata without returning provider payloads or credentials to the model. */
export function searchFailureDetails(error: unknown): {
  phase: string;
  toolkits?: string[];
  code?: string | number;
  status?: number;
} {
  const details: ReturnType<typeof searchFailureDetails> = error instanceof ExternalToolSearchError
    ? { phase: error.phase, toolkits: error.toolkits }
    : { phase: 'search' };
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const row = current as Record<string, unknown>;
    if (details.code === undefined && (typeof row.code === 'number'
      || (typeof row.code === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(row.code)))) {
      details.code = row.code;
    }
    const status = row.status ?? row.statusCode;
    if (details.status === undefined && typeof status === 'number') details.status = status;
    current = row.cause;
  }
  return details;
}
