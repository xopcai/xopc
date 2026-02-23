/**
 * Media Integration Tests
 * 
 * End-to-end tests for media processing pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBus, InboundMessage, OutboundMessage } from '../../bus/index.js';

describe('Media Processing Integration', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  afterEach(() => {
    bus.clear();
  });

  describe('Complete Message Flow with Media', () => {
    it('should process message with single photo through the pipeline', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Check this photo',
        media: [{ type: 'photo', fileId: 'AgACAgQAAxkBAAIBZ2cAAAAAA' }],
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: '/9j/4AAQSkZJRgABAQEASABIAAD',
            name: 'photo_123.jpg',
            size: 10240,
          },
        ],
        metadata: {
          sessionKey: 'telegram:dm:123456789',
          messageId: '456',
        },
      };

      await bus.publishInbound(inboundMessage);

      expect(processedMessages).toHaveLength(1);
      expect(processedMessages[0].content).toBe('Check this photo');
      expect(processedMessages[0].attachments).toHaveLength(1);
      expect(processedMessages[0].attachments![0].type).toBe('photo');
      expect(processedMessages[0].attachments![0].mimeType).toBe('image/jpeg');
    });

    it('should process message with multiple photos', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Here are vacation photos',
        media: [
          { type: 'photo', fileId: 'file_id_1' },
          { type: 'photo', fileId: 'file_id_2' },
          { type: 'photo', fileId: 'file_id_3' },
        ],
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: 'base64data1',
            name: 'photo1.jpg',
            size: 15000,
          },
          {
            type: 'photo',
            mimeType: 'image/png',
            data: 'base64data2',
            name: 'photo2.png',
            size: 20000,
          },
          {
            type: 'photo',
            mimeType: 'image/webp',
            data: 'base64data3',
            name: 'photo3.webp',
            size: 8000,
          },
        ],
        metadata: {},
      };

      await bus.publishInbound(inboundMessage);

      expect(processedMessages[0].attachments).toHaveLength(3);
      expect(processedMessages[0].attachments![0].mimeType).toBe('image/jpeg');
      expect(processedMessages[0].attachments![1].mimeType).toBe('image/png');
      expect(processedMessages[0].attachments![2].mimeType).toBe('image/webp');
    });

    it('should process message with mixed media types', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Files for you',
        media: [
          { type: 'photo', fileId: 'photo_id' },
          { type: 'document', fileId: 'doc_id' },
          { type: 'video', fileId: 'video_id' },
        ],
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: 'imagedata',
            name: 'image.jpg',
            size: 10000,
          },
          {
            type: 'document',
            mimeType: 'application/pdf',
            data: 'pdfdata',
            name: 'document.pdf',
            size: 50000,
          },
          {
            type: 'video',
            mimeType: 'video/mp4',
            data: 'videodata',
            name: 'video.mp4',
            size: 1000000,
          },
        ],
        metadata: {},
      };

      await bus.publishInbound(inboundMessage);

      expect(processedMessages[0].attachments).toHaveLength(3);
      expect(processedMessages[0].attachments![0].type).toBe('photo');
      expect(processedMessages[0].attachments![1].type).toBe('document');
      expect(processedMessages[0].attachments![2].type).toBe('video');
    });

    it('should process message without media', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123456789',
        chat_id: '987654321',
        content: 'Just a text message',
        metadata: {},
      };

      await bus.publishInbound(inboundMessage);

      expect(processedMessages[0].content).toBe('Just a text message');
      expect(processedMessages[0].attachments).toBeUndefined();
      expect(processedMessages[0].media).toBeUndefined();
    });
  });

  describe('Outbound Media Response', () => {
    it('should send outbound message with media', async () => {
      const outboundMessages: OutboundMessage[] = [];
      
      bus.on('outbound', (msg) => {
        outboundMessages.push(msg);
      });

      const outboundMessage: OutboundMessage = {
        channel: 'telegram',
        chat_id: '987654321',
        content: 'Here is the image you requested',
        mediaUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD',
        mediaType: 'photo',
        type: 'message',
      };

      await bus.publishOutbound(outboundMessage);

      expect(outboundMessages).toHaveLength(1);
      expect(outboundMessages[0].mediaUrl).toBeDefined();
      expect(outboundMessages[0].mediaUrl!.startsWith('data:image/jpeg;base64,')).toBe(true);
      expect(outboundMessages[0].mediaType).toBe('photo');
    });

    it('should send outbound message without media', async () => {
      const outboundMessages: OutboundMessage[] = [];
      
      bus.on('outbound', (msg) => {
        outboundMessages.push(msg);
      });

      const outboundMessage: OutboundMessage = {
        channel: 'telegram',
        chat_id: '987654321',
        content: 'Just a text reply',
        type: 'message',
      };

      await bus.publishOutbound(outboundMessage);

      expect(outboundMessages[0].content).toBe('Just a text reply');
      expect(outboundMessages[0].mediaUrl).toBeUndefined();
      expect(outboundMessages[0].mediaType).toBeUndefined();
    });

    it('should handle different media types in outbound messages', async () => {
      const outboundMessages: OutboundMessage[] = [];
      
      bus.on('outbound', (msg) => {
        outboundMessages.push(msg);
      });

      const mediaMessages: OutboundMessage[] = [
        {
          channel: 'telegram',
          chat_id: '123',
          content: 'Photo',
          mediaUrl: 'data:image/jpeg;base64,abc',
          mediaType: 'photo',
        },
        {
          channel: 'telegram',
          chat_id: '123',
          content: 'Video',
          mediaUrl: 'data:video/mp4;base64,def',
          mediaType: 'video',
        },
        {
          channel: 'telegram',
          chat_id: '123',
          content: 'Audio',
          mediaUrl: 'data:audio/mpeg;base64,ghi',
          mediaType: 'audio',
        },
        {
          channel: 'telegram',
          chat_id: '123',
          content: 'Document',
          mediaUrl: 'data:application/pdf;base64,jkl',
          mediaType: 'document',
        },
      ];

      for (const msg of mediaMessages) {
        await bus.publishOutbound(msg);
      }

      expect(outboundMessages).toHaveLength(4);
      expect(outboundMessages[0].mediaType).toBe('photo');
      expect(outboundMessages[1].mediaType).toBe('video');
      expect(outboundMessages[2].mediaType).toBe('audio');
      expect(outboundMessages[3].mediaType).toBe('document');
    });
  });

  describe('Round-trip Media Processing', () => {
    it('should handle complete request-response cycle with media', async () => {
      const inboundLog: InboundMessage[] = [];
      const outboundLog: OutboundMessage[] = [];

      bus.on('inbound', (msg) => {
        inboundLog.push(msg);
      });

      bus.on('outbound', (msg) => {
        outboundLog.push(msg);
      });

      // User sends photo
      const userMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123',
        chat_id: '456',
        content: 'What is in this image?',
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: 'imagedata',
            name: 'query.jpg',
            size: 10000,
          },
        ],
        metadata: {},
      };

      await bus.publishInbound(userMessage);

      // Bot responds with image
      const botResponse: OutboundMessage = {
        channel: 'telegram',
        chat_id: '456',
        content: 'Here is the result',
        mediaUrl: 'data:image/png;base64,resultdata',
        mediaType: 'photo',
      };

      await bus.publishOutbound(botResponse);

      expect(inboundLog).toHaveLength(1);
      expect(outboundLog).toHaveLength(1);
      expect(inboundLog[0].attachments![0].type).toBe('photo');
      expect(outboundLog[0].mediaType).toBe('photo');
    });
  });

  describe('Error Handling', () => {
    it('should handle message with empty attachment data', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123',
        chat_id: '456',
        content: 'Test',
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: '', // Empty data
            name: 'empty.jpg',
            size: 0,
          },
        ],
        metadata: {},
      };

      await bus.publishInbound(inboundMessage);

      expect(processedMessages[0].attachments![0].data).toBe('');
      expect(processedMessages[0].attachments![0].size).toBe(0);
    });

    it('should handle missing attachment fields gracefully', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage = {
        channel: 'telegram',
        sender_id: '123',
        chat_id: '456',
        content: 'Test',
        attachments: [
          {
            type: 'photo',
            // Missing mimeType, data, name, size
          },
        ],
      } as InboundMessage;

      await bus.publishInbound(inboundMessage);

      expect(processedMessages[0].attachments).toHaveLength(1);
      expect(processedMessages[0].attachments![0].type).toBe('photo');
    });
  });

  describe('Concurrent Media Processing', () => {
    it('should handle multiple concurrent media messages', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const messages: InboundMessage[] = Array(5).fill(null).map((_, i) => ({
        channel: 'telegram',
        sender_id: `user${i}`,
        chat_id: `chat${i}`,
        content: `Message ${i}`,
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: `data${i}`,
            name: `photo${i}.jpg`,
            size: 1000 * (i + 1),
          },
        ],
        metadata: {},
      }));

      await Promise.all(messages.map(msg => bus.publishInbound(msg)));

      expect(processedMessages).toHaveLength(5);
      processedMessages.forEach((msg, i) => {
        expect(msg.attachments![0].name).toBe(`photo${i}.jpg`);
        expect(msg.attachments![0].size).toBe(1000 * (i + 1));
      });
    });
  });

  describe('Media Metadata', () => {
    it('should preserve metadata in media messages', async () => {
      const processedMessages: InboundMessage[] = [];
      
      bus.on('inbound', (msg) => {
        processedMessages.push(msg);
      });

      const inboundMessage: InboundMessage = {
        channel: 'telegram',
        sender_id: '123',
        chat_id: '456',
        content: 'Photo',
        attachments: [
          {
            type: 'photo',
            mimeType: 'image/jpeg',
            data: 'data',
            name: 'photo.jpg',
            size: 1024,
          },
        ],
        metadata: {
          sessionKey: 'telegram:dm:123',
          messageId: '789',
          isGroup: false,
          threadId: undefined,
        },
      };

      await bus.publishInbound(inboundMessage);

      expect(processedMessages[0].metadata).toEqual({
        sessionKey: 'telegram:dm:123',
        messageId: '789',
        isGroup: false,
        threadId: undefined,
      });
    });
  });
});
