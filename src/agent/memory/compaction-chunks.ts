import { estimateTextTokens } from './context-budget.js';

export interface CompactionSourceText {
  text: string;
  seq: number;
  entryId: string;
}

export interface HandoverChunk {
  text: string;
  sourceThroughSeq: number;
}

export interface CompactionChunkCursorState {
  index: number;
  offset: number;
}

/** Consume source text in order, fitting each chunk against the current ledger. */
export class CompactionChunkCursor {
  private index: number;
  private offset: number;

  constructor(
    private readonly sources: readonly CompactionSourceText[],
    state: CompactionChunkCursorState = { index: 0, offset: 0 },
  ) {
    const source = sources[state.index];
    if (!Number.isInteger(state.index) || state.index < 0 || state.index > sources.length
      || !Number.isInteger(state.offset) || state.offset < 0
      || (state.index === sources.length ? state.offset !== 0 : state.offset > source!.text.length)) {
      throw new Error('Invalid compaction chunk checkpoint');
    }
    this.index = state.index;
    this.offset = state.offset;
  }

  get done(): boolean {
    return this.index >= this.sources.length;
  }

  checkpoint(): CompactionChunkCursorState {
    return { index: this.index, offset: this.offset };
  }

  next(maxTokens: number, fits: (text: string) => boolean): HandoverChunk {
    const parts: string[] = [];
    let sourceThroughSeq = 0;
    const accepts = (part: string) => {
      const text = [...parts, part].join('\n\n');
      return estimateTextTokens(text) <= maxTokens && fits(text);
    };
    while (!this.done) {
      const source = this.sources[this.index]!;
      const remaining = source.text.slice(this.offset);
      const wrap = (length: number) => this.offset === 0 && length === source.text.length
        ? source.text
        : `<record_fragment seq="${source.seq}" entry_id="${source.entryId}" offset="${this.offset}" end="${this.offset + length}" total_chars="${source.text.length}">\n${remaining.slice(0, length)}\n</record_fragment>`;
      if (accepts(wrap(remaining.length))) {
        parts.push(wrap(remaining.length));
        sourceThroughSeq = source.seq;
        this.index += 1;
        this.offset = 0;
        continue;
      }
      if (parts.length > 0) break;
      let low = 0;
      let high = remaining.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (accepts(wrap(middle))) low = middle;
        else high = middle - 1;
      }
      // Avoid tiny fragments and never cut a UTF-16 surrogate pair in half.
      if (low > 0 && /[\uD800-\uDBFF]/.test(remaining[low - 1]!)) low -= 1;
      if (low < Math.min(256, remaining.length)) {
        throw new Error('Compaction context budget cannot fit the ledger, output reserve and a source fragment');
      }
      parts.push(wrap(low));
      sourceThroughSeq = source.seq;
      this.offset += low;
      break;
    }
    return { text: parts.join('\n\n'), sourceThroughSeq };
  }
}
