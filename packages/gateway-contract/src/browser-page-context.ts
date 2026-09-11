import { z } from 'zod';

export const MAX_BROWSER_CONTEXTS_PER_TURN = 2;
export const MAX_BROWSER_SELECTION_BYTES = 32 * 1024;
export const MAX_BROWSER_PAGE_TEXT_BYTES = 128 * 1024;
export const MAX_BROWSER_CONTEXT_BODY_BYTES = 256 * 1024;

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

export const browserPageContextInputSchema = z.strictObject({
  kind: z.literal('browser_page'),
  sourceId: z.uuid(),
  version: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string().trim().min(1).max(512),
  url: z.url(),
  capturedAt: z.number().int().nonnegative(),
  documentId: z.string().trim().min(1).max(256),
  selection: z.string().optional(),
  text: z.string().optional(),
  truncated: z.boolean(),
}).superRefine((value, ctx) => {
  const url = new URL(value.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
    ctx.addIssue({ code: 'custom', path: ['url'], message: 'URL must be a sanitized HTTP(S) URL' });
  }
  if (!value.selection?.trim() && !value.text?.trim()) {
    ctx.addIssue({ code: 'custom', message: 'A browser context must include selection or page text' });
  }
  if (value.selection && utf8Bytes(value.selection) > MAX_BROWSER_SELECTION_BYTES) {
    ctx.addIssue({ code: 'custom', path: ['selection'], message: 'Selection is too large' });
  }
  if (value.text && utf8Bytes(value.text) > MAX_BROWSER_PAGE_TEXT_BYTES) {
    ctx.addIssue({ code: 'custom', path: ['text'], message: 'Page text is too large' });
  }
});

export const browserPageContextsInputSchema = z.array(browserPageContextInputSchema)
  .max(MAX_BROWSER_CONTEXTS_PER_TURN)
  .superRefine((value, ctx) => {
    if (utf8Bytes(JSON.stringify(value)) > MAX_BROWSER_CONTEXT_BODY_BYTES) {
      ctx.addIssue({ code: 'custom', message: 'Browser contexts are too large' });
    }
  });

export type BrowserPageContextInput = z.infer<typeof browserPageContextInputSchema>;
