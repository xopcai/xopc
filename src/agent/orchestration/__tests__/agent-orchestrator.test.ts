/**
 * Agent Orchestrator Tests
 *
 * Tests for the AgentOrchestrator class, particularly the buildUserMessage method
 * which handles converting InboundMessage (with attachments) to AgentMessage.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from '../agent-orchestrator.js';
import type { InboundMessage } from '../../../infra/bus/index.js';
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';
import type { SessionStore } from '../../../session/index.js';
import type { ModelManager } from '../../models/index.js';
import type { AgentEventHandler } from '../agent-event-handler.js';
import type { FeedbackCoordinator } from '../../feedback/feedback-coordinator.js';

describe('AgentOrchestrator', () => {
  let orchestrator: AgentOrchestrator;
  let mockAgent: Partial<Agent>;
  let mockSessionStore: Partial<SessionStore>;
  let mockModelManager: Partial<ModelManager>;
  let mockEventHandler: Partial<AgentEventHandler>;
  let mockFeedbackCoordinator: Partial<FeedbackCoordinator>;

  beforeEach(() => {
    mockAgent = {
      state: { messages: [] },
      replaceMessages: vi.fn(),
      prompt: vi.fn().mockResolvedValue(undefined),
      waitForIdle: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn(),
    };

    mockSessionStore = {
      load: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
    };

    mockModelManager = {
      applyModelForSession: vi.fn().mockResolvedValue(undefined),
      getCurrentModel: vi.fn().mockReturnValue('test-model'),
    };

    mockEventHandler = {
      handle: vi.fn(),
    };

    mockFeedbackCoordinator = {
      startTask: vi.fn(),
      endTask: vi.fn(),
      setContext: vi.fn(),
      clearContext: vi.fn(),
    };

    orchestrator = new AgentOrchestrator({
      agent: mockAgent as Agent,
      sessionStore: mockSessionStore as SessionStore,
      modelManager: mockModelManager as ModelManager,
      eventHandler: mockEventHandler as AgentEventHandler,
      feedbackCoordinator: mockFeedbackCoordinator as FeedbackCoordinator,
    });
  });

  describe('buildUserMessage', () => {
    // Helper to access private method for testing
    const callBuildUserMessage = (orchestrator: AgentOrchestrator, msg: InboundMessage): AgentMessage => {
      // @ts-expect-error - accessing private method for testing
      return orchestrator.buildUserMessage(msg);
    };

    describe('text-only messages (backward compatibility)', () => {
      it('should create simple string content for text-only message', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Hello world',
        };

        const result = callBuildUserMessage(orchestrator, msg);

        expect(result.role).toBe('user');
        expect(result.content).toBe('Hello world');
        expect(result.timestamp).toBeDefined();
      });

      it('should handle empty content without attachments', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: '',
        };

        const result = callBuildUserMessage(orchestrator, msg);

        expect(result.role).toBe('user');
        expect(result.content).toBe('');
      });

      it('should handle whitespace-only content', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: '   \n\t  ',
        };

        const result = callBuildUserMessage(orchestrator, msg);

        expect(result.content).toBe('   \n\t  ');
      });
    });

    describe('single photo attachment', () => {
      it('should create array content with image for photo attachment', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Check this photo',
          attachments: [
            {
              type: 'photo',
              mimeType: 'image/jpeg',
              data: '/9j/4AAQSkZJRgABAQ==',
              name: 'photo_123.jpg',
              size: 1024,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);

        expect(result.role).toBe('user');
        expect(Array.isArray(result.content)).toBe(true);

        const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        expect(content).toHaveLength(2);

        // First item should be text
        expect(content[0]).toEqual({ type: 'text', text: 'Check this photo' });

        // Second item should be image
        expect(content[1]).toEqual({
          type: 'image',
          data: '/9j/4AAQSkZJRgABAQ==',
          mimeType: 'image/jpeg',
        });
      });

      it('should use image/jpeg as default mimeType when not specified', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Photo without mimeType',
          attachments: [
            {
              type: 'image', // not 'photo', but still an image
              mimeType: undefined as unknown as string,
              data: 'base64data',
              name: 'image.xyz',
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; mimeType?: string }>;

        // The attachment type is 'image' so it should be treated as image
        const imageContent = content.find(c => c.type === 'image');
        expect(imageContent?.mimeType).toBe('image/jpeg');
      });

      it('should detect image from mimeType even if type is not photo', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'PNG image',
          attachments: [
            {
              type: 'document',
              mimeType: 'image/png',
              data: 'iVBORw0KGgo=',
              name: 'image.png',
              size: 2048,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string }>;

        const imageContent = content.find(c => c.type === 'image');
        expect(imageContent).toBeDefined();
      });
    });

    describe('multiple photo attachments', () => {
      it('should create array content with multiple images', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Here are vacation photos',
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
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; mimeType?: string }>;

        expect(content).toHaveLength(4); // text + 3 images

        // First item should be text
        expect(content[0]).toEqual({ type: 'text', text: 'Here are vacation photos' });

        // Rest should be images with correct mime types
        expect(content[1]).toEqual({ type: 'image', data: 'base64data1', mimeType: 'image/jpeg' });
        expect(content[2]).toEqual({ type: 'image', data: 'base64data2', mimeType: 'image/png' });
        expect(content[3]).toEqual({ type: 'image', data: 'base64data3', mimeType: 'image/webp' });
      });
    });

    describe('mixed media types', () => {
      it('should handle photo + document + video', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Files for you',
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
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        expect(content).toHaveLength(4);

        // Text
        expect(content[0]).toEqual({ type: 'text', text: 'Files for you' });

        // Image
        expect(content[1]).toEqual({ type: 'image', data: 'imagedata', mimeType: 'image/jpeg' });

        // Document as text description
        expect(content[2]).toEqual({
          type: 'text',
          text: '[File: document.pdf (application/pdf, 50000 bytes)]',
        });

        // Video as text description (since video data is usually too large)
        expect(content[3]).toEqual({
          type: 'text',
          text: '[File: video.mp4 (video/mp4, 1000000 bytes)]',
        });
      });
    });

    describe('attachment without text content', () => {
      it('should create only image content when text is empty', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: '', // Empty content
          attachments: [
            {
              type: 'photo',
              mimeType: 'image/jpeg',
              data: 'imagedata',
              name: 'photo.jpg',
              size: 1024,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        // Should add default prompt when only image without text
        expect(content).toHaveLength(2);
        expect(content[0]).toEqual({ type: 'text', text: 'Please analyze the image(s) I sent.' });
        expect(content[1]).toEqual({ type: 'image', data: 'imagedata', mimeType: 'image/jpeg' });
      });

      it('should create only image content when text is whitespace only', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: '   ', // Whitespace only
          attachments: [
            {
              type: 'photo',
              mimeType: 'image/jpeg',
              data: 'imagedata',
              name: 'photo.jpg',
              size: 1024,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        // Whitespace-only content should be trimmed and default prompt added
        expect(content).toHaveLength(2);
        expect(content[0]).toEqual({ type: 'text', text: 'Please analyze the image(s) I sent.' });
        expect(content[1]).toEqual({ type: 'image', data: 'imagedata', mimeType: 'image/jpeg' });
      });
    });

    describe('edge cases', () => {
      it('should handle empty attachments array', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'No attachments',
          attachments: [],
        };

        const result = callBuildUserMessage(orchestrator, msg);

        // Empty array should fall back to simple string
        expect(result.content).toBe('No attachments');
      });

      it('should handle attachment without name', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Document without name',
          attachments: [
            {
              type: 'document',
              mimeType: 'application/pdf',
              data: 'pdfdata',
              size: 1024,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        const fileDescription = content.find(c => c.type === 'text' && c.text?.includes('File:'));
        expect(fileDescription?.text).toBe('[File: unknown (application/pdf, 1024 bytes)]');
      });

      it('should handle attachment without mimeType', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Document without mimeType',
          attachments: [
            {
              type: 'document',
              data: 'docdata',
              name: 'file.xyz',
              size: 2048,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        const fileDescription = content.find(c => c.type === 'text' && c.text?.includes('File:'));
        expect(fileDescription?.text).toBe('[File: file.xyz (unknown type, 2048 bytes)]');
      });

      it('should handle attachment without size', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Document without size',
          attachments: [
            {
              type: 'document',
              mimeType: 'text/plain',
              data: 'docdata',
              name: 'file.txt',
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        const fileDescription = content.find(c => c.type === 'text' && c.text?.includes('File:'));
        expect(fileDescription?.text).toBe('[File: file.txt (text/plain, 0 bytes)]');
      });

      it('should handle attachment with all optional fields missing', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Minimal attachment',
          attachments: [
            {
              type: 'document',
              data: 'docdata',
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string; text?: string }>;

        const fileDescription = content.find(c => c.type === 'text' && c.text?.includes('File:'));
        expect(fileDescription?.text).toBe('[File: unknown (unknown type, 0 bytes)]');
      });

      it('should skip image with empty data', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Photo with empty data',
          attachments: [
            {
              type: 'photo',
              mimeType: 'image/jpeg',
              data: '', // Empty data
              name: 'empty.jpg',
              size: 0,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string }>;

        // Should only have text, image should be skipped
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe('text');
      });

      it('should skip image with undefined data', () => {
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Photo with undefined data',
          attachments: [
            {
              type: 'photo',
              mimeType: 'image/png',
              data: undefined as unknown as string, // Undefined data
              name: 'undefined.png',
              size: 1024,
            },
          ],
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const content = result.content as Array<{ type: string }>;

        // Should only have text, image should be skipped
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe('text');
      });
    });

    describe('timestamp', () => {
      it('should include timestamp in result', () => {
        const before = Date.now();
        const msg: InboundMessage = {
          channel: 'telegram',
          sender_id: '123',
          chat_id: '456',
          content: 'Test',
        };

        const result = callBuildUserMessage(orchestrator, msg);
        const after = Date.now();

        expect(result.timestamp).toBeGreaterThanOrEqual(before);
        expect(result.timestamp).toBeLessThanOrEqual(after);
      });
    });
  });
});
