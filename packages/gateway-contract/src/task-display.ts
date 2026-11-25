export const PERSONAL_WORKER_RESULT_GUIDANCE = [
  '## Result for the originating conversation',
  'For ordinary Tasks when publish_task_result is available, use it before completion to review the actual result. Connected Requests use their own structured result tool instead. When files were published, finalArtifactIds selects the exact initial or revised set of final artifact IDs from publication receipts, including [] for a text-only result. For republication of already selected files, mode=amend and replacementArtifactIds retain the rest of the selection. Exclude intermediate, obsolete and failed files; publication history is not the final delivery manifest.',
  'Provide a complete, evidence-grounded result for the originating conversation. The personal assistant may synthesize its final reply from your report. Match the user’s language and requested depth; preserve requested content, relevant sources, verified data cutoffs, uncertainty, and partial failures. Distinguish reported findings from verified facts. Do not invent a friendly opening or assume a new user request.',
  'Keep internal planning, Agent names, tool logs, and task progress links out of the result unless the user specifically requested them or they are necessary to explain a blocker. Never substitute a progress page, a plan, or a promise for the requested result. Publish required files through the available artifact tools; do not repeat the same attachments or send the user to a Task page to collect them.',
].join('\n');

const LEGACY_PERSONAL_WORKER_RESULT_GUIDANCE = [
  '## Result for the originating conversation',
  'For ordinary Tasks when publish_task_result is available, use it before completion to review the actual result. Connected Requests use their own structured result tool instead. When files were published, finalArtifactIds must select the exact final artifact IDs from publication receipts, including [] for a text-only result. Exclude intermediate, obsolete and failed files; publication history is not the final delivery manifest.',
  'Provide a complete, evidence-grounded result for the originating conversation. The personal assistant may synthesize its final reply from your report. Match the user’s language and requested depth; preserve requested content, relevant sources, verified data cutoffs, uncertainty, and partial failures. Distinguish reported findings from verified facts. Do not invent a friendly opening or assume a new user request.',
  'Keep internal planning, Agent names, tool logs, and task progress links out of the result unless the user specifically requested them or they are necessary to explain a blocker. Never substitute a progress page, a plan, or a promise for the requested result. Publish required files through the available artifact tools; do not repeat the same attachments or send the user to a Task page to collect them.',
].join('\n');

const REQUEST_RESULT_GUIDANCE = 'Before finishing, call personal_request_result with the verified summary and, for mail, message items and coverage. The host composes the final explanation and preserves structured items in the main chat.';
const REQUEST_RESULT_GUIDANCE_SHORT = 'Before finishing, call personal_request_result with the verified summary and, for mail, message items and coverage.';

const TASK_FOLLOW_UP_PREFIX =
  'The user sent a follow-up instruction on this task. Continue directly from your existing context and confirmed results in this session without redoing completed work unnecessarily.';

const TASK_BRIEF_EXCERPT_NOTICE =
  'The task brief above is an excerpt. Before execution read every page with task_collaboration({command:"get",section:"brief",offset:0}) and nextOffset. Preserve all instructions and acceptance criteria.';

const TASK_RETRY_NOTICE_RE =
  /(?:^|\n{2,})This is a retry of the original request made at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\. Resolve relative dates using that request time and time zone unless the user explicitly changed the date range\.(?=\n{2,}|$)/g;

const CODE_FENCE_OPEN_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const TASK_FOLLOW_UP_OPEN_RE = /^<task_follow_up(?:\s+task_id="[^"]*")?>$/;
const INLINE_TASK_BRIEF_RE = /^<task_brief>([^\n]+)<\/task_brief>$/;

function parseFenceOpen(line: string): { char: string; len: number } | null {
  const match = line.match(CODE_FENCE_OPEN_RE);
  if (!match?.[1]) return null;
  const char = match[1][0]!;
  if (char === '`' && (match[2] ?? '').includes('`')) return null;
  return { char, len: match[1].length };
}

function isFenceClose(line: string, fence: { char: string; len: number }): boolean {
  const trimmed = line.replace(/^\s{0,3}/, '').trimEnd();
  if (trimmed.length < fence.len) return false;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== fence.char) return false;
  }
  return true;
}

function findClosingTagLine(lines: string[], startIndex: number, closingTag: string): number {
  let innerFence: { char: string; len: number } | null = null;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i]!;
    if (innerFence) {
      if (isFenceClose(line, innerFence)) innerFence = null;
      continue;
    }
    const opened = parseFenceOpen(line);
    if (opened) {
      innerFence = opened;
      continue;
    }
    if (line.trim() === closingTag) return i;
  }
  return -1;
}

