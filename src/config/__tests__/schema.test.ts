import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ConfigSchema,
  AgentDefaultsSchema,
  TelegramConfigSchema,
  ProvidersConfigSchema,
  GatewayConfigSchema,
  CronConfigSchema,
  ToolsConfigSchema,
  WhatsAppConfigSchema,
  ModelMetadataSchema,
  getApiKey,
  getApiBase,
  isOpenAICompatible,
  isAnthropicCompatible,
  parseModelId,
  isProviderConfigured,
  listConfiguredProviders,
  getWorkspacePath,
  listBuiltinModels,
  PROVIDER_OPTIONS,
  PROVIDER_NAMES,
} from '../schema.js';

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

  it('should accept multi-account configuration', () => {
    const config = TelegramConfigSchema.parse({
      enabled: true,
      accounts: {
        account1: {
          accountId: 'acc1',
          name: 'Account 1',
          token: 'token1',
          enabled: true,
        },
        account2: {
          accountId: 'acc2',
          name: 'Account 2',
          token: 'token2',
          enabled: false,
        },
      },
    });

    expect(config.accounts).toBeDefined();
    expect(config.accounts?.account1.accountId).toBe('acc1');
    expect(config.accounts?.account2.enabled).toBe(false);
  });

  it('should validate dmPolicy enum', () => {
    expect(() => {
      TelegramConfigSchema.parse({ dmPolicy: 'invalid' });
    }).toThrow();

    const valid = TelegramConfigSchema.parse({ dmPolicy: 'pairing' });
    expect(valid.dmPolicy).toBe('pairing');

    const valid2 = TelegramConfigSchema.parse({ dmPolicy: 'open' });
    expect(valid2.dmPolicy).toBe('open');

    const valid3 = TelegramConfigSchema.parse({ dmPolicy: 'disabled' });
    expect(valid3.dmPolicy).toBe('disabled');
  });

  it('should validate groupPolicy enum', () => {
    expect(() => {
      TelegramConfigSchema.parse({ groupPolicy: 'invalid' });
    }).toThrow();

    const valid = TelegramConfigSchema.parse({ groupPolicy: 'allowlist' });
    expect(valid.groupPolicy).toBe('allowlist');
  });

  it('should accept account configuration with groups and topics', () => {
    const config = TelegramConfigSchema.parse({
      accounts: {
        account1: {
          accountId: 'acc1',
          groups: {
            'group1': {
              groupId: 'g1',
              topics: {
                'topic1': {
                  topicId: 't1',
                  requireMention: true,
                  enabled: true,
                },
              },
            },
          },
        },
      },
    });

    expect(config.accounts).toBeDefined();
    expect(config.accounts?.account1.groups).toBeDefined();
    expect(config.accounts?.account1.groups?.group1.topics).toBeDefined();
    expect(config.accounts?.account1.groups?.group1.topics?.topic1.topicId).toBe('t1');
  });
});

