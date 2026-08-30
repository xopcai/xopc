/** Converts a localized “for example” placeholder into the value accepted by Tab. */
export function suggestionFromExample(placeholder: string): string {
  return placeholder
    .replace(/^(?:例如\s*[：:]?|for example\s*[：:]?|e\.g\.\s*)/i, '')
    .replace(/…$/, '')
    .trim();
}
