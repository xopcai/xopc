/** Spoken @bot variants ("at botname", "hey botname") for STT text. */
export function checkMentionInTranscription(transcribedText: string, botNames: string[]): boolean {
  const normalizedText = transcribedText.toLowerCase().trim();

  for (const name of botNames) {
    const normalizedName = name.toLowerCase().trim();
    if (!normalizedName) continue;

    if (normalizedText.includes(normalizedName)) return true;

    const fuzzyPatterns = [`at ${normalizedName}`, `hey ${normalizedName}`, `hi ${normalizedName}`];
    if (fuzzyPatterns.some((pattern) => normalizedText.includes(pattern))) return true;
  }

  return false;
}
