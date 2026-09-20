export interface DataFragment {
  id: string;
  operationIds: string[];
  source: { kind: string; resource: string; revision?: string; capturedAt: string };
  startLine?: number;
  endLine?: number;
  text: string;
}

export interface DataOperationResult {
  id: string;
  kind: string;
  status: 'ok' | 'partial' | 'error' | 'denied' | 'cancelled';
  fragmentIds: string[];
  scope: string;
  sourceExhausted: boolean;
  outputOmitted: boolean;
  reason?: string;
  next?: { path: string; startLine: number; maxLines: number };
  durationMs: number;
}

export interface DataBatchResult {
  schemaVersion: 1;
  operations: DataOperationResult[];
  fragments: DataFragment[];
  sourceRequests: number;
}

export const DATA_MAX_CHARS = 12_000;
export const DATA_MAX_BYTES = 32 * 1024;
