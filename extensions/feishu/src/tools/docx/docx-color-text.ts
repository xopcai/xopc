import type * as Lark from '@larksuiteoapi/node-sdk';

const TEXT_COLOR: Record<string, number> = {
  red: 1,
  orange: 2,
  yellow: 3,
  green: 4,
  blue: 5,
  purple: 6,
  grey: 7,
  gray: 7,
};

const BACKGROUND_COLOR: Record<string, number> = {
  red: 1,
  orange: 2,
  yellow: 3,
  green: 4,
  blue: 5,
  purple: 6,
  grey: 7,
  gray: 7,
};

function normalizeLower(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

interface Segment {
  text: string;
  textColor?: number;
  bgColor?: number;
  bold?: boolean;
}

type DocxPatchPayload = NonNullable<Parameters<Lark.Client['docx']['documentBlock']['patch']>[0]>;
type DocxTextElement = NonNullable<
  NonNullable<NonNullable<DocxPatchPayload['data']>['update_text_elements']>['elements']
>[number];

export function parseColorMarkup(content: string): Segment[] {
  const segments: Segment[] = [];
  const KNOWN = '(?:bg:[a-z]+|bold|red|orange|yellow|green|blue|purple|gr[ae]y)';
  const tagPattern = new RegExp(
    `\\[(${KNOWN}(?:\\s+${KNOWN})*)\\](.*?)\\[\\/(?:[^\\]]+)\\]|([^[]+|\\[)`,
    'gis',
  );

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(content)) !== null) {
    if (match[3] !== undefined) {
      if (match[3]) segments.push({ text: match[3] });
      continue;
    }
    const tagStr = normalizeLower(match[1] || '');
    const text = match[2] || '';
    const tags = tagStr.split(/\s+/).filter(Boolean);
    const segment: Segment = { text };
    for (const tag of tags) {
      if (tag.startsWith('bg:')) {
        const color = tag.slice(3);
        if (BACKGROUND_COLOR[color]) segment.bgColor = BACKGROUND_COLOR[color];
      } else if (tag === 'bold') {
        segment.bold = true;
      } else if (TEXT_COLOR[tag]) {
        segment.textColor = TEXT_COLOR[tag];
      }
    }
    if (text) segments.push(segment);
  }
  return segments;
}

export async function updateColorText(client: Lark.Client, docToken: string, blockId: string, content: string) {
  const segments = parseColorMarkup(content);
  const elements: DocxTextElement[] = segments.map((seg) => ({
    text_run: {
      content: seg.text,
      text_element_style: {
        ...(seg.textColor ? { text_color: seg.textColor } : {}),
        ...(seg.bgColor ? { background_color: seg.bgColor } : {}),
        ...(seg.bold ? { bold: true } : {}),
      },
    },
  }));

  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: { update_text_elements: { elements } },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, segments: segments.length, block: res.data?.block };
}

import type * as Lark from '@larksuiteoapi/node-sdk';

const TEXT_COLOR: Record<string, number> = {
  red: 1,
  orange: 2,
  yellow: 3,
  green: 4,
  blue: 5,
  purple: 6,
  grey: 7,
  gray: 7,
};

const BACKGROUND_COLOR: Record<string, number> = {
  red: 1,
  orange: 2,
  yellow: 3,
  green: 4,
  blue: 5,
  purple: 6,
  grey: 7,
  gray: 7,
};

function normalizeLower(s: string): string {
  return (s ?? '').trim().toLowerCase();
}

interface Segment {
  text: string;
  textColor?: number;
  bgColor?: number;
  bold?: boolean;
}

type DocxPatchPayload = NonNullable<Parameters<Lark.Client['docx']['documentBlock']['patch']>[0]>;
type DocxTextElement = NonNullable<
  NonNullable<NonNullable<DocxPatchPayload['data']>['update_text_elements']>['elements']
>[number];

export function parseColorMarkup(content: string): Segment[] {
  const segments: Segment[] = [];
  const KNOWN = '(?:bg:[a-z]+|bold|red|orange|yellow|green|blue|purple|gr[ae]y)';
  const tagPattern = new RegExp(
    `\\[(${KNOWN}(?:\\s+${KNOWN})*)\\](.*?)\\[\\/(?:[^\\]]+)\\]|([^[]+|\\[)`,
    'gis',
  );

  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(content)) !== null) {
    if (match[3] !== undefined) {
      if (match[3]) segments.push({ text: match[3] });
      continue;
    }
    const tagStr = normalizeLower(match[1] || '');
    const text = match[2] || '';
    const tags = tagStr.split(/\s+/).filter(Boolean);
    const segment: Segment = { text };
    for (const tag of tags) {
      if (tag.startsWith('bg:')) {
        const color = tag.slice(3);
        if (BACKGROUND_COLOR[color]) segment.bgColor = BACKGROUND_COLOR[color];
      } else if (tag === 'bold') {
        segment.bold = true;
      } else if (TEXT_COLOR[tag]) {
        segment.textColor = TEXT_COLOR[tag];
      }
    }
    if (text) segments.push(segment);
  }
  return segments;
}

export async function updateColorText(client: Lark.Client, docToken: string, blockId: string, content: string) {
  const segments = parseColorMarkup(content);
  const elements: DocxTextElement[] = segments.map((seg) => ({
    text_run: {
      content: seg.text,
      text_element_style: {
        ...(seg.textColor ? { text_color: seg.textColor } : {}),
        ...(seg.bgColor ? { background_color: seg.bgColor } : {}),
        ...(seg.bold ? { bold: true } : {}),
      },
    },
  }));

  const res = await client.docx.documentBlock.patch({
    path: { document_id: docToken, block_id: blockId },
    data: { update_text_elements: { elements } },
  });
  if (res.code !== 0) throw new Error(res.msg);
  return { success: true, segments: segments.length, block: res.data?.block };
}

