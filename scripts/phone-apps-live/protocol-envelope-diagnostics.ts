const MAX_SCAN_CHARS = 65_536;

type PrefixCategory = 'explicitAnswerLabel' | 'markdownFence' | 'closingThink' | 'plainProse' | 'none';
type SuffixCategory = 'whitespace' | 'closingFence' | 'closingAnswer' | 'punctuation' | 'other';
type QuoteKind = 'single' | 'double' | 'mixed' | 'none';
type Marker = { start: number; open: number };

function prefixCategory(prefix: string): PrefixCategory {
  const trimmed = prefix.trim();
  if (!trimmed) return 'none';
  if (/(?:<answer>|(?:答案|答复|回答|操作|动作|answer|action|response|final(?:\s+answer)?)\s*(?:\*\*)?\s*[:：]\s*(?:\*\*)?)\s*$/i.test(trimmed)) return 'explicitAnswerLabel';
  if (/(?:^|\n)```[^\n]*\s*$/u.test(trimmed)) return 'markdownFence';
  if (/<\/think>\s*$/i.test(trimmed)) return 'closingThink';
  return 'plainProse';
}

function suffixCategory(suffix: string): SuffixCategory {
  const trimmed = suffix.trim();
  if (!trimmed) return 'whitespace';
  if (/^```\s*$/.test(trimmed)) return 'closingFence';
  if (/^<\/answer>\s*$/i.test(trimmed)) return 'closingAnswer';
  return /^[。.!！；;，,：:]+$/u.test(trimmed) ? 'punctuation' : 'other';
}

function quoteKind(literal: string): QuoteKind {
  let quote: string | undefined; let single = false; let double = false;
  for (let index = 0; index < literal.length; index++) {
    const char = literal[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") {
      quote = char;
      if (char === "'") single = true; else double = true;
    }
  }
  return single && double ? 'mixed' : single ? 'single' : double ? 'double' : 'none';
}

/** Diagnostic counts only. This never returns candidates or makes an action executable. */
export function classifyModelActionEnvelope(raw: string, validate: (candidate: string) => unknown) {
  const scanned = raw.slice(0, MAX_SCAN_CHARS);
  const markers: Marker[] = [];
  const pattern = /(?:^|[^a-zA-Z0-9_$])((?:do|finish)\s*\()/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(scanned))) {
    const start = match.index + match[0].indexOf(match[1]);
    markers.push({ start, open: start + match[1].lastIndexOf('(') });
  }
  const callOpens = new Set(markers.map(marker => marker.open));
  const stack: Array<{ open: number; nestedWithinCall: boolean }> = [];
  const balanced = new Map<number, number>();
  const nested = new Set<number>();
  let quote: string | undefined;
  for (let index = 0; index < scanned.length; index++) {
    const char = scanned[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (stack.length && (char === '"' || char === "'")) { quote = char; continue; }
    if (char === '(') {
      const parent = stack.at(-1);
      const nestedWithinCall = Boolean(parent && (parent.nestedWithinCall || callOpens.has(parent.open)));
      stack.push({ open: index, nestedWithinCall });
      if (nestedWithinCall) nested.add(index);
    } else if (char === ')') {
      const opening = stack.pop();
      if (opening) balanced.set(opening.open, index + 1);
    }
  }
  const candidates = markers.filter(marker => balanced.has(marker.open) && !nested.has(marker.open));
  const last = candidates.at(-1);
  const lastMarker = last ?? markers.at(-1);
  const end = last ? balanced.get(last.open)! : undefined;
  let parseable = false;
  if (last && end !== undefined) {
    try { parseable = validate(scanned.slice(last.start, end)) !== false; } catch { /* Validation errors remain private. */ }
  }
  return {
    analyzedChars: scanned.length,
    scanTruncated: raw.length > MAX_SCAN_CHARS,
    anyCallCount: markers.length,
    balancedLiteralCallCount: candidates.length,
    validationAttempted: Boolean(last),
    lastBalancedLiteralCallParseable: parseable,
    prefixCategory: prefixCategory(lastMarker ? scanned.slice(0, lastMarker.start) : scanned),
    suffixCategory: end === undefined ? 'other' as SuffixCategory : suffixCategory(scanned.slice(end)),
    quoteKind: quoteKind(lastMarker ? scanned.slice(lastMarker.start, end) : ''),
    suffixIsSingleBacktick: end !== undefined && scanned.slice(end).trim() === '`',
    suffixIsQuote: end !== undefined && /^[\"']$/.test(scanned.slice(end).trim()),
    prefixEndsSingleBacktick: Boolean(lastMarker && /(?:^|[^`])`$/.test(scanned.slice(0, lastMarker.start).trim())),
  };
}
