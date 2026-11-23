export const NOTE_HEADING_LEVELS: Array<1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5, 6];

export const NOTE_STARTER_KIT_OPTIONS = {
  heading: { levels: [...NOTE_HEADING_LEVELS] },
  link: false as const,
  underline: false as const,
};

export const NOTE_TASK_ITEM_OPTIONS = { nested: true };

export const NOTE_LINK_OPTIONS = {
  autolink: true,
  protocols: ['xopc', 'xopc-attachment'],
  openOnClick: false,
  enableClickSelection: true,
};

export const NOTE_MARKDOWN_OPTIONS = {
  html: true,
  transformCopiedText: true,
  transformPastedText: true,
};

export interface NoteMarkdownEditor {
  storage: unknown;
}

export function serializeNoteMarkdown(editor: NoteMarkdownEditor): string {
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  const markdown = storage.markdown;
  if (!markdown?.getMarkdown) {
    throw new Error('The note editor requires the Markdown extension');
  }
  return markdown
    .getMarkdown()
    .replace(/^(>\s*)\\\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\\\]/gim, '$1[!$2]');
}
