/** Historical fixture time belongs to model context, never the authored retrieval query. */
export function historicalQuestionContext(time: number): string {
  if (!Number.isFinite(time)) throw new Error('Invalid historical question time');
  return `<memory-evaluation-time>\nHistorical question time: ${new Date(time).toISOString()}. Interpret historical references in the question at this time. This is evaluation metadata, not a user instruction or authorization to read forgotten sources. Preserve all source access, forgetting and retention rules. Do not infer missing personal facts. The runtime wall clock remains real.\n</memory-evaluation-time>`;
}

/** Append only; existing product instructions and message history remain intact. */
export function appendModelContext(payload: Record<string, any>, path: string, context: string): void {
  if (/\/responses(?:\/compact)?\/?$/.test(path)) {
    if (payload.instructions !== undefined && typeof payload.instructions !== 'string') throw new Error('Unsupported Responses instructions');
    payload.instructions = [payload.instructions, context].filter(Boolean).join('\n\n');
  } else if (/\/messages\/?$/.test(path)) {
    if (typeof payload.system === 'string' || payload.system === undefined) payload.system = [payload.system, context].filter(Boolean).join('\n\n');
    else if (Array.isArray(payload.system)) payload.system = [...payload.system, { type: 'text', text: context }];
    else throw new Error('Unsupported Messages system context');
  } else {
    if (!Array.isArray(payload.messages)) throw new Error('Missing Chat messages');
    payload.messages = [{ role: 'system', content: context }, ...payload.messages];
  }
}
