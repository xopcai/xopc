function normalizeSpeech(text: string): string {
  return text.toLocaleLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function closestSubstringEditDistance(pattern: string, text: string): number {
  const needle = Array.from(pattern);
  const haystack = Array.from(text);
  let previous = new Uint16Array(haystack.length + 1);
  for (let index = 0; index <= haystack.length; index += 1) previous[index] = 0;

  for (let row = 1; row <= needle.length; row += 1) {
    const current = new Uint16Array(haystack.length + 1);
    current[0] = row;
    for (let column = 1; column <= haystack.length; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (needle[row - 1] === haystack[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return Math.min(...previous);
}

/** Conservatively identifies finalized ASR that is already in audible assistant output. */
export function isLikelyPlaybackEcho(transcript: string, assistantText: string): boolean {
  const heard = normalizeSpeech(transcript);
  const spoken = normalizeSpeech(assistantText);
  if (!heard || !spoken) return false;
  const containsCjk = /\p{Script=Han}/u.test(heard);
  if (heard.length < (containsCjk ? 3 : 6)) return false;
  if (spoken.includes(heard)) return true;

  // Speaker echo is often finalized with one or two dropped/substituted
  // characters. Keep fuzzy matching limited to substantial utterances so
  // short, intentional interruptions such as "停一下" and "wait" survive.
  if (heard.length < (containsCjk ? 6 : 10)) return false;
  const distance = closestSubstringEditDistance(heard, spoken);
  return distance / Array.from(heard).length <= 0.22;
}
