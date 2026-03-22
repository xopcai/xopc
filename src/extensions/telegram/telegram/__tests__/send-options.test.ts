import { describe, it, expect } from 'vitest';
import {
  buildSendOptions,
  parseDataUrl,
  resolveMediaMethod,
  type TelegramSendParams,
} from '../send-options.js';

describe('send-options', () => {
  describe('buildSendOptions', () => {
    it('should build basic options with HTML parse mode', () => {
      const params: TelegramSendParams = {};
      const options = buildSendOptions(params);

      expect(options).toEqual({ parse_mode: 'HTML' });
    });

    it('should include threadId when provided', () => {
      const params: TelegramSendParams = { threadId: '12345' };
      const options = buildSendOptions(params);

      expect(options).toEqual({
        parse_mode: 'HTML',
        message_thread_id: 12345,
      });
    });

    it('should include replyToMessageId when provided', () => {
      const params: TelegramSendParams = { replyToMessageId: '67890' };
      const options = buildSendOptions(params);

      expect(options).toEqual({
        parse_mode: 'HTML',
        reply_to_message_id: 67890,
      });
    });

    it('should include silent flag when true', () => {
      const params: TelegramSendParams = { silent: true };
      const options = buildSendOptions(params);

      expect(options).toEqual({
        parse_mode: 'HTML',
        disable_notification: true,
      });
    });

    it('should include caption when provided', () => {
      const params: TelegramSendParams = { caption: 'Hello World' };
      const options = buildSendOptions(params);

      expect(options).toEqual({
        parse_mode: 'HTML',
        caption: 'Hello World',
      });
    });

    it('should include all options when all params provided', () => {
      const params: TelegramSendParams = {
        threadId: '100',
        replyToMessageId: '200',
        silent: true,
        caption: 'Test caption',
      };
      const options = buildSendOptions(params);

      expect(options).toEqual({
        parse_mode: 'HTML',
        message_thread_id: 100,
        reply_to_message_id: 200,
        disable_notification: true,
        caption: 'Test caption',
      });
    });

    it('should handle Markdown parse mode', () => {
      const params: TelegramSendParams = { parseMode: 'Markdown' };
      const options = buildSendOptions(params);

      expect(options).toEqual({ parse_mode: 'Markdown' });
    });

    it('should parse string threadId to integer', () => {
      const params: TelegramSendParams = { threadId: '999' };
      const options = buildSendOptions(params);

      expect(options.message_thread_id).toBe(999);
      expect(typeof options.message_thread_id).toBe('number');
    });
  });

  describe('parseDataUrl', () => {
    it('should parse valid data URL with base64', () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const result = parseDataUrl(dataUrl);

      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe('image/png');
      expect(result?.buffer).toBeInstanceOf(Buffer);
    });

    it('should parse data URL with different mime type', () => {
      const dataUrl = 'data:application/pdf;base64,JVBERi0xLjQKJcOkw7zDtsO8';
      const result = parseDataUrl(dataUrl);

      expect(result?.mimeType).toBe('application/pdf');
    });

    it('should return null for invalid data URL format', () => {
      const invalidUrls = [
        'not-a-data-url',
        'data:image/png', // missing base64
        'data:image/png;base64', // missing data
        '',
        'http://example.com/image.png',
      ];

      invalidUrls.forEach(url => {
        expect(parseDataUrl(url)).toBeNull();
      });
    });

    it('should decode base64 data correctly', () => {
      const dataUrl = 'data:text/plain;base64,SGVsbG8gV29ybGQ=';
      const result = parseDataUrl(dataUrl);

      expect(result?.buffer.toString()).toBe('Hello World');
    });
  });

  describe('resolveMediaMethod', () => {
    it('should return sendPhoto for image mime types', () => {
      const imageTypes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'image/bmp',
      ];

      imageTypes.forEach(type => {
        expect(resolveMediaMethod(type)).toBe('sendPhoto');
      });
    });

    it('should return sendVideo for video mime types', () => {
      const videoTypes = [
        'video/mp4',
        'video/quicktime',
        'video/webm',
      ];

      videoTypes.forEach(type => {
        expect(resolveMediaMethod(type)).toBe('sendVideo');
      });
    });

    it('should return sendAudio for audio mime types', () => {
      const audioTypes = [
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
      ];

      audioTypes.forEach(type => {
        expect(resolveMediaMethod(type)).toBe('sendAudio');
      });
    });

    it('should return sendDocument for unknown mime types', () => {
      const documentTypes = [
        'application/pdf',
        'text/plain',
        'application/zip',
        'unknown/type',
      ];

      documentTypes.forEach(type => {
        expect(resolveMediaMethod(type)).toBe('sendDocument');
      });
    });

    it('should handle category-based resolution', () => {
      // Using category prefix
      expect(resolveMediaMethod('image')).toBe('sendPhoto');
      expect(resolveMediaMethod('video')).toBe('sendVideo');
      expect(resolveMediaMethod('audio')).toBe('sendAudio');
      expect(resolveMediaMethod('document')).toBe('sendDocument');
    });

    it('should handle voice category', () => {
      expect(resolveMediaMethod('voice')).toBe('sendVoice');
      expect(resolveMediaMethod('audio/ogg; codecs=opus')).toBe('sendVoice');
    });
  });
});
