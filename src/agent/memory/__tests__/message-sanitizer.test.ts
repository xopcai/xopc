/**
 * Tests for Message Sanitizer
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeMessages,
  cleanTrailingErrors,
  validateMessage,
  hasProblematicMessages,
} from '../message-sanitizer.js';
import type { AgentMessage } from '@mariozechner/pi-agent-core';

describe('MessageSanitizer', () => {
  describe('sanitizeMessages', () => {
    it('should keep valid assistant messages', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }], timestamp: 2 },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.removed).toBe(0);
    });

    it('should remove error messages with stopReason: error', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          errorMessage: 'API error',
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(1);
      expect(result.removed).toBe(1);
      expect(result.messages[0].role).toBe('user');
    });

    it('should remove messages with errorMessage field', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          errorMessage: 'tool_call_id is not found',
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(1);
      expect(result.removed).toBe(1);
    });

    it('should remove messages with empty content', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          timestamp: 2,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '   ' }], // whitespace only
          timestamp: 3,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(1);
      expect(result.removed).toBe(2);
    });

    it('should remove assistant messages with empty content array', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [],
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(1);
      expect(result.removed).toBe(1);
    });

    it('should keep messages with tool calls even without text', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'toolCall', name: 'search', id: '123', args: {} }],
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.removed).toBe(0);
    });

    it('should keep assistant messages with OpenAI-style tool_calls only', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'bash', arguments: '{}' },
            },
          ],
          timestamp: 2,
        } as AgentMessage,
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.removed).toBe(0);
    });

    it('should keep messages with thinking blocks', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Let me think...' }],
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.removed).toBe(0);
    });

    it('should keep recent messages when keepRecent is set', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          timestamp: 2,
        },
        { role: 'user', content: 'Another message', timestamp: 3 },
      ];

      const result = sanitizeMessages(messages, { keepRecent: 2 });

      // Should keep user message and the error message (it's in the recent 2)
      expect(result.messages).toHaveLength(3);
      expect(result.removed).toBe(0);
    });

    it('should keep assistant messages with image blocks without type (data + mimeType only)', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ data: 'base64...', mimeType: 'image/jpeg' } as unknown as { type: 'text'; text: string }],
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.removed).toBe(0);
    });

    it('should keep assistant messages with image_url style blocks', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [
            {
              type: 'image_url',
              image_url: { url: 'https://example.com/a.png' },
            } as unknown as { type: 'text'; text: string },
          ],
          timestamp: 2,
        },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.removed).toBe(0);
    });

    it('should preserve non-assistant messages', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        { role: 'system', content: 'System message', timestamp: 2 },
        { role: 'toolResult', content: 'Result', tool_call_id: '123', timestamp: 3 },
      ];

      const result = sanitizeMessages(messages);

      expect(result.messages).toHaveLength(3);
      expect(result.removed).toBe(0);
    });
  });

  describe('cleanTrailingErrors', () => {
    it('should remove trailing error messages', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }], timestamp: 2 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          timestamp: 3,
        },
      ];

      const result = cleanTrailingErrors(messages);

      expect(result).toHaveLength(2);
      expect(result[1].content).toEqual([{ type: 'text', text: 'Hi!' }]);
    });

    it('should stop at first valid message', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          timestamp: 2,
        },
        { role: 'user', content: 'Another', timestamp: 3 },
        { role: 'assistant', content: [{ type: 'text', text: 'Response' }], timestamp: 4 },
      ];

      const result = cleanTrailingErrors(messages);

      expect(result).toHaveLength(4);
    });

    it('should handle multiple trailing errors', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello', timestamp: 1 },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }], timestamp: 2 },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          timestamp: 3,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'aborted',
          timestamp: 4,
        },
      ];

      const result = cleanTrailingErrors(messages);

      expect(result).toHaveLength(2);
    });

    it('should return empty array if all messages are errors', () => {
      const messages: AgentMessage[] = [
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          timestamp: 1,
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
          timestamp: 2,
        },
      ];

      const result = cleanTrailingErrors(messages);

      expect(result).toHaveLength(0);
    });
  });

  describe('validateMessage', () => {
    it('should return null for valid user messages', () => {
      const message: AgentMessage = { role: 'user', content: 'Hello' };

      expect(validateMessage(message)).toBeNull();
    });

    it('should return null for valid assistant messages', () => {
      const message: AgentMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
      };

      expect(validateMessage(message)).toBeNull();
    });

    it('should return error for error messages', () => {
      const message: AgentMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        stopReason: 'error',
      };

      expect(validateMessage(message)).toContain('Error message');
    });

    it('should return error for empty messages', () => {
      const message: AgentMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
      };

      expect(validateMessage(message)).toContain('Empty');
    });
  });

  describe('hasProblematicMessages', () => {
    it('should return false for clean messages', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ];

      expect(hasProblematicMessages(messages)).toBe(false);
    });

    it('should return true if error message present', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
          stopReason: 'error',
        },
      ];

      expect(hasProblematicMessages(messages)).toBe(true);
    });

    it('should return true if empty message present', () => {
      const messages: AgentMessage[] = [
        { role: 'user', content: 'Hello' },
        {
          role: 'assistant',
          content: [{ type: 'text', text: '' }],
        },
      ];

      expect(hasProblematicMessages(messages)).toBe(true);
    });
  });
});
