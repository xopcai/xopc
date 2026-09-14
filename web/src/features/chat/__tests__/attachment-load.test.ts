import { describe, expect, it, vi } from 'vitest';

import { loadAttachment } from '@/features/chat/attachments/attachment-load';

vi.mock('@/features/chat/attachments/attachment-process-heavy', () => {
  throw new Error('Document parsers must not be needed to attach files');
});

describe('loadAttachment', () => {
  it.each(['pdf', 'docx', 'pptx', 'xlsx', 'xls', 'zip', 'bin'])(
    'preserves original %s bytes without requiring a working preview parser',
    async (extension) => {
      const bytes = new Uint8Array([0, 255, 1, 128]);
      const file = new File([bytes], `sample.${extension}`);
      const attachment = await loadAttachment(file);
      expect(attachment).toMatchObject({
        type: 'document', name: file.name, size: 4,
        content: Buffer.from(bytes).toString('base64'),
      });
      if (extension === 'pdf') expect(attachment.mimeType).toBe('application/pdf');
    },
  );

  it.each(['', 'application/octet-stream', 'application/vnd.ms-excel', 'text/csv'])(
    'loads CSV as text with browser MIME %j',
    async (type) => {
      const text = 'name,value\n示例,42';
      const file = new File([text], 'DATA.CSV', { type });
      expect(await loadAttachment(file)).toMatchObject({
        name: 'DATA.CSV', mimeType: 'text/csv', extractedText: text,
        content: Buffer.from(text).toString('base64'),
      });
    },
  );

  it('infers images when the browser omits their MIME', async () => {
    expect(await loadAttachment(new File(['image'], 'photo.png'))).toMatchObject({
      type: 'image', mimeType: 'image/png', preview: btoa('image'),
    });
  });

  it('still reports file read failures', async () => {
    const file = new File(['x'], 'file.pdf');
    vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('read failed'));
    await expect(loadAttachment(file)).rejects.toThrow('read failed');
  });
});
