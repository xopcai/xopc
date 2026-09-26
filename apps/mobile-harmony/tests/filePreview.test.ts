import { describe, expect, it } from 'vitest';
import { filePreviewKind, htmlPreviewTextLimit, normalizedFileMimeType, previewTextLimit, safeHtmlPreview } from '../entry/src/main/ets/common/filePreview.ets';

describe('mobile file preview parity', () => {
  it.each([
    ['photo.PNG', '', 'image'], ['voice.m4a', 'audio/mp4', 'audio'], ['clip.mp4', 'video/mp4', 'video'],
    ['README.md', '', 'markdown'], ['page.htm', '', 'html'], ['page.html', 'text/html; charset=utf-8', 'html'],
    ['app.tsx', '', 'text'], ['config.yaml', 'application/octet-stream', 'text'], ['data.json', 'application/json', 'text'],
    ['report.pdf', 'application/pdf', 'binary'], ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'binary'],
  ])('classifies %s using name and MIME', (name, mimeType, kind) => {
    expect(filePreviewKind(name, mimeType)).toBe(kind);
  });

  it('infers a useful MIME type for system-app opening', () => {
    expect(normalizedFileMimeType('report.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(normalizedFileMimeType('page.html', 'text/html; charset=utf-8')).toBe('text/html');
  });

  it('limits large text without splitting a surrogate pair', () => {
    expect(previewTextLimit('abc', 10)).toBe('abc');
    expect(previewTextLimit('a😀b', 2)).toBe('a');
  });

  it('keeps complete HTML documents and rejects oversized ones instead of truncating markup', () => {
    expect(htmlPreviewTextLimit('<html>ok</html>')).toBe('<html>ok</html>');
    expect(htmlPreviewTextLimit('x'.repeat(4 * 1024 * 1024 + 1))).toBe('');
  });

  it('injects a restrictive policy into complete and fragment HTML', () => {
    for (const html of ['<html><head><title>x</title></head><body>ok</body></html>', '<h1>fragment</h1>']) {
      const safe = safeHtmlPreview(html);
      expect(safe).toContain("default-src 'none'");
      expect(safe).toContain("form-action 'none'");
      expect(safe).toContain("style-src 'unsafe-inline'");
      expect(safe).toContain("script-src 'unsafe-inline' blob:");
      expect(safe).toContain("connect-src 'none'");
      expect(safe).toContain('html,body{min-height:100%;margin:0;padding:0}');
      expect(safe).toContain(html.includes('<head>') ? '<title>x</title>' : '<h1>fragment</h1>');
    }
  });
});