describe('ProvidersConfigSchema', () => {
  it('should apply defaults when providers is undefined', () => {
    // When the entire providers section is undefined, defaults are applied
    // This happens when parsing the full ConfigSchema with empty input
    const providers = ProvidersConfigSchema.parse(undefined);

    // ProvidersConfigSchema has .default() that provides all provider defaults
    expect(providers.openai).toBeDefined();
    expect(providers.openai?.apiKey).toBe('');
    expect(providers.anthropic).toBeDefined();
    expect(providers.anthropic?.apiKey).toBe('');
    expect(providers.ollama).toBeDefined();
    expect(providers.ollama?.enabled).toBe(true);
    expect(providers.ollama?.baseUrl).toBe('http://127.0.0.1:11434/v1');
  });

  it('should have undefined fields when parsing empty object', () => {
    // When parsing empty object {}, fields are undefined (not defaults)
    const providers = ProvidersConfigSchema.parse({});
    expect(providers.openai).toBeUndefined();
  });

  it('should accept OpenAI provider config', () => {
    const providers = ProvidersConfigSchema.parse({
      openai: {
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    expect(providers.openai?.apiKey).toBe('sk-test');
    expect(providers.openai?.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('should accept Anthropic provider config', () => {
    const providers = ProvidersConfigSchema.parse({
      anthropic: {
        apiKey: 'ant-test',
        models: ['claude-sonnet-4-5'],
      },
    });

    expect(providers.anthropic?.apiKey).toBe('ant-test');
    expect(providers.anthropic?.models).toEqual(['claude-sonnet-4-5']);
  });

  it('should accept Ollama provider config', () => {
    const providers = ProvidersConfigSchema.parse({
      ollama: {
        enabled: true,
        baseUrl: 'http://localhost:11434/v1',
        autoDiscovery: false,
        models: ['llama3', 'mistral'],
      },
    });

    expect(providers.ollama?.enabled).toBe(true);
    expect(providers.ollama?.autoDiscovery).toBe(false);
  });

  it('should reject invalid Ollama properties', () => {
    expect(() => {
      ProvidersConfigSchema.parse({
        ollama: {
          enabled: true,
          invalidProp: 'should fail',
        },
      });
    }).toThrow();
  });

  it('should accept model metadata with cost info', () => {
    const providers = ProvidersConfigSchema.parse({
      openai: {
        apiKey: 'sk-test',
        models: [
          {
            id: 'gpt-4o',
            name: 'GPT-4o',
            reasoning: false,
            input: ['text', 'image'],
            cost: {
              input: 0.000005,
              output: 0.000015,
              cacheRead: 0.000001,
              cacheWrite: 0.000002,
            },
            contextWindow: 128000,
            maxTokens: 16384,
          },
        ],
      },
    });

    expect(providers.openai?.models?.[0]).toBeDefined();
    expect((providers.openai?.models?.[0] as any).cost.input).toBe(0.000005);
  });
});

describe('GatewayConfigSchema', () => {
  it('should parse empty object', () => {
    const gateway = GatewayConfigSchema.parse({});

    // GatewayConfigSchema uses optional fields, defaults are in ConfigSchema
    expect(gateway.host).toBeUndefined();
    expect(gateway.port).toBeUndefined();
  });

  it('should accept custom configuration', () => {
    const gateway = GatewayConfigSchema.parse({
      host: 'localhost',
      port: 3000,
      maxSseConnections: 50,
      corsOrigins: ['http://localhost:3000'],
    });

    expect(gateway.host).toBe('localhost');
    expect(gateway.port).toBe(3000);
    expect(gateway.maxSseConnections).toBe(50);
  });

  it('should accept heartbeat configuration', () => {
    const gateway = GatewayConfigSchema.parse({
      heartbeat: {
        enabled: false,
        intervalMs: 30000,
      },
    });

    expect(gateway.heartbeat?.enabled).toBe(false);
    expect(gateway.heartbeat?.intervalMs).toBe(30000);
  });
});

describe('CronConfigSchema', () => {
  it('should parse empty object', () => {
    const cron = CronConfigSchema.parse({});

    // CronConfigSchema uses optional fields, defaults are in ConfigSchema
    expect(cron.enabled).toBeUndefined();
  });

  it('should accept custom configuration', () => {
    const cron = CronConfigSchema.parse({
      enabled: false,
      maxConcurrentJobs: 10,
      defaultTimezone: 'America/New_York',
      historyRetentionDays: 30,
      enableMetrics: false,
    });

    expect(cron.enabled).toBe(false);
    expect(cron.maxConcurrentJobs).toBe(10);
  });
});

describe('ToolsConfigSchema', () => {
  it('should parse empty object', () => {
    const tools = ToolsConfigSchema.parse({});

    // ToolsConfigSchema uses optional fields, defaults are in ConfigSchema
    expect(tools.web).toBeUndefined();
  });

  it('should accept custom web search config', () => {
    const tools = ToolsConfigSchema.parse({
      web: {
        search: {
          apiKey: 'brave-key',
          maxResults: 10,
        },
      },
    });

    expect(tools.web?.search?.apiKey).toBe('brave-key');
    expect(tools.web?.search?.maxResults).toBe(10);
  });
});

describe('WhatsAppConfigSchema', () => {
  it('should have correct defaults', () => {
    const whatsapp = WhatsAppConfigSchema.parse({});

    expect(whatsapp.enabled).toBe(false);
    expect(whatsapp.bridgeUrl).toBe('ws://localhost:3001');
    expect(whatsapp.allowFrom).toEqual([]);
  });

  it('should accept custom configuration', () => {
    const whatsapp = WhatsAppConfigSchema.parse({
      enabled: true,
      bridgeUrl: 'ws://whatsapp-bridge:3001',
      allowFrom: ['+1234567890'],
    });

    expect(whatsapp.enabled).toBe(true);
    expect(whatsapp.allowFrom).toEqual(['+1234567890']);
  });
});

describe('ModelMetadataSchema', () => {
  it('should have correct defaults', () => {
    const model = ModelMetadataSchema.parse({
      id: 'gpt-4o',
      name: 'GPT-4o',
    });

    expect(model.reasoning).toBe(false);
    expect(model.input).toEqual(['text']);
    expect(model.cost.input).toBe(0);
    expect(model.contextWindow).toBe(128000);
    expect(model.maxTokens).toBe(16384);
  });

  it('should accept full model metadata', () => {
    const model = ModelMetadataSchema.parse({
      id: 'claude-sonnet-4-5',
      name: 'Claude Sonnet 4.5',
      reasoning: true,
      input: ['text', 'image'],
      cost: {
        input: 0.000003,
        output: 0.000015,
      },
      contextWindow: 200000,
      maxTokens: 8192,
    });

    expect(model.reasoning).toBe(true);
    expect(model.input).toEqual(['text', 'image']);
  });
});

describe('Helper Functions', () => {
  describe('getApiKey', () => {
    beforeEach(() => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    });

    afterEach(() => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
    });

    it('should return API key from config', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: 'sk-config-key' },
        },
      });

      expect(getApiKey(config, 'openai')).toBe('sk-config-key');
    });

    it('should return API key from env when not in config', () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: '' },
        },
      });

      expect(getApiKey(config, 'openai')).toBe('sk-env-key');
    });

    it('should prioritize config over env', () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: 'sk-config-key' },
        },
      });

      expect(getApiKey(config, 'openai')).toBe('sk-config-key');
    });

    it('should return null when no key found', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: '' },
        },
      });

      expect(getApiKey(config, 'openai')).toBeNull();
    });
  });

  describe('getApiBase', () => {
    it('should return base URL from config', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: '', baseUrl: 'https://custom.openai.com/v1' },
        },
      });

      expect(getApiBase(config, 'openai')).toBe('https://custom.openai.com/v1');
    });

    it('should return default base URL for provider', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: '' },
        },
      });

      expect(getApiBase(config, 'openai')).toBe('https://api.openai.com/v1');
    });

    it('should return null for unknown provider', () => {
      const config = ConfigSchema.parse({});
      expect(getApiBase(config, 'unknown')).toBeNull();
    });
  });

  describe('isOpenAICompatible', () => {
    it('should return true for OpenAI-compatible providers', () => {
      expect(isOpenAICompatible('openai')).toBe(true);
      expect(isOpenAICompatible('qwen')).toBe(true);
      expect(isOpenAICompatible('deepseek')).toBe(true);
      expect(isOpenAICompatible('groq')).toBe(true);
    });

    it('should return false for non-OpenAI providers', () => {
      expect(isOpenAICompatible('anthropic')).toBe(false);
      expect(isOpenAICompatible('google')).toBe(false);
      expect(isOpenAICompatible('ollama')).toBe(false);
    });
  });

  describe('isAnthropicCompatible', () => {
    it('should return true for Anthropic-compatible providers', () => {
      expect(isAnthropicCompatible('minimax')).toBe(true);
      expect(isAnthropicCompatible('minimax-cn')).toBe(true);
    });

    it('should return false for non-Anthropic providers', () => {
      expect(isAnthropicCompatible('openai')).toBe(false);
      expect(isAnthropicCompatible('anthropic')).toBe(false);
    });
  });

  describe('parseModelId', () => {
    it('should parse provider/model format', () => {
      expect(parseModelId('openai/gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
      expect(parseModelId('anthropic/claude-sonnet-4-5')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
    });

    it('should infer provider from model name', () => {
      expect(parseModelId('gpt-4o')).toEqual({ provider: 'openai', model: 'gpt-4o' });
      expect(parseModelId('claude-sonnet-4-5')).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-5' });
      expect(parseModelId('gemini-2.5-pro')).toEqual({ provider: 'google', model: 'gemini-2.5-pro' });
      expect(parseModelId('qwen-max')).toEqual({ provider: 'qwen', model: 'qwen-max' });
      expect(parseModelId('deepseek-chat')).toEqual({ provider: 'deepseek', model: 'deepseek-chat' });
    });

    it('should handle minimax-cn provider', () => {
      expect(parseModelId('minimax-cn/model')).toEqual({ provider: 'minimax-cn', model: 'model' });
    });

    it('should default to openai for unknown models', () => {
      expect(parseModelId('unknown-model')).toEqual({ provider: 'openai', model: 'unknown-model' });
    });
  });

  describe('isProviderConfigured', () => {
    it('should return true when provider has API key', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: 'sk-test' },
        },
      });

      expect(isProviderConfigured(config, 'openai')).toBe(true);
    });

    it('should return false when provider has no API key', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: '' },
        },
      });

      expect(isProviderConfigured(config, 'openai')).toBe(false);
    });
  });

  describe('listConfiguredProviders', () => {
    it('should return list of configured providers', () => {
      const config = ConfigSchema.parse({
        providers: {
          openai: { apiKey: 'sk-test' },
          anthropic: { apiKey: 'ant-test' },
          deepseek: { apiKey: '' },
        },
      });

      const providers = listConfiguredProviders(config);
      expect(providers).toContain('openai');
      expect(providers).toContain('anthropic');
      expect(providers).not.toContain('deepseek');
    });
  });

  describe('getWorkspacePath', () => {
    it('should expand tilde in workspace path', () => {
      const config = ConfigSchema.parse({
        agents: {
          defaults: {
            workspace: '~/custom-workspace',
          },
        },
      });

      const path = getWorkspacePath(config);
      expect(path).not.toMatch(/^~/);
      expect(path).toContain('custom-workspace');
    });

    it('should return absolute path as-is', () => {
      const config = ConfigSchema.parse({
        agents: {
          defaults: {
            workspace: '/absolute/path/workspace',
          },
        },
      });

      const path = getWorkspacePath(config);
      expect(path).toBe('/absolute/path/workspace');
    });
  });

  describe('listBuiltinModels', () => {
    it('should return non-empty array of models', () => {
      const models = listBuiltinModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it('should return models with required fields', () => {
      const models = listBuiltinModels();
      models.forEach(model => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('provider');
      });
    });

    it('should include popular models', () => {
      const models = listBuiltinModels();
      const modelIds = models.map(m => m.id);

      expect(modelIds).toContain('openai/gpt-4o');
      expect(modelIds).toContain('anthropic/claude-sonnet-4-5');
      expect(modelIds).toContain('google/gemini-2.5-pro');
    });
  });

  describe('PROVIDER_OPTIONS', () => {
    it('should contain provider options', () => {
      expect(PROVIDER_OPTIONS.length).toBeGreaterThan(0);
    });

    it('should have required fields for each option', () => {
      PROVIDER_OPTIONS.forEach(option => {
        expect(option).toHaveProperty('name');
        expect(option).toHaveProperty('value');
        expect(option).toHaveProperty('envKey');
        expect(option).toHaveProperty('models');
        expect(Array.isArray(option.models)).toBe(true);
      });
    });
  });

  describe('PROVIDER_NAMES', () => {
    it('should contain provider display names', () => {
      expect(PROVIDER_NAMES.openai).toBe('OpenAI');
      expect(PROVIDER_NAMES.anthropic).toBe('Anthropic');
      expect(PROVIDER_NAMES.google).toBe('Google');
    });
  });
});

