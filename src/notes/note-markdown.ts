import { attachmentIdFromTarget } from './attachment-ref.js';

export interface NoteHeading {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  start: number;
  end: number;
  path: string[];
}

export interface NoteSection {
  id: string;
  heading?: NoteHeading;
  start: number;
  end: number;
  markdown: string;
  plainText: string;
}

export interface NoteTaskItem {
  id: string;
  text: string;
  checked: boolean;
  start: number;
  end: number;
  line: number;
}

export interface NoteWikiLink {
  raw: string;
  target: string;
  alias?: string;
  heading?: string;
  start: number;
  end: number;
}

export interface NoteAttachmentRef {
  attachmentId: string;
  start: number;
  end: number;
}

export interface NoteCallout {
  type: string;
  title?: string;
  start: number;
  end: number;
}

export interface ParsedNoteMarkdown {
  plainText: string;
  headings: NoteHeading[];
  sections: NoteSection[];
  tasks: NoteTaskItem[];
  tags: string[];
  wikilinks: NoteWikiLink[];
  attachments: NoteAttachmentRef[];
  callouts: NoteCallout[];
  codeBlocks: Array<{ lang?: string; start: number; end: number; code: string }>;
}

const WIKILINK = /!??\[\[([^\]]+)\]\]/g;
const TAG = /(^|\s)#([\p{L}\p{N}_/-]+)/gu;
const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const MARKDOWN_LINK = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
const BARE_ATTACHMENT_REF = /xopc-attachment:\/\/notes\/([^/]+)\/([^/?#"'\s)]+)/gi;

function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/^---[\s\S]*?\n---\s*/m, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(MARKDOWN_IMAGE, ' ')
    .replace(MARKDOWN_LINK, '$1')
    .replace(WIKILINK, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineOffsets(markdown: string): Array<{ line: string; start: number; end: number }> {
  const lines: Array<{ line: string; start: number; end: number }> = [];
  let start = 0;
  for (const part of markdown.split(/\n/)) {
    const end = start + part.length;
    lines.push({ line: part, start, end });
    start = end + 1;
  }
  return lines;
}

export function parseNoteMarkdown(markdown = '', noteId?: string): ParsedNoteMarkdown {
  const headings: NoteHeading[] = [];
  const tasks: NoteTaskItem[] = [];
  const callouts: NoteCallout[] = [];
  const codeBlocks: ParsedNoteMarkdown['codeBlocks'] = [];
  const stack: string[] = [];
  let inCode: { start: number; lang?: string; lines: string[] } | null = null;

  lineOffsets(markdown).forEach(({ line, start, end }, index) => {
    const fence = /^```\s*([^`]*)$/.exec(line.trim());
    if (fence) {
      if (inCode) {
        codeBlocks.push({ start: inCode.start, end, lang: inCode.lang, code: inCode.lines.join('\n') });
        inCode = null;
      } else {
        inCode = { start, lang: fence[1]?.trim() || undefined, lines: [] };
      }
      return;
    }
    if (inCode) {
      inCode.lines.push(line);
      return;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const depth = heading[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      stack.length = depth - 1;
      stack[depth - 1] = heading[2].trim();
      headings.push({
        id: `heading-${headings.length + 1}`,
        depth,
        title: heading[2].trim(),
        start,
        end,
        path: stack.slice(0, depth),
      });
    }

    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (task) {
      tasks.push({
        id: `task-${tasks.length + 1}`,
        text: task[2].trim(),
        checked: task[1].toLowerCase() === 'x',
        start,
        end,
        line: index + 1,
      });
    }

    const callout = /^\s*>\s*\[!([A-Za-z0-9_-]+)\]\s*(.*)$/.exec(line);
    if (callout) {
      callouts.push({ type: callout[1].toLowerCase(), title: callout[2]?.trim() || undefined, start, end });
    }
  });

  if (inCode) {
    codeBlocks.push({ start: inCode.start, end: markdown.length, lang: inCode.lang, code: inCode.lines.join('\n') });
  }

  const sections: NoteSection[] = [];
  if (headings.length === 0) {
    sections.push({ id: 'section-1', start: 0, end: markdown.length, markdown, plainText: stripMarkdown(markdown) });
  } else {
    for (let i = 0; i < headings.length; i += 1) {
      const heading = headings[i];
      const next = headings.slice(i + 1).find((item) => item.depth <= heading.depth);
      const end = next?.start ?? markdown.length;
      const slice = markdown.slice(heading.start, end).trimEnd();
      sections.push({ id: `section-${i + 1}`, heading, start: heading.start, end, markdown: slice, plainText: stripMarkdown(slice) });
    }
  }

  const wikilinks: NoteWikiLink[] = [];
  for (const match of markdown.matchAll(WIKILINK)) {
    const rawInner = match[1];
    const [targetPart, alias] = rawInner.split('|');
    const [target, heading] = targetPart.split('#');
    wikilinks.push({ raw: match[0], target: target.trim(), heading: heading?.trim() || undefined, alias: alias?.trim() || undefined, start: match.index ?? 0, end: (match.index ?? 0) + match[0].length });
  }

  const tags = new Set<string>();
  for (const match of markdown.matchAll(TAG)) tags.add(match[2]);

  const attachments = new Map<string, NoteAttachmentRef>();
  const addAttachment = (target: string, start: number, end: number) => {
    const attachmentId = attachmentIdFromTarget(target, noteId ?? '');
    if (attachmentId) attachments.set(`${attachmentId}:${start}`, { attachmentId, start, end });
  };
  for (const match of markdown.matchAll(MARKDOWN_IMAGE)) addAttachment(match[2], match.index ?? 0, (match.index ?? 0) + match[0].length);
  for (const match of markdown.matchAll(MARKDOWN_LINK)) addAttachment(match[2], match.index ?? 0, (match.index ?? 0) + match[0].length);
  for (const match of markdown.matchAll(BARE_ATTACHMENT_REF)) {
    const start = match.index ?? 0;
    const matchedNoteId = decodeURIComponent(match[1]);
    if (!noteId || matchedNoteId === noteId) attachments.set(`${decodeURIComponent(match[2])}:${start}`, { attachmentId: decodeURIComponent(match[2]), start, end: start + match[0].length });
  }

  return {
    plainText: stripMarkdown(markdown),
    headings,
    sections,
    tasks,
    tags: [...tags],
    wikilinks,
    attachments: [...attachments.values()],
    callouts,
    codeBlocks,
  };
}

export function applyNotePatch(markdown: string, operations: import('./types.js').NotePatchOperation[], parsed = parseNoteMarkdown(markdown)): string {
  let next = markdown;
  const rangeOps = operations.filter((op) => op.type === 'replaceRange' || op.type === 'insertAt') as Array<Extract<import('./types.js').NotePatchOperation, { type: 'replaceRange' | 'insertAt' }>>;
  for (const op of [...rangeOps].sort((a, b) => (b.type === 'insertAt' ? b.offset : b.from) - (a.type === 'insertAt' ? a.offset : a.from))) {
    if (op.type === 'insertAt') next = `${next.slice(0, op.offset)}${op.markdown}${next.slice(op.offset)}`;
    else next = `${next.slice(0, op.from)}${op.markdown}${next.slice(op.to)}`;
  }
  for (const op of operations) {
    if (op.type === 'appendSection') next = `${next.trimEnd()}\n\n## ${op.heading}\n\n${op.markdown.trim()}\n`;
    if (op.type === 'prependSection') next = `## ${op.heading}\n\n${op.markdown.trim()}\n\n${next.trimStart()}`;
    if (op.type === 'replaceSection') {
      const section = parsed.sections.find((item) => item.id === op.sectionId);
      if (section) next = `${next.slice(0, section.start)}${op.markdown}${next.slice(section.end)}`;
    }
  }
  return next;
}
