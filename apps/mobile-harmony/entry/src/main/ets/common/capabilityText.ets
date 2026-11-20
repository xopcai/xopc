export interface XopcCapabilitySpan {
  wireStart: number;
  wireEnd: number;
  displayStart: number;
  displayEnd: number;
  labelStart: number;
}

export interface XopcCapabilityText {
  text: string;
  spans: XopcCapabilitySpan[];
}

export function skillDisplayName(id: string): string {
  // Catalog installs can namespace the same name with a package hash.
  const name = id.replace(/^[^.]+-[a-f0-9]{12}\./i, '').replace(/[-_.]+/g, ' ');
  return name.replace(/\b[a-z]/g, (letter: string): string => letter.toUpperCase());
}

export function nameCapabilityPrompt(prompt: string, catalogId: string, displayName: string): string {
  const title = displayName.replace(/\s+/g, ' ').trim();
  if (!title || title === catalogId || /[」”]/.test(title)) return prompt;
  const match = /^(请使用「|Use “)([A-Za-z0-9][A-Za-z0-9._:/-]*)(?: \(([A-Za-z0-9][A-Za-z0-9._:/-]*)\))?(」帮我：|” to help me with:)$/.exec(prompt);
  if (!match || match[2] !== catalogId) return prompt;
  return match[1] + title + ' (' + (match[3] || catalogId) + ')' + match[4];
}

export function capabilityText(wire: string, labels: Map<string, string> = new Map<string, string>(),
  editing: boolean = false): XopcCapabilityText {
  const tokens = /(^Use “[^”\r\n]+|^请使用「[^」\r\n]+)( \([A-Za-z0-9][A-Za-z0-9._:/-]*\))(?=” to help me with:|」帮我：)|(^|\s)\/skill:([A-Za-z0-9][A-Za-z0-9._-]*)/g;
  const spans: XopcCapabilitySpan[] = [];
  let text = '';
  let end = 0;
  let match: RegExpExecArray | null = tokens.exec(wire);
  while (match) {
    const start = match.index + (match[1] || match[3] || '').length;
    const wireEnd = match.index + match[0].length;
    if (editing && match[4] && wireEnd === wire.length && !labels.has(match[4])) {
      match = tokens.exec(wire);
      continue;
    }
    text += wire.slice(end, start);
    const displayStart = text.length;
    if (match[4]) text += '【' + (labels.get(match[4]) || skillDisplayName(match[4])) + '】';
    spans.push({ wireStart: start, wireEnd, displayStart, displayEnd: text.length,
      labelStart: match[1] ? (match[1].startsWith('Use ') ? 5 : 4) : displayStart });
    end = wireEnd;
    match = tokens.exec(wire);
  }
  return { text: text + wire.slice(end), spans };
}

export function capabilityDisplayOffset(projection: XopcCapabilityText, wireOffset: number): number {
  let delta = 0;
  for (const span of projection.spans) {
    if (wireOffset <= span.wireStart) break;
    if (wireOffset <= span.wireEnd) return span.displayEnd;
    delta = span.displayEnd - span.wireEnd;
  }
  return wireOffset + delta;
}

export function capabilityWireOffset(projection: XopcCapabilityText, displayOffset: number): number {
  let delta = 0;
  for (const span of projection.spans) {
    if (displayOffset < span.displayEnd) return Math.min(displayOffset + delta, span.wireStart);
    delta = span.wireEnd - span.displayEnd;
  }
  return displayOffset + delta;
}

export function editCapabilityText(wire: string, projection: XopcCapabilityText, next: string,
  start: number = -1, end: number = -1): string {
  if (next === projection.text) return wire;
  if (!projection.spans.length) return next;
  const previous = projection.text;
  if (start < 0 || end < start || !next.startsWith(previous.slice(0, start))
    || !next.endsWith(previous.slice(end)) || next.length < start + previous.length - end) {
    start = 0;
    while (start < next.length && previous[start] === next[start]) start++;
    end = previous.length;
    let nextEnd = next.length;
    while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
      end--;
      nextEnd--;
    }
  }
  const shift = next.length - previous.length;
  let result = next;
  for (let i = projection.spans.length - 1; i >= 0; i--) {
    const span = projection.spans[i];
    const hiddenId = span.displayStart === span.displayEnd;
    if (span.labelStart < end && span.displayEnd > start) continue;
    if (hiddenId && start === span.displayEnd) continue;
    const offset = span.displayStart >= end ? shift : 0;
    const before = result.slice(0, span.displayStart + offset);
    const after = result.slice(span.displayEnd + offset);
    const token = wire.slice(span.wireStart, span.wireEnd);
    // Preserve the skill ID when text is inserted against the edge of its label.
    const leadingSpace = !hiddenId && before && !/\s$/.test(before) ? ' ' : '';
    const trailingSpace = !hiddenId && /^[A-Za-z0-9._-]/.test(after) ? ' ' : '';
    result = before + leadingSpace + token + trailingSpace + after;
  }
  return result;
}
