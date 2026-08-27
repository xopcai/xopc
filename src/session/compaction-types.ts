export const HANDOVER_ITEM_KINDS = [
  'objective',
  'decision',
  'pending_user_ask',
  'todo',
  'constraint',
  'file_change',
  'tool_outcome',
  'failure',
  'current_state',
  'next_action',
] as const;

export type HandoverItemKind = typeof HANDOVER_ITEM_KINDS[number];
export type HandoverItemStatus = 'active' | 'completed' | 'superseded';

export interface CompactionSourceRef {
  entryId: string;
  seq: number;
}

export interface CompactionHandoverItem {
  id: string;
  kind: HandoverItemKind;
  text: string;
  status: HandoverItemStatus;
  sources: CompactionSourceRef[];
  identifiers: string[];
}

export interface CompactionHandover {
  version: 1;
  sourceThroughSeq: number;
  previousBoundaryId?: string;
  items: CompactionHandoverItem[];
}

export interface CompactionAudit {
  status: 'passed' | 'degraded' | 'disabled';
  mode: 'structural' | 'risk' | 'full';
  missingItemsFound: number;
  repaired: boolean;
  auditModelRef?: string;
}

export function isCompactionHandover(value: unknown): value is CompactionHandover {
  if (!value || typeof value !== 'object') return false;
  const handover = value as Record<string, unknown>;
  const sourceThroughSeq = Number(handover.sourceThroughSeq);
  if (handover.version !== 1
    || !Number.isInteger(handover.sourceThroughSeq)
    || sourceThroughSeq < 0
    || (handover.previousBoundaryId !== undefined && typeof handover.previousBoundaryId !== 'string')
    || !Array.isArray(handover.items)) return false;
  return handover.items.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as Record<string, unknown>;
    return typeof record.id === 'string'
      && record.id.length > 0
      && HANDOVER_ITEM_KINDS.includes(record.kind as HandoverItemKind)
      && typeof record.text === 'string'
      && record.text.length > 0
      && (record.status === 'active' || record.status === 'completed' || record.status === 'superseded')
      && Array.isArray(record.sources)
      && record.sources.length > 0
      && record.sources.every((source) => {
        if (!source || typeof source !== 'object') return false;
        const ref = source as Record<string, unknown>;
        return typeof ref.entryId === 'string'
          && ref.entryId.length > 0
          && Number.isInteger(ref.seq)
          && Number(ref.seq) > 0
          && Number(ref.seq) <= sourceThroughSeq;
      })
      && Array.isArray(record.identifiers)
      && record.identifiers.every((identifier) => typeof identifier === 'string');
  });
}

export function isCompactionAudit(value: unknown): value is CompactionAudit {
  if (!value || typeof value !== 'object') return false;
  const audit = value as Record<string, unknown>;
  return (audit.status === 'passed' || audit.status === 'degraded' || audit.status === 'disabled')
    && (audit.mode === 'structural' || audit.mode === 'risk' || audit.mode === 'full')
    && Number.isInteger(audit.missingItemsFound)
    && typeof audit.repaired === 'boolean'
    && (audit.auditModelRef === undefined || typeof audit.auditModelRef === 'string');
}
