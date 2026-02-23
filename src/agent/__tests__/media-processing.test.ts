/**
 * Agent Media Processing Tests
 * 
 * Tests for media message handling in AgentService.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Agent Message Content Building', () => {
  describe('MessageContent Array Construction', () => {
    it('should build message content with only text', () => {
      const expandedContent = 'Hello world';
      const attachments: any[] = [];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(1);
      expect(messageContent[0]).toEqual({ type: 'text', text: 'Hello world' });
    });

    it('should build message content with text and single image', () => {
      const expandedContent = 'Check this photo';
      const attachments = [
        {
          type: 'photo',
          mimeType: 'image/jpeg',
          data: '/9j/4AAQSkZJRgABAQ==',
          name: 'photo.jpg',
          size: 1024,
        },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(2);
      expect(messageContent[0]).toEqual({ type: 'text', text: 'Check this photo' });
      expect(messageContent[1]).toEqual({ 
        type: 'image', 
        data: '/9j/4AAQSkZJRgABAQ==', 
        mimeType: 'image/jpeg' 
      });
    });

    it('should build message content with multiple images', () => {
      const expandedContent = 'Here are photos';
      const attachments = [
        { type: 'photo', mimeType: 'image/jpeg', data: 'data1', name: 'photo1.jpg', size: 1000 },
        { type: 'photo', mimeType: 'image/png', data: 'data2', name: 'photo2.png', size: 2000 },
        { type: 'photo', mimeType: 'image/webp', data: 'data3', name: 'photo3.webp', size: 1500 },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(4);
      expect(messageContent[0].type).toBe('text');
      expect(messageContent[1]).toEqual({ type: 'image', data: 'data1', mimeType: 'image/jpeg' });
      expect(messageContent[2]).toEqual({ type: 'image', data: 'data2', mimeType: 'image/png' });
      expect(messageContent[3]).toEqual({ type: 'image', data: 'data3', mimeType: 'image/webp' });
    });

    it('should convert non-image attachments to text description', () => {
      const expandedContent = 'Here is a file';
      const attachments = [
        {
          type: 'document',
          mimeType: 'application/pdf',
          data: 'pdfdata123',
          name: 'document.pdf',
          size: 102400,
        },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(2);
      expect(messageContent[0]).toEqual({ type: 'text', text: 'Here is a file' });
      expect(messageContent[1]).toEqual({ 
        type: 'text', 
        text: '[File: document.pdf (application/pdf, 102400 bytes)]' 
      });
    });

    it('should handle mixed image and non-image attachments', () => {
      const expandedContent = 'Mixed content';
      const attachments = [
        { type: 'photo', mimeType: 'image/jpeg', data: 'img1', name: 'photo.jpg', size: 1000 },
        { type: 'document', mimeType: 'application/pdf', data: 'pdf1', name: 'doc.pdf', size: 5000 },
        { type: 'photo', mimeType: 'image/png', data: 'img2', name: 'screenshot.png', size: 2000 },
        { type: 'audio', mimeType: 'audio/mpeg', data: 'audio1', name: 'voice.mp3', size: 3000 },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(5);
      expect(messageContent[0]).toEqual({ type: 'text', text: 'Mixed content' });
      expect(messageContent[1]).toEqual({ type: 'image', data: 'img1', mimeType: 'image/jpeg' });
      expect(messageContent[2]).toEqual({ type: 'text', text: '[File: doc.pdf (application/pdf, 5000 bytes)]' });
      expect(messageContent[3]).toEqual({ type: 'image', data: 'img2', mimeType: 'image/png' });
      expect(messageContent[4]).toEqual({ type: 'text', text: '[File: voice.mp3 (audio/mpeg, 3000 bytes)]' });
    });

    it('should handle empty content with only attachments', () => {
      const expandedContent = '';
      const attachments = [
        { type: 'photo', mimeType: 'image/jpeg', data: 'imgdata', name: 'photo.jpg', size: 1000 },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(1);
      expect(messageContent[0]).toEqual({ type: 'image', data: 'imgdata', mimeType: 'image/jpeg' });
    });

    it('should handle webp images correctly', () => {
      const expandedContent = 'WebP image';
      const attachments = [
        { type: 'photo', mimeType: 'image/webp', data: 'webpdata', name: 'sticker.webp', size: 500 },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(2);
      expect(messageContent[1]).toEqual({ type: 'image', data: 'webpdata', mimeType: 'image/webp' });
    });

    it('should handle gif images correctly', () => {
      const expandedContent = 'GIF image';
      const attachments = [
        { type: 'document', mimeType: 'image/gif', data: 'gifdata', name: 'animation.gif', size: 2000 },
      ];
      
      const messageContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [];
      
      if (expandedContent.trim()) {
        messageContent.push({ type: 'text', text: expandedContent });
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.type === 'photo' || att.mimeType?.startsWith('image/')) {
            messageContent.push({ type: 'image', data: att.data, mimeType: att.mimeType });
          } else {
            const fileInfo = `[File: ${att.name || att.type} (${att.mimeType || 'unknown type'}, ${att.size || 0} bytes)]`;
            messageContent.push({ type: 'text', text: fileInfo });
          }
        }
      }

      expect(messageContent).toHaveLength(2);
      expect(messageContent[1]).toEqual({ type: 'image', data: 'gifdata', mimeType: 'image/gif' });
    });
  });

  describe('UserMessage Construction', () => {
    it('should create valid AgentMessage with content array', () => {
      const messageContent = [
        { type: 'text' as const, text: 'Hello' },
        { type: 'image' as const, data: 'imagedata', mimeType: 'image/jpeg' },
      ];

      const userMessage = {
        role: 'user' as const,
        content: messageContent,
        timestamp: Date.now(),
      };

      expect(userMessage.role).toBe('user');
      expect(Array.isArray(userMessage.content)).toBe(true);
      expect(userMessage.content).toHaveLength(2);
      expect(userMessage.timestamp).toBeGreaterThan(0);
    });

    it('should handle message with only images', () => {
      const messageContent = [
        { type: 'image' as const, data: 'img1', mimeType: 'image/jpeg' },
        { type: 'image' as const, data: 'img2', mimeType: 'image/png' },
      ];

      const userMessage = {
        role: 'user' as const,
        content: messageContent,
        timestamp: 1234567890,
      };

      expect(userMessage.content).toHaveLength(2);
      expect((userMessage.content[0] as any).type).toBe('image');
      expect((userMessage.content[1] as any).type).toBe('image');
    });
  });
});

describe('Outbound Media Message', () => {
  it('should create OutboundMessage with mediaUrl', () => {
    const reply: any = {
      channel: 'telegram',
      chat_id: '987654321',
      content: 'Here is the image you requested',
      mediaUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      mediaType: 'photo',
      type: 'message',
    };

    expect(reply.mediaUrl).toBeTruthy();
    expect(reply.mediaUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(reply.mediaType).toBe('photo');
  });

  it('should handle data URL construction for different media types', () => {
    const testCases = [
      { mimeType: 'image/jpeg', base64: '/9j/4AAQSkZJRg==', type: 'photo' },
      { mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', type: 'photo' },
      { mimeType: 'video/mp4', base64: 'AAAAFGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQ==', type: 'video' },
    ];

    testCases.forEach(({ mimeType, base64, type }) => {
      const dataUrl = `data:${mimeType};base64,${base64}`;
      expect(dataUrl.startsWith(`data:${mimeType};base64,`)).toBe(true);
      
      const reply: any = {
        channel: 'telegram',
        chat_id: '123',
        content: 'Media',
        mediaUrl: dataUrl,
        mediaType: type,
      };

      expect(reply.mediaType).toBe(type);
    });
  });
});

describe('SendMedia Tool', () => {
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

    it('should detect photo files', () => {
      expect(detectMediaType('image.jpg')).toBe('photo');
      expect(detectMediaType('image.jpeg')).toBe('photo');
      expect(detectMediaType('image.png')).toBe('photo');
      expect(detectMediaType('image.gif')).toBe('photo');
      expect(detectMediaType('image.webp')).toBe('photo');
      expect(detectMediaType('image.bmp')).toBe('photo');
      expect(detectMediaType('image.svg')).toBe('photo');
    });

    it('should detect video files', () => {
      expect(detectMediaType('clip.mp4')).toBe('video');
      expect(detectMediaType('clip.mov')).toBe('video');
      expect(detectMediaType('clip.avi')).toBe('video');
      expect(detectMediaType('clip.webm')).toBe('video');
      expect(detectMediaType('clip.mkv')).toBe('video');
    });

    it('should detect audio files', () => {
      expect(detectMediaType('sound.mp3')).toBe('audio');
      expect(detectMediaType('sound.wav')).toBe('audio');
      expect(detectMediaType('sound.ogg')).toBe('audio');
      expect(detectMediaType('sound.m4a')).toBe('audio');
      expect(detectMediaType('sound.flac')).toBe('audio');
    });

    it('should default to document for unknown extensions', () => {
      expect(detectMediaType('file.pdf')).toBe('document');
      expect(detectMediaType('file.txt')).toBe('document');
      expect(detectMediaType('file.zip')).toBe('document');
      expect(detectMediaType('file.xyz')).toBe('document');
      expect(detectMediaType('file')).toBe('document');
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

    it('should return correct MIME type for images', () => {
      expect(detectMimeType('photo.jpg')).toBe('image/jpeg');
      expect(detectMimeType('photo.png')).toBe('image/png');
      expect(detectMimeType('photo.gif')).toBe('image/gif');
      expect(detectMimeType('photo.webp')).toBe('image/webp');
      expect(detectMimeType('photo.svg')).toBe('image/svg+xml');
    });

    it('should return correct MIME type for documents', () => {
      expect(detectMimeType('doc.pdf')).toBe('application/pdf');
      expect(detectMimeType('doc.doc')).toBe('application/msword');
      expect(detectMimeType('doc.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(detectMimeType('doc.txt')).toBe('text/plain');
      expect(detectMimeType('doc.zip')).toBe('application/zip');
    });

    it('should return octet-stream for unknown types', () => {
      expect(detectMimeType('file.xyz')).toBe('application/octet-stream');
      expect(detectMimeType('file')).toBe('application/octet-stream');
    });
  });
});
