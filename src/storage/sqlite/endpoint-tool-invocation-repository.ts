import type { EndpointEffect, EndpointToolErrorCode } from '@xopcai/endpoint-tools-protocol';
import { getSqliteDatabase } from './transaction.js';

export interface EndpointToolInvocationAudit {
  id: string;
  principalId: string;
  endpointId: string;
  toolCallId: string;
  toolName: string;
  effect: EndpointEffect;
  confirmationRequired: boolean;
  argumentsSha256: string;
  status: 'running' | 'succeeded' | 'failed';
  errorCode?: EndpointToolErrorCode;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
}

interface AuditRow {
  id: string; principal_id: string; endpoint_id: string; tool_call_id: string;
  tool_name: string; effect: EndpointEffect; confirmation_required: number;
  arguments_sha256: string; status: EndpointToolInvocationAudit['status'];
  error_code: EndpointToolErrorCode | null; error_message: string | null;
  started_at: number; completed_at: number | null;
}

function fromRow(row: AuditRow): EndpointToolInvocationAudit {
  return {
    id: row.id,
    principalId: row.principal_id,
    endpointId: row.endpoint_id,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    effect: row.effect,
    confirmationRequired: row.confirmation_required === 1,
    argumentsSha256: row.arguments_sha256,
    status: row.status,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.error_message === null ? {} : { errorMessage: row.error_message }),
    startedAt: row.started_at,
    ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  };
}

export function startEndpointToolInvocationAudit(
  audit: Omit<EndpointToolInvocationAudit, 'status' | 'completedAt' | 'errorCode' | 'errorMessage'>,
): void {
  getSqliteDatabase().prepare(`
    INSERT INTO endpoint_tool_invocations (
      id, principal_id, endpoint_id, tool_call_id, tool_name, effect,
      confirmation_required, arguments_sha256, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
  `).run(
    audit.id, audit.principalId, audit.endpointId, audit.toolCallId, audit.toolName,
    audit.effect, audit.confirmationRequired ? 1 : 0, audit.argumentsSha256, audit.startedAt,
  );
}

export function finishEndpointToolInvocationAudit(params: {
  id: string;
  status: 'succeeded' | 'failed';
  errorCode?: EndpointToolErrorCode;
  errorMessage?: string;
  completedAt?: number;
}): void {
  getSqliteDatabase().prepare(`
    UPDATE endpoint_tool_invocations
    SET status = ?, error_code = ?, error_message = ?, completed_at = ?
    WHERE id = ? AND status = 'running'
  `).run(
    params.status,
    params.errorCode ?? null,
    params.errorMessage?.slice(0, 2_000) ?? null,
    params.completedAt ?? Date.now(),
    params.id,
  );
}

export function listEndpointToolInvocationAudits(limit = 100): EndpointToolInvocationAudit[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = getSqliteDatabase().prepare(`
    SELECT * FROM endpoint_tool_invocations ORDER BY started_at DESC LIMIT ?
  `).all(boundedLimit) as unknown as AuditRow[];
  return rows.map(fromRow);
}
