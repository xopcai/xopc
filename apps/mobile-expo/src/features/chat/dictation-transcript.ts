type Segment = { revision: number; text: string; final: boolean };

/** Providers revise whole utterances; a final may share the last partial's revision. */
export class DictationTranscript {
  private segments = new Map<string, Segment>();
  update(utteranceId: string, revision: number, text: string, final: boolean): void {
    const previous = this.segments.get(utteranceId);
    if (previous && (revision < previous.revision || (revision === previous.revision && (previous.final || !final)))) return;
    this.segments.set(utteranceId, { revision, text, final });
  }
  text(finalOnly = false): string {
    return [...this.segments.values()].filter(item => !finalOnly || item.final).map(item => item.text).join(' ').trim();
  }
}
