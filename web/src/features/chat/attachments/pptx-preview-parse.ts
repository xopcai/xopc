export interface ParsedPptxSlide {
  slideNumber: number;
  text: string;
}

export type PptxExtractedParseResult =
  | { ok: true; slides: ParsedPptxSlide[]; notes: string[] }
  | { ok: false; raw: string };

/**
 * Parses the pseudo-XML string produced by `processPptx` into slides for UI display.
 * On failure (unexpected shape), callers should render `raw` in a fallback `<pre>`.
 */
export function parsePptxExtractedForDisplay(raw: string): PptxExtractedParseResult {
  const trimmed = raw.trim();
  const headerRe = /^<pptx\s+filename="([^"]*)">\s*/;
  const header = trimmed.match(headerRe);
  let inner = trimmed;
  if (header) {
    inner = trimmed.slice(header[0].length);
    inner = inner.replace(/\s*<\/pptx>\s*$/u, '').trim();
  }

  const slides: ParsedPptxSlide[] = [];
  const re = /<slide number="(\d+)">([\s\S]*?)<\/slide>/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const slideNumber = Number.parseInt(m[1], 10);
    const text = m[2].trim();
    slides.push({ slideNumber, text });
  }

  const notes: string[] = [];
  const commentRe = /<!--([\s\S]*?)-->/gu;
  let cm: RegExpExecArray | null;
  while ((cm = commentRe.exec(inner)) !== null) {
    notes.push(cm[1].trim());
  }

  if (slides.length === 0) {
    return { ok: false, raw };
  }
  return { ok: true, slides, notes };
}
