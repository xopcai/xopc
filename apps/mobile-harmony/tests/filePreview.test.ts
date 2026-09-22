import { describe, expect, it } from 'vitest';
import { filePreviewKind, previewTextLimit, safeHtmlPreview } from '../entry/src/main/ets/common/filePreview.ets';

describe('mobile file preview parity', () => {
  it.each([
    ['photo.PNG', '', 'image'], ['voice.m4a', 'audio/mp4', 'audio'], ['clip.mp4', 'video/mp4', 'video'],
    ['README.md', '', 'markdown'], ['page.htm', '', 'html'], ['app.tsx', '', 'text'],
    ['report.pdf', 'application/pdf', 'binary'], ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'binary'],
  ])('classifies %s using name and MIME', (name, mimeType, kind) => {
    expect(filePreviewKind(name, mimeType)).toBe(kind);
  });

  it('limits large text without splitting a surrogate pair', () => {
    expect(previewTextLimit('abc', 10)).toBe('abc');
    expect(previewTextLimit('a😀b', 2)).toBe('a');
  });

  it('injects a restrictive policy into complete and fragment HTML', () => {
    for (const html of ['<html><head><title>x</title></head><body>ok</body></html>', '<h1>fragment</h1>']) {
      const safe = safeHtmlPreview(html);
      expect(safe).toContain("default-src 'none'");
      expect(safe).toContain("form-action 'none'");
      expect(safe).toContain("style-src 'unsafe-inline'");
      expect(safe).toContain(html.includes('<head>') ? '<title>x</title>' : '<h1>fragment</h1>');
    }
  });
});
