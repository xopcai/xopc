const UNDERSTANDING_CORRECTION_PATTERNS: RegExp[] = [
  /(?:你|您)(?:记错|理解错|搞错)(?:了)?(?:我|我的)/,
  /(?:这|那)(?:不是|并非)我的(?:偏好|习惯|情况|信息|边界)/,
  /我(?:没有|从没|从未)(?:说过|表示过|要求过)(?:这|那|这个|那个)/,
  /(?:不要|别再)(?:认为|假设|记成)(?:我|我的)/,
  /you (?:remembered|understood|got) (?:me|my .+?) wrong\b/i,
  /that(?:'s| is) not my (?:preference|habit|situation|information|boundary)\b/i,
  /i (?:never|did not|didn't) (?:say|said|tell you|told you|ask for|asked for) that\b/i,
  /do not assume that about me\b/i,
];

const UNDERSTANDING_CORRECTION_CONTENT_PATTERNS: RegExp[] = [
  /(?:你|您)(?:记错|理解错|搞错)(?:了)?(?:我|我的)(?:偏好|习惯|情况|信息|边界|工作方式)?[，,:：；;。]\s*(?:其实|实际上|正确的是)?\s*(.+)$/,
  /(?:这|那)(?:不是|并非)我的(?:偏好|习惯|情况|信息|边界)[，,:：；;。]\s*(.+)$/,
  /you (?:remembered|understood|got) (?:me|my .+?) wrong\b[,:;.]?\s*(?:actually[,:]?\s*)?(.+)$/i,
  /that(?:'s| is) not my (?:preference|habit|situation|information|boundary)\b[,:;.]?\s*(.+)$/i,
];

function normalizeCorrectionContent(content: string): string | null {
  const normalized = content
    .replace(/^[“”‘’"'\s]+|[“”‘’"'\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length >= 4 ? normalized.slice(0, 600) : null;
}

export function isExplicitUnderstandingCorrection(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 0
    && UNDERSTANDING_CORRECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Returns only a concrete replacement statement; pure denials intentionally return null. */
export function extractExplicitUnderstandingCorrectionContent(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!isExplicitUnderstandingCorrection(normalized)) return null;
  for (const pattern of UNDERSTANDING_CORRECTION_CONTENT_PATTERNS) {
    const match = pattern.exec(normalized);
    if (!match?.[1]) continue;
    const content = normalizeCorrectionContent(match[1]);
    if (content) return content;
  }
  return null;
}
