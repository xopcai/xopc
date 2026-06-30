/** Assembled snapshot for `/context` (list, detail markdown, or JSON). */
export type SessionContextReportInput = {
  sessionKey: string;
  mode: 'list' | 'detail' | 'json';
  model: string;
  workspacePath: string;
  agentId: string;
  messageCount: number;
  contextWindowNominal: number;
  estimatedTranscriptTokens: number;
  thinkingDefault?: string;
  reasoningDefault?: string;
  verboseDefault?: string;
  compaction: unknown;
  toolsFlagsSummary: string;
  windowStats: unknown;
  compactionRunStats: unknown;
};

export function formatSessionContextReport(input: SessionContextReportInput): string {
  const {
    sessionKey,
    mode,
    model,
    workspacePath,
    agentId,
    messageCount,
    contextWindowNominal: cw,
    estimatedTranscriptTokens: estTokens,
    thinkingDefault,
    reasoningDefault,
    verboseDefault,
    compaction,
    toolsFlagsSummary,
    windowStats,
    compactionRunStats,
  } = input;

  const payload: Record<string, unknown> = {
    sessionKey,
    model,
    workspacePath,
    agentId,
    messageCount,
    contextWindowNominal: cw,
    estimatedTranscriptTokens: estTokens,
    approxWindowUsage: cw > 0 ? estTokens / cw : null,
    thinkingDefault,
    reasoningDefault,
    verboseDefault,
    compaction,
    toolsFlagsOn: toolsFlagsSummary,
    windowStats,
    compactionRunStats: compactionRunStats,
  };

  if (mode === 'json') {
    return JSON.stringify(payload, null, 2);
  }

  const lines: string[] = [
    '📎 *Context overview*',
    '',
    `• Session: \`${sessionKey}\``,
    `• Model: \`${model}\``,
    `• Agent profile: \`${agentId}\``,
    `• Workspace: \`${workspacePath}\``,
    `• Messages: ${messageCount}`,
    `• Est. transcript tokens (rough): ${estTokens}`,
    `• Nominal context budget (4× maxTokens): ${cw}`,
  ];
  if (cw > 0) {
    lines.push(`• Approx. usage vs budget: ${((estTokens / cw) * 100).toFixed(1)}%`);
  }
  lines.push(
    `• Thinking / reasoning / verbose defaults: ${thinkingDefault ?? '—'} / ${reasoningDefault ?? '—'} / ${verboseDefault ?? '—'}`,
    `• Tools (true flags): ${toolsFlagsSummary}`,
    '',
    '_Full system prompt, skills, and memory blocks are assembled at agent runtime; use Web settings or logs for deep inspection._',
  );

  if (mode === 'detail') {
    lines.push('', '*Compaction config:*', '```json');
    lines.push(JSON.stringify(compaction ?? {}, null, 2));
    lines.push('```', '', '*Window stats:*', '```json');
    lines.push(JSON.stringify(windowStats ?? {}, null, 2));
    lines.push('```');
  }

  return lines.join('\n');
}
