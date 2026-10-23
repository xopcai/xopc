const contentText = (value: any): string => typeof value === 'string' ? value
  : Array.isArray(value) ? value.map(part => contentText(part.text ?? part.content ?? '')).join('\n') : '';

/** Diagnostic evidence must describe the payload after privacy projection, not raw selection. */
export function effectiveAnswerEvidence(inputs: any[]) {
  const rows = inputs.filter(row => row.phase === 'answer');
  const system = rows.flatMap(({payload}) => [contentText(payload.instructions), contentText(payload.system),
    ...(payload.messages ?? []).filter((row: any) => ['system','developer'].includes(row.role)).map((row: any) => contentText(row.content))]).join('\n');
  const selectedText = [...new Set([...system.matchAll(/<user-context>([\s\S]*?)<\/user-context>/gu)].map(match => match[1]))].join('\n');
  const toolText = rows.flatMap(({ payload }) => [
    ...(payload.messages ?? []).filter((row: any) => row.role === 'tool').map((row: any) => contentText(row.content)),
    ...(Array.isArray(payload.input) ? payload.input : []).filter((row: any) => row.type === 'function_call_output').map((row: any) => contentText(row.output)),
    ...(payload.messages ?? []).flatMap((row: any) => Array.isArray(row.content) ? row.content.filter((part: any) => part.type === 'tool_result').map((part: any) => contentText(part.content)) : []),
  ]).join('\n');
  return { selectedText, toolText, source: 'actual_answer_request_payloads', answerRequests: rows.length };
}
