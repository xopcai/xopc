/**
 * Inline Keyboards Tests
 */

import { describe, it, expect } from 'vitest';
import {
  TelegramInlineKeyboards,
  type ModelInfo,
  type ProviderInfo,
} from '../inline-keyboards.js';

describe('TelegramInlineKeyboards', () => {
  describe('providerSelector', () => {
    it('should create keyboard with providers', () => {
      const providers: ProviderInfo[] = [
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' },
      ];

      const keyboard = TelegramInlineKeyboards.providerSelector(providers);

      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard).toBeDefined();
      expect(keyboard.inline_keyboard.length).toBeGreaterThan(0);
    });

    it('should create buttons for each provider', () => {
      const providers: ProviderInfo[] = [
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' },
      ];

      const keyboard = TelegramInlineKeyboards.providerSelector(providers);

      // Flatten all buttons
      const allButtons = keyboard.inline_keyboard.flat();
      expect(allButtons.length).toBeGreaterThanOrEqual(2);
    });

    it('should use correct callback data prefix', () => {
      const providers: ProviderInfo[] = [
        { id: 'openai', name: 'OpenAI' },
      ];

      const keyboard = TelegramInlineKeyboards.providerSelector(providers);
      const allButtons = keyboard.inline_keyboard.flat();
      const providerButton = allButtons.find(btn => btn.callback_data?.includes('provider:openai'));
      expect(providerButton).toBeDefined();
    });
  });

  describe('modelSelector', () => {
    it('should create keyboard with models', () => {
      const models: ModelInfo[] = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
        { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
      ];

      const keyboard = TelegramInlineKeyboards.modelSelector(models, 'openai/gpt-4o');

      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard.length).toBeGreaterThan(0);
    });

    it('should have cancel button', () => {
      const models: ModelInfo[] = [
        { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'openai' },
      ];

      const keyboard = TelegramInlineKeyboards.modelSelector(models, 'openai/gpt-4o');

      const allButtons = keyboard.inline_keyboard.flat();
      const cancelButton = allButtons.find(btn => btn.text.includes('❌'));
      expect(cancelButton).toBeDefined();
    });
  });

  describe('cleanupConfirm', () => {
    it('should create confirmation keyboard', () => {
      const keyboard = TelegramInlineKeyboards.cleanupConfirm();

      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard).toBeDefined();
    });

    it('should have cleanup action', () => {
      const keyboard = TelegramInlineKeyboards.cleanupConfirm();

      const allButtons = keyboard.inline_keyboard.flat();
      const confirmButton = allButtons.find(btn => btn.callback_data?.includes('cleanup:confirm'));
      expect(confirmButton).toBeDefined();
    });

    it('should have cancel button', () => {
      const keyboard = TelegramInlineKeyboards.cleanupConfirm();

      const allButtons = keyboard.inline_keyboard.flat();
      const cancelButton = allButtons.find(btn => btn.callback_data?.includes('cancel'));
      expect(cancelButton).toBeDefined();
    });
  });

  describe('back', () => {
    it('should create back keyboard', () => {
      const keyboard = TelegramInlineKeyboards.back();

      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard.length).toBeGreaterThan(0);
    });
  });

  describe('confirm', () => {
    it('should create confirm keyboard with default labels', () => {
      const keyboard = TelegramInlineKeyboards.confirm();

      expect(keyboard).toBeDefined();
      expect(keyboard.inline_keyboard.length).toBeGreaterThan(0);
    });

    it('should create confirm keyboard with custom labels', () => {
      const keyboard = TelegramInlineKeyboards.confirm('Yes', 'yes');

      expect(keyboard).toBeDefined();
      const allButtons = keyboard.inline_keyboard.flat();
      const yesButton = allButtons.find(btn => btn.text === 'Yes');
      expect(yesButton).toBeDefined();
    });
  });
});
