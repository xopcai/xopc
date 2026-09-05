const SENTENCE_END = /[。！？!?；;：:\n]/u;

/** Emits stable, bounded phrases while preserving the exact assistant text. */
export class SpeakableSegmenter {
  private pending = '';

  constructor(private readonly maxCharacters = 120) {}

  push(delta: string): string[] {
    this.pending += delta;
    const phrases: string[] = [];
    while (this.pending) {
      let boundary = -1;
      for (let index = 0; index < this.pending.length; index += 1) {
        if (SENTENCE_END.test(this.pending[index])) boundary = index + 1;
        if (boundary > 0 || index + 1 >= this.maxCharacters) break;
      }
      if (boundary < 0 && this.pending.length >= this.maxCharacters) {
        const window = this.pending.slice(0, this.maxCharacters);
        const whitespace = Math.max(window.lastIndexOf(' '), window.lastIndexOf('，'), window.lastIndexOf(','));
        boundary = whitespace > this.maxCharacters / 2 ? whitespace + 1 : this.maxCharacters;
      }
      if (boundary < 0) break;
      const phrase = this.pending.slice(0, boundary).trim();
      this.pending = this.pending.slice(boundary);
      if (phrase) phrases.push(phrase);
    }
    return phrases;
  }

  flush(): string[] {
    const phrase = this.pending.trim();
    this.pending = '';
    return phrase ? [phrase] : [];
  }
}
