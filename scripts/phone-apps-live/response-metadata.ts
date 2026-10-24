const MAX_ANALYSIS_CHARS = 65_536;
const MAX_ANALYSIS_LINES = 2048;
const MAX_COUNT = 1_000_000_000;

type JsonRecord = Record<string, unknown>;
type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | 'other' | null;
type FinalFormat = 'literal' | 'think-literal' | 'fenced' | 'json' | 'other';

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? value : undefined;
}

function finishReason(value: unknown): FinishReason | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' && ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(value)
    ? value as FinishReason : 'other';
}

function plainFormat(content: string): Exclude<FinalFormat, 'think-literal'> {
  const trimmed = content.trim();
  if (/^```/.test(trimmed)) return 'fenced';
  if (/^[{[]/.test(trimmed)) {
    try { JSON.parse(trimmed); return 'json'; } catch { /* Incomplete JSON stays unclassified. */ }
  }
  return /^(?:do|finish)\s*\([\s\S]*\)\s*$/.test(trimmed) ? 'literal' : 'other';
}

function finalFormat(content: string): FinalFormat {
  const trimmed = content.trim();
  const direct = plainFormat(trimmed);
  if (direct !== 'other') return direct;
  const answer = /<answer>([\s\S]*?)(?:<\/answer>|$)/i.exec(trimmed)?.[1]?.trim();
  const afterThink = trimmed.replace(/^[\s\S]*<\/think>\s*/i, '');
  for (const candidate of [answer, afterThink !== trimmed ? afterThink : undefined]) {
    if (!candidate) continue;
    const format = plainFormat(candidate);
    if (format !== 'other') return format === 'literal' ? 'think-literal' : format;
  }
  const markers = /(?:^|\n)\s*((?:do|finish)\s*\()/g;
  let marker: RegExpExecArray | null; let finalStart = -1;
  while ((marker = markers.exec(trimmed))) finalStart = marker.index + marker[0].indexOf(marker[1]);
  return finalStart >= 0 && plainFormat(trimmed.slice(finalStart)) === 'literal' ? 'think-literal' : 'other';
}

/** Fixed-schema counts only: model text, arguments and reasoning never leave this helper. */
export function modelResponseMetadata(payload: unknown) {
  const root = record(payload);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const choice = record(choices[0]);
  const message = record(choice?.message);
  const content = typeof message?.content === 'string' ? message.content : '';
  const analyzed = content.slice(0, MAX_ANALYSIS_CHARS);
  const lines = analyzed.split(/\r?\n/).slice(0, MAX_ANALYSIS_LINES).map(line => line.trim()).filter(Boolean);
  const seen = new Set<string>();
  let repeatedLines = 0; let longestRepeatedLineChars = 0;
  for (const line of lines) {
    if (seen.has(line)) { repeatedLines++; longestRepeatedLineChars = Math.max(longestRepeatedLineChars, line.length); }
    else seen.add(line);
  }
  const usage = record(root?.usage);
  const details = record(usage?.completion_tokens_details);
  return {
    finishReason: finishReason(choice?.finish_reason),
    usage: {
      promptTokens: count(usage?.prompt_tokens), completionTokens: count(usage?.completion_tokens),
      totalTokens: count(usage?.total_tokens), reasoningTokens: count(details?.reasoning_tokens),
    },
    outputChars: Math.min(content.length, MAX_COUNT),
    hasThink: /<\/?think>/i.test(analyzed),
    hasAnswer: /<\/?answer>/i.test(analyzed),
    finalFormat: finalFormat(analyzed),
    repetition: { analyzedLines: lines.length, repeatedLines,
      repeatedLineRatio: lines.length ? Math.round(repeatedLines / lines.length * 10_000) / 10_000 : 0,
      longestRepeatedLineChars },
    analysisTruncated: content.length > MAX_ANALYSIS_CHARS || analyzed.split(/\r?\n/).length > MAX_ANALYSIS_LINES,
  };
}
