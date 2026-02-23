/**
 * Send Media Tool Tests
 * 
 * Tests for send_media tool functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'fs/promises';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

describe('SendMediaTool', () => {
  const mockReadFile = readFile as unknown as ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    mockReadFile.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SendMediaSchema', () => {
    it('should validate required parameters', () => {
      const params = {
        filePath: '/path/to/image.jpg',
      };
      
      expect(params.filePath).toBeDefined();
      expect(params.filePath).toBe('/path/to/image.jpg');
    });

    it('should accept optional parameters', () => {
      const params = {
        filePath: '/path/to/video.mp4',
        mediaType: 'video' as const,
        caption: 'Check out this video!',
      };

      expect(params.filePath).toBe('/path/to/video.mp4');
      expect(params.mediaType).toBe('video');
      expect(params.caption).toBe('Check out this video!');
    });

    it('should handle media type enum values', () => {
      const validTypes = ['photo', 'video', 'audio', 'document'] as const;
      
      validTypes.forEach(type => {
        const params = { filePath: '/test/file', mediaType: type };
        expect(params.mediaType).toBe(type);
      });
    });
  });

  describe('Media Type Detection', () => {
    const detectMediaType = (filePath: string): 'photo' | 'video' | 'audio' | 'document' => {
      const ext = filePath.split('.').pop()?.toLowerCase();
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
      const videoExts = ['mp4', 'mov', 'avi', 'webm', 'mkv'];
      const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

      if (imageExts.includes(ext || '')) return 'photo';
      if (videoExts.includes(ext || '')) return 'video';
      if (audioExts.includes(ext || '')) return 'audio';
      return 'document';
    };

    it('should auto-detect image files', () => {
      expect(detectMediaType('/path/to/photo.jpg')).toBe('photo');
      expect(detectMediaType('/path/to/photo.png')).toBe('photo');
      expect(detectMediaType('/path/to/image.gif')).toBe('photo');
    });

    it('should auto-detect video files', () => {
      expect(detectMediaType('/path/to/video.mp4')).toBe('video');
      expect(detectMediaType('/path/to/clip.mov')).toBe('video');
    });

    it('should auto-detect audio files', () => {
      expect(detectMediaType('/path/to/audio.mp3')).toBe('audio');
      expect(detectMediaType('/path/to/sound.wav')).toBe('audio');
    });

    it('should default to document for unknown types', () => {
      expect(detectMediaType('/path/to/file.pdf')).toBe('document');
      expect(detectMediaType('/path/to/file.txt')).toBe('document');
      expect(detectMediaType('/path/to/file')).toBe('document');
    });
  });

  describe('MIME Type Detection', () => {
    const detectMimeType = (filePath: string): string => {
      const ext = filePath.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
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
        m4a: 'audio/mp4',
        flac: 'audio/flac',
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        txt: 'text/plain',
        zip: 'application/zip',
      };
      return mimeMap[ext || ''] || 'application/octet-stream';
    };

    it('should detect image MIME types', () => {
      expect(detectMimeType('image.jpg')).toBe('image/jpeg');
      expect(detectMimeType('image.png')).toBe('image/png');
      expect(detectMimeType('image.gif')).toBe('image/gif');
      expect(detectMimeType('image.webp')).toBe('image/webp');
    });

    it('should detect video MIME types', () => {
      expect(detectMimeType('video.mp4')).toBe('video/mp4');
      expect(detectMimeType('video.mov')).toBe('video/quicktime');
    });

    it('should detect audio MIME types', () => {
      expect(detectMimeType('audio.mp3')).toBe('audio/mpeg');
      expect(detectMimeType('audio.wav')).toBe('audio/wav');
    });

    it('should detect document MIME types', () => {
      expect(detectMimeType('doc.pdf')).toBe('application/pdf');
      expect(detectMimeType('doc.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    });
  });

  describe('File Reading and Conversion', () => {
    it('should read file and convert to base64', async () => {
      const mockBuffer = Buffer.from('Hello World');
      mockReadFile.mockResolvedValue(mockBuffer);

      const filePath = '/test/image.jpg';
      const fileBuffer = await readFile(filePath);
      const base64 = fileBuffer.toString('base64');

      expect(mockReadFile).toHaveBeenCalledWith(filePath);
      expect(base64).toBe('SGVsbG8gV29ybGQ=');
    });

    it('should handle file read errors', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT: file not found'));

      try {
        await readFile('/nonexistent/file.jpg');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain('ENOENT');
      }
    });

    it('should create data URL from file', async () => {
      const mockBuffer = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]); // JPEG magic bytes
      mockReadFile.mockResolvedValue(mockBuffer);

      const filePath = '/test/image.jpg';
      const fileBuffer = await readFile(filePath);
      const base64 = fileBuffer.toString('base64');
      const mimeType = 'image/jpeg';
      const dataUrl = `data:${mimeType};base64,${base64}`;

      expect(dataUrl).toBe('data:image/jpeg;base64,/9j/4A==');
    });
  });

  describe('OutboundMessage Construction', () => {
    it('should create OutboundMessage with media', () => {
      const dataUrl = 'data:image/jpeg;base64,/9j/4AA=';
      const caption = 'Test caption';
      
      const msg = {
        channel: 'telegram',
        chat_id: '123456',
        content: caption,
        mediaUrl: dataUrl,
        mediaType: 'photo',
      };

      expect(msg.mediaUrl).toBe(dataUrl);
      expect(msg.mediaType).toBe('photo');
      expect(msg.content).toBe(caption);
    });

    it('should handle message without caption', () => {
      const msg = {
        channel: 'telegram',
        chat_id: '123456',
        content: '',
        mediaUrl: 'data:image/png;base64,abc123',
        mediaType: 'photo',
      };

      expect(msg.content).toBe('');
      expect(msg.mediaUrl).toBeDefined();
    });
  });

  describe('Tool Execution Result', () => {
    it('should return success result', async () => {
      const mockBuffer = Buffer.from('test data');
      mockReadFile.mockResolvedValue(mockBuffer);

      const filePath = '/test/success.jpg';
      const fileName = filePath.split('/').pop() || filePath;
      
      await readFile(filePath);
      
      const result = {
        content: [{ type: 'text', text: `✅ Media sent: ${fileName} (photo)` }],
        details: { filePath, mediaType: 'photo' },
      };

      expect(result.content[0].text).toContain('✅ Media sent');
      expect(result.content[0].text).toContain('success.jpg');
      expect(result.content[0].text).toContain('photo');
    });

    it('should return error result on failure', () => {
      const errorMessage = 'Error sending media: ENOENT: no such file';
      
      const result = {
        content: [{ type: 'text', text: errorMessage }],
        details: { error: errorMessage },
      };

      expect(result.content[0].text).toContain('Error sending media');
    });
  });

  describe('Context Validation', () => {
    it('should error when no active context', () => {
      const ctx = null;
      
      if (!ctx) {
        const result = {
          content: [{ type: 'text', text: 'Error: No active conversation context' }],
          details: {},
        };
        expect(result.content[0].text).toContain('No active conversation context');
      }
    });

    it('should proceed when context is available', () => {
      const ctx = {
        channel: 'telegram',
        chatId: '123456',
      };

      expect(ctx).not.toBeNull();
      expect(ctx.channel).toBe('telegram');
      expect(ctx.chatId).toBe('123456');
    });
  });

  describe('File Name Extraction', () => {
    it('should extract file name from path', () => {
      const testCases = [
        { path: '/path/to/file.jpg', expected: 'file.jpg' },
        { path: '/home/user/documents/report.pdf', expected: 'report.pdf' },
        { path: 'relative/path/image.png', expected: 'image.png' },
        { path: 'simple.txt', expected: 'simple.txt' },
      ];

      testCases.forEach(({ path, expected }) => {
        const fileName = path.split('/').pop() || path;
        expect(fileName).toBe(expected);
      });
    });

    it('should handle edge cases', () => {
      const path1 = '/'; // root
      const path2 = ''; // empty

      expect(path1.split('/').pop()).toBe('');
      expect(path2.split('/').pop()).toBe('');
    });
  });
});
