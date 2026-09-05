import { stripMarkdown } from '../tts/preprocess.js';

const SENTENCE_END = /[。！？!?；;：:\n]/u;

/** Streams spoken prose, keeping code and link targets out of synthesis. */
export class SpeakableSegmenter {
  private pending = '';
  private fence: string | null = null;

  constructor(private readonly maxCharacters = 120) {}

  push(delta: string): string[] {
    this.pending += delta;
    const phrases: string[] = [];
    while (this.pending) {
      if (this.fence) {
        const end = this.pending.indexOf(this.fence);
        if (end < 0) { this.pending = this.pending.slice(-2); break; }
        this.pending = this.pending.slice(end + this.fence.length);
        this.fence = null;
        continue;
      }
      const openingFence = this.pending.match(/^\s*(```|~~~)/);
      if (openingFence) {
        this.pending = this.pending.trimStart();
        const newline = this.pending.indexOf('\n');
        if (newline < 0) break;
        this.fence = openingFence[1];
        this.pending = this.pending.slice(newline + 1);
        continue;
      }
      if (/^\s*\|/.test(this.pending)) {
        const newline = this.pending.indexOf('\n', this.pending.search(/\|/));
        if (newline < 0) break;
        this.pending = this.pending.slice(newline + 1);
        continue;
      }
      let boundary = -1;
      let brackets = 0;
      let parentheses = 0;
      let inlineCode = false;
      for (let index = 0; index < this.pending.length; index += 1) {
        if (!parentheses && /^https?:\/\//.test(this.pending.slice(index))) {
          const end = this.pending.slice(index).search(/\s/);
          if (end < 0) break;
          index += end - 1;
          continue;
        }
        const char = this.pending[index];
        if (char === '`') inlineCode = !inlineCode;
        if (char === '[') brackets += 1;
        if (char === ']') brackets = Math.max(0, brackets - 1);
        if (char === '(') parentheses += 1;
        if (char === ')') parentheses = Math.max(0, parentheses - 1);
        if (inlineCode || brackets || parentheses || (char === ']' && this.pending[index + 1] === '(')) continue;
        if (SENTENCE_END.test(char)) { boundary = index + 1; break; }
        if (index + 1 >= this.maxCharacters) {
          const window = this.pending.slice(0, index + 1);
          const whitespace = Math.max(window.lastIndexOf(' '), window.lastIndexOf('，'), window.lastIndexOf(','));
          boundary = whitespace > this.maxCharacters / 2 ? whitespace + 1 : index + 1;
          break;
        }
      }
      if (boundary < 0) break;
      const phrase = this.toSpeech(this.pending.slice(0, boundary));
      this.pending = this.pending.slice(boundary);
      if (phrase) phrases.push(phrase);
    }
    return phrases;
  }

  flush(): string[] {
    const phrase = this.fence || /^\s*(```|~~~)/.test(this.pending) ? '' : this.toSpeech(this.pending);
    this.pending = '';
    this.fence = null;
    return phrase ? [phrase] : [];
  }

  private toSpeech(text: string): string {
    return stripMarkdown(text)
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[*_~]/g, '')
      .replace(/^\s*\|.*\|\s*$/gm, '')
      .trim();
  }
}
