/** Quotes may use decoded tool text or its JSON representation, never metadata-only fields. */
function supportTexts(text: string, tool: boolean): string[] {
  if (!tool) return [text];
  const texts: string[] = [];
  for (const line of text.split('\n')) {
    try {
      const row = JSON.parse(line);
      if (row?.role !== 'toolResult' || !Array.isArray(row.content)) continue;
      for (const block of row.content) {
        if (block?.type === 'text' && typeof block.text === 'string') {
          texts.push(block.text, JSON.stringify(block.text));
          try {
            const canonical = JSON.stringify(JSON.parse(block.text));
            texts.push(canonical, JSON.stringify(canonical));
          } catch { /* Plain text needs no JSON normalization. */ }
        }
      }
    } catch { if (line) texts.push(line); }
  }
  return texts;
}

/** Validate semantic diagnostics before assigning a failure stage. */
export function validateJudgment(raw: string, input: any): any {
  const value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  if (typeof value.correct !== 'boolean' || typeof value.unsupportedClaim !== 'boolean'
    || typeof value.reason !== 'string' || !value.reason.trim()
    || !(value.benchmarkConcern === null || typeof value.benchmarkConcern === 'string')) throw new Error('Invalid judgment schema');
  for (const [key, textKey] of [['storedSupport', 'storedText'], ['selectedSupport', 'selectedText'], ['toolSupport', 'toolText']]) {
    const evidence = value[key!];
    if (!evidence || typeof evidence.sufficient !== 'boolean' || typeof evidence.quote !== 'string') throw new Error(`Invalid ${key}`);
    if (evidence.sufficient && (!evidence.quote.trim() || !supportTexts(input[textKey!], textKey === 'toolText').some(text => text.includes(evidence.quote)))) throw new Error(`Ungrounded ${key}`);
    if (!evidence.sufficient && evidence.quote !== '') throw new Error(`Unexpected quote for absent ${key}`);
  }
  return value;
}

export function attribution(judgment: any, input: any): string {
  if (input.error) return 'capture_error';
  if (judgment.benchmarkConcern) return 'benchmark_review';
  if (judgment.correct) return 'passed';
  if (input.gold?.abstention) return 'abstention_or_entity_misattribution';
  if (input.diagnosticsTruncated) return 'diagnostics_incomplete';
  if (judgment.selectedSupport.sufficient || judgment.toolSupport.sufficient) return 'evidence_available_but_answer_failed';
  if (judgment.storedSupport.sufficient) return 'retrieval_or_selection_or_tool_use';
  if (input.learningErrors?.length) return 'learning_error_with_missing_support';
  return 'learning_or_admission_or_update';
}