function stripHostTaskGuidance(text: string): string {
  let out = text;
  if (out.includes(PERSONAL_WORKER_RESULT_GUIDANCE)) {
    out = out.replaceAll(PERSONAL_WORKER_RESULT_GUIDANCE, '');
  }
  if (out.includes(LEGACY_PERSONAL_WORKER_RESULT_GUIDANCE)) {
    out = out.replaceAll(LEGACY_PERSONAL_WORKER_RESULT_GUIDANCE, '');
  }
  if (out.includes(REQUEST_RESULT_GUIDANCE)) {
    out = out.replaceAll(REQUEST_RESULT_GUIDANCE, '');
  }
  if (out.includes(REQUEST_RESULT_GUIDANCE_SHORT)) {
    out = out.replaceAll(REQUEST_RESULT_GUIDANCE_SHORT, '');
  }
  if (out.includes(TASK_BRIEF_EXCERPT_NOTICE)) {
    out = out.replaceAll(TASK_BRIEF_EXCERPT_NOTICE, '');
  }
  if (out.includes('This is a retry of the original request made at ')) {
    out = out.replace(TASK_RETRY_NOTICE_RE, '');
  }
  return out;
}

function appendUnwrappedTaskBrief(output: string[], briefBody: string): void {
  const trimmedBrief = briefBody.trim();
  if (!trimmedBrief) return;
  const prevText = output.join('\n').trim();
  if (!prevText) {
    output.length = 0;
    output.push(...trimmedBrief.split('\n'));
    return;
  }
  if (trimmedBrief === prevText) {
    while (output.length > 0 && output[output.length - 1]!.trim() === '') output.pop();
    return;
  }
  if (trimmedBrief.startsWith(`${prevText}\n`) || (prevText.length >= 500 && trimmedBrief.startsWith(prevText))) {
    output.length = 0;
    output.push(...trimmedBrief.split('\n'));
    return;
  }
  output.push(...trimmedBrief.split('\n'));
}

/** Project recognized host task envelopes without changing execution instructions. */
export function taskDescriptionForDisplay(text: string): string {
  const hasCandidate = text.includes('<task_brief>')
    || text.includes('<task_follow_up')
    || text.includes('## Result for the originating conversation')
    || text.includes(REQUEST_RESULT_GUIDANCE_SHORT)
    || text.includes(TASK_BRIEF_EXCERPT_NOTICE)
    || text.includes('This is a retry of the original request made at ');
  if (!hasCandidate) return text;

  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const output: string[] = [];
  let fence: { char: string; len: number } | null = null;
  let changed = false;

  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (fence) {
      output.push(line);
      if (isFenceClose(line, fence)) fence = null;
      i++;
      continue;
    }
    const opened = parseFenceOpen(line);
    if (opened) {
      fence = opened;
      output.push(line);
      i++;
      continue;
    }

    const inlineBrief = line.match(INLINE_TASK_BRIEF_RE);
    if (inlineBrief?.[1] !== undefined) {
      appendUnwrappedTaskBrief(output, stripHostTaskGuidance(inlineBrief[1]));
      changed = true;
      i++;
      continue;
    }

    if (line.trim() === '<task_brief>') {
      const closing = findClosingTagLine(lines, i + 1, '</task_brief>');
      if (closing >= 0) {
        const body = lines.slice(i + 1, closing).join('\n');
        appendUnwrappedTaskBrief(output, stripHostTaskGuidance(body));
        changed = true;
        i = closing + 1;
        continue;
      }
    }

    if (
      TASK_FOLLOW_UP_OPEN_RE.test(line.trim())
      && lines[i + 1] === TASK_FOLLOW_UP_PREFIX
      && lines[i + 2] === ''
    ) {
      const closing = findClosingTagLine(lines, i + 3, '</task_follow_up>');
      if (closing >= 0) {
        const body = lines.slice(i + 3, closing).join('\n').trim();
        if (body) output.push(...body.split('\n'));
        changed = true;
        i = closing + 1;
        continue;
      }
    }

    output.push(line);
    i++;
  }

  const joined = output.join('\n');
  const cleaned = stripHostTaskGuidance(joined);
  if (!changed && cleaned === joined) return text;
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}
