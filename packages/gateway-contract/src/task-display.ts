export const PERSONAL_WORKER_RESULT_GUIDANCE = [
  '## Result for the originating conversation',
  'For ordinary Tasks when publish_task_result is available, use it before completion to review the actual result. Connected Requests use their own structured result tool instead. When files were published, finalArtifactIds must select the exact final artifact IDs from publication receipts, including [] for a text-only result. Exclude intermediate, obsolete and failed files; publication history is not the final delivery manifest.',
  'Provide a complete, evidence-grounded result for the originating conversation. The personal assistant may synthesize its final reply from your report. Match the user’s language and requested depth; preserve requested content, relevant sources, verified data cutoffs, uncertainty, and partial failures. Distinguish reported findings from verified facts. Do not invent a friendly opening or assume a new user request.',
  'Keep internal planning, Agent names, tool logs, and task progress links out of the result unless the user specifically requested them or they are necessary to explain a blocker. Never substitute a progress page, a plan, or a promise for the requested result. Publish required files through the available artifact tools; do not repeat the same attachments or send the user to a Task page to collect them.',
].join('\n');

const REQUEST_RESULT_GUIDANCE = 'Before finishing, call personal_request_result with the verified summary and, for mail, message items and coverage. The host composes the final explanation and preserves structured items in the main chat.';

/** Project a recognized host task envelope without changing execution instructions. */
export function taskDescriptionForDisplay(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.includes(PERSONAL_WORKER_RESULT_GUIDANCE)) return text;
  return normalized.replace(PERSONAL_WORKER_RESULT_GUIDANCE, '')
    .replace(REQUEST_RESULT_GUIDANCE, '')
    .replace(/<task_brief>\n([\s\S]*?)\n<\/task_brief>/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Keep host instructions when an edited visible brief is saved. */
export function preserveTaskExecutionInstructions(original: string, edited: string): string {
  const normalized = original.replace(/\r\n/g, '\n');
  if (!normalized.includes(PERSONAL_WORKER_RESULT_GUIDANCE)) return edited;
  return [edited.trim(), PERSONAL_WORKER_RESULT_GUIDANCE,
    ...(normalized.includes(REQUEST_RESULT_GUIDANCE) ? [REQUEST_RESULT_GUIDANCE] : [])]
    .filter(Boolean).join('\n\n');
}
