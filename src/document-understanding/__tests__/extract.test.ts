import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import { extractDocumentText } from '../extract.js';

describe('document text extraction', () => {
  it('extracts text from an Office Open XML document', () => {
    const zip = new AdmZip();
    zip.addFile('word/document.xml', Buffer.from(
      '<w:document><w:body><w:p><w:r><w:t>Launch plan</w:t></w:r></w:p><w:p><w:r><w:t>Review onboarding.</w:t></w:r></w:p></w:body></w:document>',
    ));

    expect(extractDocumentText({ buffer: zip.toBuffer(), fileName: 'plan.docx' })).toEqual({
      ok: true,
      kind: 'office',
      text: 'Launch plan\nReview onboarding.',
    });
  });

  it('extracts known plain-text extensions without requiring a MIME type', () => {
    expect(extractDocumentText({ buffer: Buffer.from('# Current work'), fileName: 'work.md' })).toEqual({
      ok: true,
      kind: 'plain',
      text: '# Current work',
    });
  });
});
