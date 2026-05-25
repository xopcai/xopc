/** Append STT transcript to existing composer draft (space-separated when draft has text). */
export function appendTranscriptToDraft(prev: string, transcript: string): string {
  const t = transcript.trim();
  if (!t) return prev;
  const p = prev.trim();
  if (!p) return t;
  return `${p} ${t}`;
}
