function normalizeSpeech(text: string): string {
  return text.toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Conservatively identifies finalized ASR that is already in audible assistant output. */
export function isLikelyPlaybackEcho(transcript: string, assistantText: string): boolean {
  const heard = normalizeSpeech(transcript);
  const spoken = normalizeSpeech(assistantText);
  if (!heard || !spoken) return false;
  const containsCjk = /\p{Script=Han}/u.test(heard);
  if (heard.length < (containsCjk ? 3 : 6)) return false;
  return spoken.includes(heard);
}
