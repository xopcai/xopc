import { describe, it, expect } from 'vitest';
import { placeholderSvg, thumbnailContentType } from '../share-thumbnail.js';

describe('placeholderSvg', () => {
  it('produces SVG bytes containing the file name', () => {
    const buf = placeholderSvg('weekend-plan.html', 'html');
    const text = buf.toString('utf8');
    expect(text).toContain('<svg');
    expect(text).toContain('weekend-plan.html');
    expect(text).toContain('1200');
    expect(text).toContain('630');
  });

  it('clips long file names with ellipsis', () => {
    const long = 'really-long-file-name-'.repeat(5);
    const buf = placeholderSvg(long, 'file');
    expect(buf.toString('utf8')).toContain('...');
  });

  it('escapes XML-unsafe chars', () => {
    const buf = placeholderSvg('a<b>"c"&d', 'file');
    const t = buf.toString('utf8');
    expect(t).not.toContain('<b>');
    expect(t).toContain('&lt;');
  });
});

describe('thumbnailContentType', () => {
  it('detects JPEG magic', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(thumbnailContentType(buf)).toBe('image/jpeg');
  });
  it('detects PNG magic', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(thumbnailContentType(buf)).toBe('image/png');
  });
  it('falls back to SVG for unknown bytes', () => {
    expect(thumbnailContentType(Buffer.from('<svg', 'utf8'))).toBe('image/svg+xml');
  });
});