describe('PluginsConfigSchema', () => {
  it('should accept boolean plugin configs', () => {
    const config = ConfigSchema.parse({
      plugins: {
        'plugin-a': true,
        'plugin-b': false,
      },
    });

    expect(config.plugins['plugin-a']).toBe(true);
    expect(config.plugins['plugin-b']).toBe(false);
  });

  it('should accept object plugin configs', () => {
    const config = ConfigSchema.parse({
      plugins: {
        'plugin-a': {
          key: 'value',
          nested: { foo: 'bar' },
        },
      },
    });

    expect(config.plugins['plugin-a']).toEqual({
      key: 'value',
      nested: { foo: 'bar' },
    });
  });

  it('should accept array plugin configs', () => {
    const config = ConfigSchema.parse({
      plugins: {
        'plugin-a': ['item1', 'item2'],
      },
    });

    expect(config.plugins['plugin-a']).toEqual(['item1', 'item2']);
  });
});

describe('Compaction and Pruning config', () => {
  it('should have correct compaction defaults', () => {
    const config = ConfigSchema.parse({});

    expect(config.agents.defaults.compaction?.enabled).toBe(true);
    expect(config.agents.defaults.compaction?.mode).toBe('default');
    expect(config.agents.defaults.compaction?.reserveTokens).toBe(8000);
    expect(config.agents.defaults.compaction?.triggerThreshold).toBe(0.8);
  });

  it('should validate compaction triggerThreshold range', () => {
    expect(() => {
      ConfigSchema.parse({
        agents: {
          defaults: {
            compaction: {
              triggerThreshold: 0.3, // Below minimum 0.5
            },
          },
        },
      });
    }).toThrow();

    expect(() => {
      ConfigSchema.parse({
        agents: {
          defaults: {
            compaction: {
              triggerThreshold: 1.0, // Above maximum 0.95
            },
          },
        },
      });
    }).toThrow();

    const valid = ConfigSchema.parse({
      agents: {
        defaults: {
          compaction: {
            triggerThreshold: 0.7,
          },
        },
      },
    });
    expect(valid.agents.defaults.compaction?.triggerThreshold).toBe(0.7);
  });

  it('should have correct pruning defaults', () => {
    const config = ConfigSchema.parse({});

    expect(config.agents.defaults.pruning?.enabled).toBe(true);
    expect(config.agents.defaults.pruning?.maxToolResultChars).toBe(10000);
    expect(config.agents.defaults.pruning?.headKeepRatio).toBe(0.3);
    expect(config.agents.defaults.pruning?.tailKeepRatio).toBe(0.3);
  });
});

describe('ModelRef type', () => {
  it('should support model object in agent defaults', () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          model: {
            primary: 'anthropic/claude-sonnet-4-5',
            fallbacks: ['openai/gpt-4o', 'google/gemini-2.5-pro'],
          },
        },
      },
    });

    const modelConfig = config.agents.defaults.model as any;
    expect(modelConfig.primary).toBe('anthropic/claude-sonnet-4-5');
    expect(modelConfig.fallbacks).toEqual(['openai/gpt-4o', 'google/gemini-2.5-pro']);
  });
});
