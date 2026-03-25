/**
 * Append cron-style trigger lines to the heartbeat user prompt.
 */
export function appendCronEventLines(basePrompt: string, reasons: string[]): string {
  const cronReasons = reasons.filter((r) => r.startsWith('cron:'));
  if (cronReasons.length === 0) return basePrompt;
  return `${basePrompt}\n\nTriggered cron events:\n${cronReasons.join('\n')}`;
}
