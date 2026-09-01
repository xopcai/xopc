import { describe, expect, it } from 'vitest';

import {
  arrayBufferToBase64,
  composerAttachmentFromBase64,
  formatAttachmentSize,
  isEditableImageAttachment,
} from '../attachment-file-io-core';

describe('composerAttachmentFromBase64', () => {
  it('classifies image mime as image type', () => {
    const att = composerAttachmentFromBase64({
      uri: 'file:///a.jpg',
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      content: 'YWJj',
      size: 3,
    });
    expect(att.type).toBe('image');
    expect(att.localUri).toBe('file:///a.jpg');
  });

  it('classifies other mime as document', () => {
    const att = composerAttachmentFromBase64({
      uri: 'file:///doc.pdf',
      name: 'doc.pdf',
      mimeType: 'application/pdf',
      content: 'YWJj',
      size: 3,
    });
    expect(att.type).toBe('document');
  });

  it('strips whitespace from base64 content', () => {
    const att = composerAttachmentFromBase64({
      uri: 'file:///x',
      name: 'x.bin',
      mimeType: 'application/octet-stream',
      content: 'YWJj\n',
      size: 3,
    });
    expect(att.content).toBe('YWJj');
  });
});

describe('arrayBufferToBase64', () => {
  it('encodes bytes to base64', () => {
    const buf = new Uint8Array([97, 98, 99]).buffer;
    expect(arrayBufferToBase64(buf)).toBe('YWJj');
  });
});

describe('formatAttachmentSize', () => {
  it('formats human-readable sizes', () => {
    expect(formatAttachmentSize(500)).toBe('500 B');
    expect(formatAttachmentSize(2048)).toBe('2.0 KB');
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('isEditableImageAttachment', () => {
  it('accepts picked local images only', () => {
    const localImage = composerAttachmentFromBase64({
      uri: 'file:///photo.jpg',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      content: 'YWJj',
      size: 3,
    });
    expect(isEditableImageAttachment(localImage)).toBe(true);
    expect(isEditableImageAttachment({ ...localImage, localUri: 'content://photo.jpg' })).toBe(false);
    expect(isEditableImageAttachment({ ...localImage, localUri: 'https://example.com/photo.jpg' })).toBe(false);
    expect(isEditableImageAttachment({ ...localImage, type: 'document', mimeType: 'application/pdf' })).toBe(false);
  });
});
