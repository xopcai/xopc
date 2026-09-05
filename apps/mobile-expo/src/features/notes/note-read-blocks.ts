export type NoteReadBlock =
  | { kind: 'markdown'; key: string; content: string }
  | { kind: 'image'; key: string; alt: string; uri?: string };

export function buildNoteReadBlocks(
  markdown: string,
  attachmentSrcMap: Record<string, string>,
): NoteReadBlock[] {
  const blocks: NoteReadBlock[] = [];
  const pattern = /!\[([^\]]*)\]\((xopc-attachment:\/\/notes\/[^\s)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index).trim();
    if (before) blocks.push({ kind: 'markdown', key: `text:${lastIndex}`, content: before });
    const source = match[2];
    blocks.push({
      kind: 'image',
      key: `image:${source}:${match.index}`,
      alt: match[1]?.trim() || 'Image',
      uri: attachmentSrcMap[source],
    });
    lastIndex = match.index + match[0].length;
  }
  const tail = markdown.slice(lastIndex).trim();
  if (tail) blocks.push({ kind: 'markdown', key: `text:${lastIndex}`, content: tail });
  return blocks;
}
