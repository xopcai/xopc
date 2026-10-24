const MAX_SCAN_CHARS = 65_536;
const KNOWN_KEYS = ['action', 'type', 'kind', 'text', 'point', 'element', 'parameters'] as const;
const SHORTHANDS = ['Type', 'type_text', 'typeText', 'write'] as const;
type Validators = { decision(value: unknown): boolean; action(value: unknown): boolean };

/** Only closed labels, known-key membership and counts survive this diagnostic. */
export function classifyAlternativeActionContracts(raw: string, validators: Validators) {
  const scanned = raw.slice(0, MAX_SCAN_CHARS);
  const lines = scanned.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1) ?? '';
  const shorthandCalls = Object.fromEntries(SHORTHANDS.map(name => [name, new RegExp(`\\b${name}\\s*\\(`).test(scanned)]));
  const ranges: Array<{ start: number; end: number }> = [];
  const stack: string[] = [];
  let start = -1; let quote = false;
  for (let index = 0; index < scanned.length; index++) {
    const char = scanned[index];
    if (quote) { if (char === '\\') index++; else if (char === '"') quote = false; continue; }
    if (stack.length && char === '"') { quote = true; continue; }
    if (char === '{' || char === '[') { if (!stack.length) start = index; stack.push(char); }
    else if (char === '}' || char === ']') {
      if (!stack.length) continue;
      const expected = char === '}' ? '{' : '[';
      if (stack.at(-1) !== expected) { stack.length = 0; start = -1; continue; }
      stack.pop();
      if (!stack.length && start >= 0 && ranges.length < 128) ranges.push({ start, end: index + 1 });
    }
  }
  const trailing = [...ranges].reverse().find(range => /^\s*(?:```|<\/answer>)?\s*$/i.test(scanned.slice(range.end)));
  let value: unknown; let jsonParsed = false;
  if (trailing) { try { value = JSON.parse(scanned.slice(trailing.start, trailing.end)); jsonParsed = true; } catch { /* Raw values remain transient. */ } }
  const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const keys = object ? Object.keys(object) : [];
  const knownKeyMembership = Object.fromEntries(KNOWN_KEYS.map(key => [key, Boolean(object && Object.hasOwn(object, key))]));
  const kind = jsonParsed ? Array.isArray(value) ? 'array' : object ? 'object' : 'other' : 'none';
  let decisionValid = false; let actionValid = false;
  if (jsonParsed) {
    try { decisionValid = validators.decision(value); } catch { /* Validation is diagnostic only. */ }
    try { actionValid = validators.action(value); } catch { /* Validation is diagnostic only. */ }
  }
  let lastLineRepresentation: 'dsl' | 'fullwidthDsl' | 'escapedDsl' | 'shorthand' | 'json' | 'fencedJson' | 'none' = 'none';
  let redactedLastLine: string | undefined;
  const bare = /^`?\s*(do|finish)\s*\([\s\S]*\)\s*`?\s*[。.!！]?\s*$/i.exec(lastLine);
  const shorthand = /^`?\s*(Type|type_text|typeText|write)\s*\([\s\S]*\)\s*`?\s*[。.!！]?\s*$/.exec(lastLine);
  if (bare) { lastLineRepresentation = 'dsl'; redactedLastLine = `${bare[1].toLowerCase()}(ARG)`; }
  else if (/^`?\s*(?:do|finish)\s*（[\s\S]*）\s*`?\s*$/i.test(lastLine)) lastLineRepresentation = 'fullwidthDsl';
  else if (/^`?\s*(?:do|finish)\s*\\\([\s\S]*\\\)\s*`?\s*$/i.test(lastLine)) lastLineRepresentation = 'escapedDsl';
  else if (shorthand) { lastLineRepresentation = 'shorthand'; redactedLastLine = `${shorthand[1]}(ARG)`; }
  else if (jsonParsed) { lastLineRepresentation = lastLine === '```' ? 'fencedJson' : 'json'; redactedLastLine = kind === 'array' ? 'JSON_ARRAY(ARG)' : 'JSON_OBJECT(ARG)'; }
  return {
    analyzedChars: scanned.length, scanTruncated: raw.length > MAX_SCAN_CHARS,
    caseInsensitiveDslCall: /\b(?:do|finish)\s*\(/i.test(scanned),
    caseVariantDslCall: /\b(?:do|finish)\s*\(/i.test(scanned) && !/\b(?:do|finish)\s*\(/.test(scanned),
    fullwidthDslCall: /\b(?:do|finish)\s*（/i.test(scanned), escapedDslCall: /\b(?:do|finish)\s*\\\(/i.test(scanned),
    shorthandCalls,
    balancedJsonCount: ranges.length, trailingJsonParsed: jsonParsed, trailingJsonKind: kind,
    trailingJsonDecisionSchemaValid: decisionValid, trailingJsonActionSchemaValid: actionValid,
    knownJsonKeyMembership: knownKeyMembership, unknownJsonKeyCount: keys.filter(key => !KNOWN_KEYS.includes(key as typeof KNOWN_KEYS[number])).length,
    lastLineRepresentation, redactedLastLine,
  };
}
