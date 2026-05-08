import { describe, expect, it } from 'vitest';

import {
  imageAssetFromBase64,
  imageAssetFromDataUrl,
  imageFileExtensionForMimeType,
  mimeTypeFromFileName,
  parseImageDataUrl,
  sniffImageMimeType,
} from '../image-assets.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIF_HEADER = Buffer.from('GIF89a');
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP'),
]);

describe('sniffImageMimeType', () => {
  it('detects PNG / JPEG / GIF / WEBP and falls back to PNG', () => {
    expect(sniffImageMimeType(PNG_HEADER)).toEqual({ mimeType: 'image/png', fileExtension: 'png' });
    expect(sniffImageMimeType(JPEG_HEADER)).toEqual({ mimeType: 'image/jpeg', fileExtension: 'jpg' });
    expect(sniffImageMimeType(GIF_HEADER)).toEqual({ mimeType: 'image/gif', fileExtension: 'gif' });
    expect(sniffImageMimeType(WEBP_HEADER)).toEqual({ mimeType: 'image/webp', fileExtension: 'webp' });
    expect(sniffImageMimeType(Buffer.from([0x00]))).toEqual({ mimeType: 'image/png', fileExtension: 'png' });
  });

  it('accepts Uint8Array input', () => {
    const u8 = new Uint8Array(PNG_HEADER);
    expect(sniffImageMimeType(u8).mimeType).toBe('image/png');
  });
});

describe('imageFileExtensionForMimeType', () => {
  it('maps common MIME types to canonical extensions', () => {
    expect(imageFileExtensionForMimeType('image/png')).toBe('png');
    expect(imageFileExtensionForMimeType('image/jpeg')).toBe('jpg');
    expect(imageFileExtensionForMimeType('image/jpg')).toBe('jpg');
    expect(imageFileExtensionForMimeType('image/webp')).toBe('webp');
    expect(imageFileExtensionForMimeType('image/gif')).toBe('gif');
    expect(imageFileExtensionForMimeType('image/svg+xml')).toBe('svg');
    expect(imageFileExtensionForMimeType('image/x-bmp')).toBe('bmp');
    expect(imageFileExtensionForMimeType(undefined)).toBe('png');
    expect(imageFileExtensionForMimeType('application/octet-stream')).toBe('png');
  });
});

describe('parseImageDataUrl', () => {
  it('parses base64 data URLs and strips whitespace', () => {
    const b64 = PNG_HEADER.toString('base64');
    const url = `data:image/png;base64,${b64}\n  ${b64}`;
    const parsed = parseImageDataUrl(url);
    expect(parsed?.mimeType).toBe('image/png');
    expect(parsed?.base64).toBe(`${b64}${b64}`);
  });

  it('decodes URL-encoded payloads when ;base64 is missing', () => {
    const parsed = parseImageDataUrl('data:image/svg+xml,%3Csvg/%3E');
    expect(parsed?.mimeType).toBe('image/svg+xml');
    expect(Buffer.from(parsed!.base64, 'base64').toString('utf8')).toBe('<svg/>');
  });

  it('returns null on garbage input', () => {
    expect(parseImageDataUrl('not a url')).toBeNull();
    expect(parseImageDataUrl('')).toBeNull();
    expect(parseImageDataUrl('data:application/json;base64,e30=')).toBeNull();
    // @ts-expect-error invalid input type
    expect(parseImageDataUrl(123)).toBeNull();
  });
});

describe('imageAssetFromBase64 / imageAssetFromDataUrl', () => {
  it('decodes base64 and sniffs MIME when not provided', () => {
    const asset = imageAssetFromBase64({ base64: PNG_HEADER.toString('base64') });
    expect(asset.mimeType).toBe('image/png');
    expect(asset.buffer.equals(PNG_HEADER)).toBe(true);
  });

  it('honours provided MIME and fileName', () => {
    const asset = imageAssetFromBase64({
      base64: PNG_HEADER.toString('base64'),
      mimeType: 'image/png',
      fileName: 'foo.png',
    });
    expect(asset.fileName).toBe('foo.png');
  });

  it('roundtrips data URL through imageAssetFromDataUrl', () => {
    const url = `data:image/png;base64,${PNG_HEADER.toString('base64')}`;
    const asset = imageAssetFromDataUrl(url, 'avatar.png');
    expect(asset?.mimeType).toBe('image/png');
    expect(asset?.fileName).toBe('avatar.png');
    expect(asset?.buffer.equals(PNG_HEADER)).toBe(true);
  });

  it('returns null when data URL is invalid', () => {
    expect(imageAssetFromDataUrl('nope')).toBeNull();
  });
});

describe('mimeTypeFromFileName', () => {
  it('maps file names by suffix', () => {
    expect(mimeTypeFromFileName('a.png')).toBe('image/png');
    expect(mimeTypeFromFileName('a.JPG')).toBe('image/jpeg');
    expect(mimeTypeFromFileName('a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeFromFileName('a.webp')).toBe('image/webp');
    expect(mimeTypeFromFileName('a.gif')).toBe('image/gif');
    expect(mimeTypeFromFileName('a.svg')).toBe('image/svg+xml');
    expect(mimeTypeFromFileName('a.unknown')).toBeUndefined();
    expect(mimeTypeFromFileName(undefined)).toBeUndefined();
  });
});
