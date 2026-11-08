export function recallCitationIds(answer: string): string[] {
  return [...answer.matchAll(/\[([^\]\n]{1,300})\]/gu)].flatMap(match => {
    const prefix = match[1].split(/[:：“「"]/u)[0];
    return /^H\d+\b/u.test(prefix) ? [...prefix.matchAll(/\bH\d+\b/gu)].map(item => item[0]) : [];
  });
}

/** Check citation identity and verbatim quotes, not the truth of a model's reasoning. */
export function recallAnswerCorrection(systemPrompt: string, answer: string): string | undefined {
  if (!systemPrompt.includes('On-demand recall:') || answer.trim() === 'NO_REPLY') return;
  const sources = new Map<string, string>();
  for (const match of systemPrompt.matchAll(/^\[(H\d+)\] recordedAt=[^\n]+? owner said: ("[^\n]*")$/gmu)) {
    try { sources.set(match[1], JSON.parse(match[2])); } catch { /* Ignore malformed source lines. */ }
  }
  const issues: string[] = [];
  const citations = recallCitationIds(answer);
  const abstains = /没有.{0,35}(?:记录|依据|证据)|(?:证据|信息|记录).{0,15}(?:不足|缺失)|不知道|无法(?:确认|判断|回答)|\b(?:no .{0,20}(?:evidence|record)|insufficient|don't know)\b/iu.test(answer);
  if (systemPrompt.includes('reason=historical_question') && sources.size && !citations.length && !abstains) issues.push('Historical factual answer is missing a source citation');
  for (const id of citations) {
    if (!sources.has(id)) issues.push(`Unknown citation ${id}`);
  }
  const normalize = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '');
  const checkQuote = (quote: string, reference: string) => {
    const ids = recallCitationIds(reference);
    if (ids.length && !ids.some(id => sources.has(id) && normalize(sources.get(id)!).includes(normalize(quote)))) {
      issues.push(`The quoted text attached to ${ids.join(', ')} is not a verbatim excerpt`);
    }
  };
  for (const match of answer.matchAll(/[“「"]([^”」"\n]{6,})[”」"]\s*(\[[^\]\n]{1,300}\])/gu)) checkQuote(match[1], match[2]);
  for (const match of answer.matchAll(/\[(H\d+(?:[,，、 ]+H\d+)*)[:：]\s*[“「"]([^”」"\n]{6,})[”」"]\]/gu)) checkQuote(match[2], `[${match[1]}]`);
  if (!issues.length) return;
  return `The draft's historical citations failed host provenance checks: ${[...new Set(issues)].join('; ')}. Revise the answer now. Use only these current source IDs: ${[...sources.keys()].join(', ') || '(none)'}. Copy short quoted excerpts exactly from their source; describe paraphrases as paraphrases without quotation marks. Distinguish historical and current facts. Do not invent evidence; disclose what is missing. Return the corrected final answer in the user's language.`;
}
