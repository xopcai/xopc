import { DATA_MAX_BYTES, DATA_MAX_CHARS, type DataBatchResult } from './types.js';

/** Keep a valid envelope and explicit omissions even under a second context reduction. */
export function renderDataBatch(input: DataBatchResult, maxChars = DATA_MAX_CHARS): { text: string; result: DataBatchResult } {
  const result = structuredClone(input);
  const omitted = new Set<string>();
  const encode = () => JSON.stringify(result);
  const mark = () => {
    for (const operation of result.operations) {
      operation.fragmentIds = operation.fragmentIds.filter(id => result.fragments.some(fragment => fragment.id === id));
      if (omitted.has(operation.id)) {
        operation.outputOmitted = true;
        if (operation.status === 'ok') operation.status = 'partial';
        operation.reason ??= 'output_budget';
        if (operation.kind === 'file_read') {
          const original = input.fragments.find(fragment => fragment.operationIds.includes(operation.id));
          const kept = result.fragments.find(fragment => fragment.operationIds.includes(operation.id));
          if (original?.startLine !== undefined) operation.next = {
            path: original.source.resource,
            startLine: kept?.endLine !== undefined ? kept.endLine + 1 : original.startLine,
            maxLines: operation.next?.maxLines ?? 120,
          };
        }
      }
    }
  };
  let text = encode();
  while (text.length > maxChars || Buffer.byteLength(text) > DATA_MAX_BYTES) {
    const nonempty = result.fragments.filter(fragment => fragment.text.length > 0);
    if (nonempty.length) {
      for (const fragment of nonempty) {
        fragment.operationIds.forEach(id => omitted.add(id));
        const lines = fragment.text.split('\n');
        if (lines.length > 1) {
          fragment.text = lines.slice(0, Math.floor(lines.length / 2)).join('\n');
          if (fragment.startLine !== undefined) fragment.endLine = fragment.startLine + fragment.text.split('\n').length - 1;
        } else {
          fragment.text = '';
        }
      }
      result.fragments = result.fragments.filter(fragment => fragment.text.length > 0);
    } else {
      for (const operation of result.operations) {
        operation.scope = '';
        operation.reason = operation.reason?.slice(0, 80);
        delete operation.next;
      }
      mark();
      for (const operation of result.operations) delete operation.next;
      text = encode();
      if (text.length <= maxChars && Buffer.byteLength(text) <= DATA_MAX_BYTES) break;
      // Very small contexts cannot fit full metadata. Never retain a success claim.
      text = JSON.stringify({ status: 'partial', reason: 'output_budget', operations: result.operations.map(op => ({ id: op.id, status: op.status })) });
      if (text.length > maxChars) text = '{"status":"partial"}';
      if (text.length > maxChars) text = '';
      return { text, result };
    }
    mark();
    text = encode();
  }
  return { text, result };
}

export function isDataBatchResult(value: unknown): value is DataBatchResult {
  if (!value || typeof value !== 'object') return false;
  const item = value as DataBatchResult;
  return item.schemaVersion === 1 && Array.isArray(item.operations) && item.operations.length <= 8
    && item.operations.every(op => op && typeof op.id === 'string' && Array.isArray(op.fragmentIds) && typeof op.scope === 'string')
    && Array.isArray(item.fragments) && item.fragments.length <= 256
    && item.fragments.every(fragment => fragment && typeof fragment.text === 'string' && Array.isArray(fragment.operationIds)
      && fragment.source && typeof fragment.source.kind === 'string' && typeof fragment.source.resource === 'string');
}
