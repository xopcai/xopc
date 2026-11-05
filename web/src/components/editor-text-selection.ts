/** A selection is bound to an editor document, never to matching text elsewhere. */
export interface EditorTextSelection {
  text: string;
  rect: { left: number; right: number; top: number; bottom: number };
  insertAfter: (markdown: string) => boolean;
  restore: () => void;
}
