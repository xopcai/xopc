/**
 * Typing Controller Tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TypingController } from '../typing-controller.js';

describe('TypingController', () => {
  let controller: TypingController;

  beforeEach(() => {
    controller = new TypingController();
  });

  afterEach(() => {
    controller.stopAll();
  });

  it('should create instance without error', () => {
    expect(controller).toBeDefined();
  });

  it('should start typing indicator', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';

    await controller.start(sendTyping, chatId);

    // Should have called sendTyping immediately
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(sendTyping).toHaveBeenCalledWith(undefined);
  });

  it('should start typing with threadId', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';
    const threadId = 789;

    await controller.start(sendTyping, chatId, threadId);

    expect(sendTyping).toHaveBeenCalledWith(threadId);
  });

  it('should not start multiple intervals for same chat', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';

    await controller.start(sendTyping, chatId);
    await controller.start(sendTyping, chatId);

    // Should only be called once (not twice)
    expect(sendTyping).toHaveBeenCalledTimes(1);
  });

  it('should stop typing indicator', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';

    await controller.start(sendTyping, chatId);
    await controller.stop(chatId);

    expect(controller.isTyping(chatId)).toBe(false);
  });

  it('should stop typing with threadId', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';
    const threadId = 789;

    await controller.start(sendTyping, chatId, threadId);
    await controller.stop(chatId, threadId);

    expect(controller.isTyping(chatId, threadId)).toBe(false);
  });

  it('should schedule stop', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';

    await controller.start(sendTyping, chatId);
    controller.scheduleStop(chatId);

    // Typing should still be active until next tick
    expect(controller.isTyping(chatId)).toBe(true);
  });

  it('should check if typing', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';

    expect(controller.isTyping(chatId)).toBe(false);

    await controller.start(sendTyping, chatId);
    expect(controller.isTyping(chatId)).toBe(true);

    await controller.stop(chatId);
    expect(controller.isTyping(chatId)).toBe(false);
  });

  it('should stop all typing indicators', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);

    await controller.start(sendTyping, 'chat1');
    await controller.start(sendTyping, 'chat2');
    await controller.start(sendTyping, 'chat3');

    controller.stopAll();

    expect(controller.isTyping('chat1')).toBe(false);
    expect(controller.isTyping('chat2')).toBe(false);
    expect(controller.isTyping('chat3')).toBe(false);
  });

  it('should handle sendTyping errors gracefully', async () => {
    const sendTyping = vi.fn().mockRejectedValue(new Error('Network error'));
    const chatId = '123456';

    // Should not throw
    await expect(controller.start(sendTyping, chatId)).resolves.not.toThrow();
  });

  it('should differentiate chats by threadId', async () => {
    const sendTyping = vi.fn().mockResolvedValue(undefined);
    const chatId = '123456';

    await controller.start(sendTyping, chatId, 100);
    expect(controller.isTyping(chatId, 100)).toBe(true);
    expect(controller.isTyping(chatId)).toBe(false);

    await controller.stop(chatId, 100);
    expect(controller.isTyping(chatId, 100)).toBe(false);
  });
});

describe('TypingController with debug mode', () => {
  it('should log debug messages when debug is true', async () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const controller = new TypingController(true);
    const sendTyping = vi.fn().mockResolvedValue(undefined);

    await controller.start(sendTyping, '123456');
    expect(consoleSpy).toHaveBeenCalled();

    controller.stopAll();
    consoleSpy.mockRestore();
  });
});
