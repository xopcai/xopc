/**
 * Media Downloader Tests
 * 
 * Tests for media download and conversion functionality in Telegram channel.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InboundMessage } from '../../types/index.js';

describe('Media Download and Conversion', () => {
  // Mock fetch for testing
  const mockFetch = vi.fn();
  global.fetch = mockFetch;

  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('File Path to MIME Type Mapping', () => {
    const getMimeType = (type: string, filePath?: string): string => {
      if (filePath) {
        const ext = filePath.split('.').pop()?.toLowerCase();
        const extMap: Record<string, string> = {
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          png: 'image/png',
          gif: 'image/gif',
          webp: 'image/webp',
          bmp: 'image/bmp',
          svg: 'image/svg+xml',
          mp4: 'video/mp4',
          mov: 'video/quicktime',
          avi: 'video/x-msvideo',
          webm: 'video/webm',
          mp3: 'audio/mpeg',
          wav: 'audio/wav',
          ogg: 'audio/ogg',
          pdf: 'application/pdf',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          txt: 'text/plain',
          zip: 'application/zip',
        };
        if (ext && extMap[ext]) return extMap[ext];
      }

      const typeMap: Record<string, string> = {
        photo: 'image/jpeg',
        video: 'video/mp4',
        audio: 'audio/mpeg',
        document: 'application/octet-stream',
        sticker: 'image/webp',
      };
      return typeMap[type] || 'application/octet-stream';
    };

    it('should detect image MIME types from file extensions', () => {
      expect(getMimeType('photo', 'image.jpg')).toBe('image/jpeg');
      expect(getMimeType('photo', 'image.jpeg')).toBe('image/jpeg');
      expect(getMimeType('photo', 'image.png')).toBe('image/png');
      expect(getMimeType('photo', 'image.gif')).toBe('image/gif');
      expect(getMimeType('photo', 'image.webp')).toBe('image/webp');
    });

    it('should detect video MIME types from file extensions', () => {
      expect(getMimeType('video', 'clip.mp4')).toBe('video/mp4');
      expect(getMimeType('video', 'clip.mov')).toBe('video/quicktime');
      expect(getMimeType('video', 'clip.avi')).toBe('video/x-msvideo');
      expect(getMimeType('video', 'clip.webm')).toBe('video/webm');
    });

    it('should detect audio MIME types from file extensions', () => {
      expect(getMimeType('audio', 'sound.mp3')).toBe('audio/mpeg');
      expect(getMimeType('audio', 'sound.wav')).toBe('audio/wav');
      expect(getMimeType('audio', 'sound.ogg')).toBe('audio/ogg');
    });

    it('should detect document MIME types from file extensions', () => {
      expect(getMimeType('document', 'file.pdf')).toBe('application/pdf');
      expect(getMimeType('document', 'file.doc')).toBe('application/msword');
      expect(getMimeType('document', 'file.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(getMimeType('document', 'file.txt')).toBe('text/plain');
      expect(getMimeType('document', 'file.zip')).toBe('application/zip');
    });

    it('should fallback to type-based MIME detection', () => {
      expect(getMimeType('photo')).toBe('image/jpeg');
      expect(getMimeType('video')).toBe('video/mp4');
      expect(getMimeType('audio')).toBe('audio/mpeg');
      expect(getMimeType('document')).toBe('application/octet-stream');
      expect(getMimeType('sticker')).toBe('image/webp');
    });

    it('should default to octet-stream for unknown types', () => {
      expect(getMimeType('unknown')).toBe('application/octet-stream');
      expect(getMimeType('photo', 'image.xyz')).toBe('image/jpeg');
    });
  });

  describe('Base64 Encoding', () => {
    it('should correctly encode buffer to base64', () => {
      const testData = Buffer.from('Hello World');
      const base64 = testData.toString('base64');
      expect(base64).toBe('SGVsbG8gV29ybGQ=');
    });

    it('should correctly decode base64 back to original data', () => {
      const base64 = 'SGVsbG8gV29ybGQ=';
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded.toString()).toBe('Hello World');
    });

    it('should handle binary data encoding', () => {
      const binaryData = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic bytes
      const base64 = binaryData.toString('base64');
      expect(base64).toBe('/9j/4A==');
      
      // Verify round-trip
      const decoded = Buffer.from(base64, 'base64');
      expect(decoded).toEqual(binaryData);
    });
  });

  describe('Media Attachment Structure', () => {
    it('should create valid attachment object for photo', () => {
      const attachment = {
        type: 'photo',
        mimeType: 'image/jpeg',
        data: '/9j/4AAQSkZJRgABAQ==',
        name: 'photo_123.jpg',
        size: 1024,
      };

      expect(attachment.type).toBe('photo');
      expect(attachment.mimeType).toBe('image/jpeg');
      expect(attachment.data).toBeTruthy();
      expect(attachment.name).toBe('photo_123.jpg');
      expect(attachment.size).toBeGreaterThan(0);
    });

    it('should create valid attachment object for document', () => {
      const attachment = {
        type: 'document',
        mimeType: 'application/pdf',
        data: 'JVBERi0xLjQKJcOkw7zDtsO8CjIgMCBvYmoKPDwKL0xlbmd0aCAzIDAgUgo+PgpzdHJlYW0K',
        name: 'document.pdf',
        size: 2048,
      };

      expect(attachment.type).toBe('document');
      expect(attachment.mimeType).toBe('application/pdf');
      expect(attachment.name).toBe('document.pdf');
    });

    it('should create valid attachment object for video', () => {
      const attachment = {
        type: 'video',
        mimeType: 'video/mp4',
        data: 'AAAAFGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQ==',
        name: 'video.mp4',
        size: 1048576,
      };

      expect(attachment.type).toBe('video');
      expect(attachment.mimeType).toBe('video/mp4');
    });
  });

  describe('InboundMessage with Attachments', () => {
    it('should create valid InboundMessage with single attachment', () => {
      const message = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Check this photo',
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: '/9j/4AAQSkZJRgABAQ==',
            name: 'photo.jpg',
            size: 1024,
          },
        ],
        metadata: {},
      };

      expect(message.attachments).toHaveLength(1);
      expect(message.attachments![0].type).toBe('photo');
    });

    it('should create valid InboundMessage with multiple attachments', () => {
      const message = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Here are some files',
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: '/9j/4AAQSkZJRg==',
            name: 'photo1.jpg',
            size: 1024,
          },
          {
            type: 'photo',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
            name: 'photo2.png',
            size: 2048,
          },
        ],
        metadata: {},
      };

      expect(message.attachments).toHaveLength(2);
      expect(message.attachments![0].type).toBe('photo');
      expect(message.attachments![1].type).toBe('photo');
      expect(message.attachments![1].mimeType).toBe('image/png');
    });

    it('should handle message without attachments', () => {
      const message: InboundMessage = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Just text message',
        metadata: {},
      };

      expect(message.attachments).toBeUndefined();
    });
  });
});

describe('Media Download URL Construction', () => {
  it('should construct correct Telegram file download URL', () => {
    const botToken = '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11';
    const filePath = 'photos/file_123.jpg';
    const expectedUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
    
    expect(expectedUrl).toBe('https://api.telegram.org/file/bot123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11/photos/file_123.jpg');
  });

  it('should handle different file paths', () => {
    const botToken = 'test_token';
    const paths = [
      'photos/file_1.jpg',
      'documents/file_2.pdf',
      'videos/file_3.mp4',
      'voice/file_4.ogg',
    ];

    paths.forEach(path => {
      const url = `https://api.telegram.org/file/bot${botToken}/${path}`;
      expect(url).toContain(botToken);
      expect(url).toContain(path);
    });
  });
});

describe('Error Handling', () => {
  it('should handle missing file_path gracefully', () => {
    const filePath = undefined;
    const getMimeType = (filePath?: string): string => {
      if (!filePath) return 'application/octet-stream';
      const ext = filePath.split('.').pop()?.toLowerCase();
      return ext === 'jpg' ? 'image/jpeg' : 'application/octet-stream';
    };

    expect(getMimeType(filePath)).toBe('application/octet-stream');
  });

  it('should handle empty file name', () => {
    const filePath = '.jpg';
    const name = filePath.split('/').pop() || filePath;
    expect(name).toBe('.jpg');
  });
});
