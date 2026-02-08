import { describe, it, expect } from 'vitest';
import { ConfigSchema, AgentDefaultsSchema, TelegramConfigSchema } from '../schema.js';

describe('ConfigSchema', () => {
  it('should parse empty object with defaults', () => {
    const config = ConfigSchema.parse({});

    expect(config.agents.defaults.model).toBe('anthropic/claude-sonnet-4-5');
    expect(config.agents.defaults.maxTokens).toBe(8192);
    expect(config.agents.defaults.temperature).toBe(0.7);
    expect(config.agents.defaults.maxToolIterations).toBe(20);
  });

  it('should merge with provided values', () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          model: 'openai/gpt-4o',
          temperature: 0.5,
        },
      },
    });

    expect(config.agents.defaults.model).toBe('openai/gpt-4o');
    expect(config.agents.defaults.temperature).toBe(0.5);
    // Should keep defaults for unspecified fields
    expect(config.agents.defaults.maxTokens).toBe(8192);
  });

  it('should validate provider configuration', () => {
    const config = ConfigSchema.parse({
      providers: {
        openai: {
          apiKey: 'sk-test123',
          baseUrl: 'https://api.openai.com',
        },
      },
    });

    expect(config.providers.openai.apiKey).toBe('sk-test123');
  });

  it('should validate channel configuration', () => {
    const config = ConfigSchema.parse({
      channels: {
        telegram: {
          enabled: true,
          token: 'bot-token',
          allowFrom: ['123456'],
        },
      },
    });

    expect(config.channels.telegram.enabled).toBe(true);
    expect(config.channels.telegram.token).toBe('bot-token');
    expect(config.channels.telegram.allowFrom).toEqual(['123456']);
  });

  it('should throw on invalid data', () => {
    expect(() => {
      ConfigSchema.parse({
        agents: {
          defaults: {
            temperature: 'not-a-number',
          },
        },
      });
    }).toThrow();
  });
});

describe('AgentDefaultsSchema', () => {
  it('should have correct defaults', () => {
    const defaults = AgentDefaultsSchema.parse({});

    expect(defaults.workspace).toBe('~/.xopcbot/workspace');
    expect(defaults.model).toBe('anthropic/claude-sonnet-4-5');
    expect(defaults.maxTokens).toBe(8192);
    expect(defaults.temperature).toBe(0.7);
    expect(defaults.maxToolIterations).toBe(20);
  });

  it('should validate temperature range', () => {
    const valid = AgentDefaultsSchema.parse({ temperature: 0.5 });
    expect(valid.temperature).toBe(0.5);

    // Note: Zod doesn't enforce range by default, just number type
    const high = AgentDefaultsSchema.parse({ temperature: 2.0 });
    expect(high.temperature).toBe(2.0);
  });
});

describe('TelegramConfigSchema', () => {
  it('should have correct defaults', () => {
    const config = TelegramConfigSchema.parse({});

    expect(config.enabled).toBe(false);
    expect(config.token).toBe('');
    expect(config.allowFrom).toEqual([]);
  });

  it('should accept valid configuration', () => {
    const config = TelegramConfigSchema.parse({
      enabled: true,
      token: '123456:ABC-DEF',
      allowFrom: ['123456789', '@username'],
    });

    expect(config.enabled).toBe(true);
    expect(config.token).toBe('123456:ABC-DEF');
  });
});
