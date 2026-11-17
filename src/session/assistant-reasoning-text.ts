const REASONING_TAGS = ['think', 'thinking', 'analysis', 'reasoning'];
const LEADING_TAG = /^<\s*(\/?)\s*(think|thinking|analysis|reasoning)\s*>/i;
const PARTIAL_TAG = /^<\s*\/?\s*([a-z]*)\s*$/i;
const PARTIAL_CLOSING_TAG = /<\s*(?:\/\s*[a-z]*\s*)?$/i;

/** Strip leading provider reasoning tags while keeping the published text append-only. */
export class LeadingAssistantReasoningFilter {
  private prefix: string | undefined = '';
  private closingTag?: RegExp;
  private removedReasoning = false;

  append(chunk: string, complete = false): string {
    if (this.prefix === undefined) return chunk;
    this.prefix += chunk;
    for (;;) {
      if (this.closingTag) {
        const closing = this.closingTag.exec(this.prefix);
        if (!closing) {
          // Hold just a potential split closing tag between chunks, excluding its contents.
          this.prefix = complete ? undefined : PARTIAL_CLOSING_TAG.exec(this.prefix)?.[0] ?? '';
          return '';
        }
        this.prefix = this.prefix.slice(closing.index + closing[0].length);
        this.closingTag = undefined;
      }

      const candidate = this.prefix.trimStart();
      const tag = LEADING_TAG.exec(candidate);
      if (tag) {
        this.removedReasoning = true;
        this.prefix = candidate.slice(tag[0].length);
        if (!tag[1]) this.closingTag = new RegExp(`<\\s*\\/\\s*${tag[2]}\\s*>`, 'i');
        continue;
      }

      const partial = PARTIAL_TAG.exec(candidate);
      if (!complete && (!candidate || (partial && REASONING_TAGS.some(name => name.startsWith(partial[1].toLowerCase()))))) {
        return '';
      }
      const visible = this.removedReasoning ? candidate : this.prefix;
      this.prefix = undefined;
      return visible;
    }
  }
}

export function stripLeadingAssistantReasoning(text: string): string {
  return new LeadingAssistantReasoningFilter().append(text, true);
}
