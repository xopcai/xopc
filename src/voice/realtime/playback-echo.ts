export function normalizeSpeech(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function isPlaybackStopPhrase(normalizedSpeech: string): boolean {
  return /^(?:暂停|停一下|先停一下|暂停一下|先别说了|别说了|stoptalking|pleasestop)$/u.test(normalizedSpeech);
}

function normalizeSpokenDigits(text: string): string {
  return text.replace(/[零一二三四五六七八九]/gu, digit => String('零一二三四五六七八九'.indexOf(digit)));
}

function matchesSpokenDigitList(transcript: string, playback: string): boolean {
  if (!/^[\d零一二三四五六七八九]{2,5}$/u.test(transcript)) return false;
  const digits = normalizeSpokenDigits(transcript);
  // ASR can collapse a spoken list such as “1、2、3” into a single number.
  const list = /(?<!\d)\d(?!\d)(?:[、,。;\s]+\d(?!\d))+/gu;
  const spoken = normalizeSpokenDigits(playback.normalize('NFKC')).replace(/\.{2,}/gu, '、');
  for (const [sequence] of spoken.matchAll(list)) {
    if (sequence.replace(/\D/gu, '').includes(digits)) return true;
  }
  return false;
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

function matchesEnglishPlaybackWithHanInsertion(transcript: string, heard: string, spoken: string): boolean {
  // A Mandarin recognizer can insert a Han character inside otherwise English playback.
  if (!/[a-z]\p{Script=Han}[a-z]/iu.test(transcript)) return false;
  const latin = heard.replace(/\p{Script=Han}/gu, '');
  if (heard.length - latin.length !== 1 || !/^[a-z]{10,}$/u.test(latin)) return false;
  for (const [span] of spoken.matchAll(/[a-z]{10,}/gu)) {
    if (span.includes(latin.slice(0, 8)) && closestSubstringEditDistance(latin, span) <= 2) return true;
  }
  return false;
}

/** Conservatively identifies finalized ASR that is already in audible assistant output. */
export function isLikelyPlaybackEcho(transcript: string, assistantText: string): boolean {
  const heard = normalizeSpeech(transcript);
  const spoken = normalizeSpeech(assistantText);
  if (!heard || !spoken) return false;
  if (matchesSpokenDigitList(heard, assistantText)) return true;
  const containsCjk = /\p{Script=Han}/u.test(heard);
  if (heard.length < (containsCjk ? 3 : 6)) return isPlaybackStopPhrase(heard) && spoken.includes(heard);
  if (spoken.includes(heard)) return true;
  // Keep the edit-distance fallback bounded for long model and ASR output.
  if (heard.length > 200 || spoken.length > 8_000) return false;
  if (containsCjk && /[a-z]/u.test(heard)) {
    const heardHan = heard.replace(/[^\p{Script=Han}]/gu, '');
    const spokenHan = spoken.replace(/[^\p{Script=Han}]/gu, '');
    if (!spokenHan.includes(heardHan)) return matchesEnglishPlaybackWithHanInsertion(transcript, heard, spoken);
  }

  // Speaker echo is often finalized with one or two dropped/substituted
  // characters. Keep fuzzy matching limited to substantial utterances so
  // short, intentional interruptions such as "停一下" and "wait" survive.
  if (containsCjk && heard.length >= 4 && heard.length <= 5) {
    return closestSubstringEditDistance(heard, spoken) <= 1;
  }
  if (heard.length < (containsCjk ? 6 : 10)) return false;
  const distance = closestSubstringEditDistance(heard, spoken);
  return distance / Array.from(heard).length <= 0.22;
}

/** Retains the playback at speech onset while a provider finishes delayed ASR. */
export class PlaybackEchoCandidates {
  private readonly candidates = new Map<string, { text: string; expiresAt: number }>();

  remember(utteranceId: string, text: string | undefined): void {
    if (!text || this.candidates.has(utteranceId)) return;
    const now = Date.now();
    for (const [id, candidate] of this.candidates) {
      if (candidate.expiresAt < now) this.candidates.delete(id);
    }
    if (this.candidates.size >= 256) this.candidates.delete(this.candidates.keys().next().value!);
    this.candidates.set(utteranceId, { text: text.slice(-8_000), expiresAt: now + 30_000 });
  }

  isEcho(utteranceId: string, transcript: string, currentPlayback?: string): boolean {
    const candidate = this.candidates.get(utteranceId);
    return Boolean((currentPlayback && isLikelyPlaybackEcho(transcript, currentPlayback))
      || (candidate && candidate.text !== currentPlayback && candidate.expiresAt >= Date.now()
        && isLikelyPlaybackEcho(transcript, candidate.text)));
  }

  matches(utteranceId: string, transcript: string, currentPlayback?: string): boolean {
    const echo = this.isEcho(utteranceId, transcript, currentPlayback);
    this.candidates.delete(utteranceId);
    return echo;
  }

  clear(): void { this.candidates.clear(); }
}
