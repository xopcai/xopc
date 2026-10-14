import { describe, expect, it } from 'vitest';

import { extractReadableText } from '../web.js';

const definition = 'A missing resource response does not by itself establish whether the resource absence is temporary or permanent.';
const example = 'This is a detailed reference example explaining the request headers and a response body for a missing document.';

describe('personal live-source extraction benchmark v1', () => {
  it('W01-introduction: preserves short main definitions preceding long reference sections', async () => {
    const html = `<html><head><title>Reference</title></head><body><main><h1>Reference</h1><p>${definition}</p>
      <section><h2>Examples</h2>${Array.from({ length: 20 }, (_, index) => `<p>${example} Example ${index}.</p>`).join('')}</section></main></body></html>`;
    const text = await extractReadableText(html, 'https://example.test/reference');
    expect(text).toContain(definition); expect(text).toContain(example);
  });
  it('W02-provenance: extraction never adds invented definitions or duplicates retained source paragraphs', async () => {
    const text = await extractReadableText(`<html><body><main><h1>Reference</h1><p>${definition}</p>
      <p>${example}</p><p>${example} Additional details make this article readable.</p></main></body></html>`, 'https://example.test/reference');
    expect(text.split(definition)).toHaveLength(2); expect(text).not.toContain('permanently deleted');
  });
});
