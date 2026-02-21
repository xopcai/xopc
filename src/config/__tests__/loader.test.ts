import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig, saveConfig, DEFAULT_PATHS } from '../loader.js';
import { getDefaultConfigPath } from '../paths.js';
import { ConfigSchema } from '../schema.js';

// Mock fs module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    promises: {
      unlink: vi.fn().mockResolvedValue(undefined),
      rename: vi.fn().mockResolvedValue(undefined),
      copyFile: vi.fn().mockResolvedValue(undefined),
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock os module
vi.mock('os', () => ({
  homedir: vi.fn(() => '/tmp/test-home'),
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

import * as fs from 'fs';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIG_PATH;
  });

  it('should return default config when file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.agents?.defaults?.model).toBe('anthropic/claude-sonnet-4-5');
    expect(config.agents?.defaults?.maxToolIterations).toBe(20);
  });

  it('should load and parse existing config file', () => {
    const mockConfig = {
      agents: {
        defaults: {
          model: 'openai/gpt-4o',
          temperature: 0.5,
        },
      },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const config = loadConfig();

    expect(config.agents?.defaults?.model).toBe('openai/gpt-4o');
    expect(config.agents?.defaults?.temperature).toBe(0.5);
    // Should merge with defaults
    expect(config.agents?.defaults?.maxToolIterations).toBe(20);
  });

  it('should handle custom config path from argument', () => {
    const customPath = '/custom/path/config.json';
    const mockConfig = { agents: { defaults: { model: 'test-model' } } };

    vi.mocked(fs.existsSync).mockImplementation((path) => path === customPath);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const config = loadConfig(customPath);

    expect(fs.readFileSync).toHaveBeenCalledWith(customPath, 'utf-8');
    expect(config.agents?.defaults?.model).toBe('test-model');
  });

  it('should handle custom config path from env var', () => {
    const envPath = '/env/path/config.json';
    process.env.CONFIG_PATH = envPath;

    const mockConfig = { agents: { defaults: { model: 'env-model' } } };

    vi.mocked(fs.existsSync).mockImplementation((path) => path === envPath);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const config = loadConfig();

    expect(fs.readFileSync).toHaveBeenCalledWith(envPath, 'utf-8');
    expect(config.agents?.defaults?.model).toBe('env-model');

    delete process.env.CONFIG_PATH;
  });

  it('should return default config when file has invalid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('not valid json');

    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.agents?.defaults?.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('should use default path when no custom path provided', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    loadConfig();

    expect(fs.existsSync).toHaveBeenCalledWith('/tmp/test-home/.xopcbot/config.json');
  });
});

describe('saveConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIG_PATH;
  });

  it('should save config to file', async () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          model: 'test-model',
        },
      },
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    await saveConfig(config);

    expect(fs.promises.writeFile).toHaveBeenCalledWith(
      '/tmp/test-home/.xopcbot/config.json',
      expect.stringContaining('test-model'),
      'utf-8'
    );
  });

  it('should create parent directories if they do not exist', async () => {
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    await saveConfig(config);

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/test-home/.xopcbot', { recursive: true });
    expect(fs.promises.writeFile).toHaveBeenCalled();
  });

  it('should handle custom config path', async () => {
    const customPath = '/custom/path/config.json';
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    await saveConfig(config, customPath);

    expect(fs.promises.writeFile).toHaveBeenCalledWith(customPath, expect.any(String), 'utf-8');
  });

  it('should write pretty-printed JSON', async () => {
    const config = ConfigSchema.parse({ agents: { defaults: { model: 'test' } } });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    await saveConfig(config);

    const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
    // Should be indented JSON
    expect(writtenContent).toContain('\n');
    expect(() => JSON.parse(writtenContent)).not.toThrow();
  });

  it('should backup existing config before writing', async () => {
    const config = ConfigSchema.parse({ agents: { defaults: { model: 'test' } } });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    await saveConfig(config);

    // Should copy existing config to .bak
    expect(fs.promises.copyFile).toHaveBeenCalledWith(
      '/tmp/test-home/.xopcbot/config.json',
      '/tmp/test-home/.xopcbot/config.json.bak'
    );
  });
});

describe('getDefaultConfigPath', () => {
  beforeEach(() => {
    delete process.env.XOPCBOT_CONFIG;
  });

  afterEach(() => {
    delete process.env.XOPCBOT_CONFIG;
  });

  it('should return default path', () => {
    const path = getDefaultConfigPath();
    expect(path).toBe('/tmp/test-home/.xopcbot/config.json');
  });

  it('should return env var path when set', () => {
    process.env.XOPCBOT_CONFIG = '/env/config.json';
    const path = getDefaultConfigPath();
    expect(path).toBe('/env/config.json');

    delete process.env.XOPCBOT_CONFIG;
  });
});

describe('loadConfig edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIG_PATH;
  });

  it('should handle config with missing sections', () => {
    const mockConfig = {
      providers: {
        openai: { apiKey: 'test-key' },
      },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const config = loadConfig();

    expect(config.providers?.openai?.apiKey).toBe('test-key');
    expect(config.agents?.defaults?.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('should handle empty config file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('{}');

    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.agents?.defaults).toBeDefined();
  });

  it('should handle config with extra unknown fields', () => {
    const mockConfig = {
      agents: {
        defaults: {
          model: 'test-model',
        },
      },
      unknownField: 'unknown fields are stripped by Zod',
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    // ConfigSchema doesn't use .strict(), so unknown fields are stripped
    // Known fields are still parsed correctly
    const config = loadConfig();

    // Known fields should be parsed
    expect(config.agents?.defaults?.model).toBe('test-model');
    // Unknown fields are ignored (not accessible on the typed result)
  });

  it('should handle partial provider config', () => {
    const mockConfig = {
      providers: {
        openai: { apiKey: 'test' },
        // anthropic and ollama are not provided, will be undefined
      },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    const config = loadConfig();

    expect(config.providers?.openai?.apiKey).toBe('test');
    // Unspecified providers are undefined (not merged with defaults)
    expect(config.providers?.anthropic).toBeUndefined();
    expect(config.providers?.ollama).toBeUndefined();
  });

  it('should handle whitespace-only JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('   \n\t  ');

    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.agents?.defaults?.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('should handle JSON with comments-like content (invalid JSON)', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('// comment\n{"agents": {}}');

    const config = loadConfig();

    // Should fall back to defaults since this is invalid JSON
    expect(config.agents?.defaults?.model).toBe('anthropic/claude-sonnet-4-5');
  });

  it('should handle deeply nested invalid config', () => {
    const mockConfig = {
      agents: {
        defaults: {
          temperature: 'invalid-string',
        },
      },
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));

    // Should fall back to defaults on validation error
    const config = loadConfig();

    expect(config.agents?.defaults?.temperature).toBe(0.7);
  });
});

describe('saveConfig edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIG_PATH;
  });

  it('should save config with all sections', async () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          model: 'test-model',
          maxTokens: 4096,
        },
      },
      providers: {
        openai: { apiKey: 'test-key' },
      },
      gateway: {
        port: 3000,
      },
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await saveConfig(config);

    const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed.agents.defaults.model).toBe('test-model');
    expect(parsed.providers.openai.apiKey).toBe('test-key');
    expect(parsed.gateway.port).toBe(3000);
  });

  it('should use env var CONFIG_PATH when set', async () => {
    process.env.CONFIG_PATH = '/env/config.json';
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await saveConfig(config);

    expect(fs.promises.writeFile).toHaveBeenCalledWith('/env/config.json', expect.any(String), 'utf-8');

    delete process.env.CONFIG_PATH;
  });

  it('should handle argument path taking precedence over env var', async () => {
    process.env.CONFIG_PATH = '/env/config.json';
    const argPath = '/arg/config.json';
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await saveConfig(config, argPath);

    expect(fs.promises.writeFile).toHaveBeenCalledWith(argPath, expect.any(String), 'utf-8');

    delete process.env.CONFIG_PATH;
  });

  it('should serialize config with proper structure', async () => {
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await saveConfig(config);

    const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent);

    expect(parsed).toHaveProperty('agents');
    expect(parsed).toHaveProperty('providers');
    expect(parsed).toHaveProperty('channels');
    expect(parsed).toHaveProperty('gateway');
    expect(parsed).toHaveProperty('tools');
    expect(parsed).toHaveProperty('cron');
  });

  it('should handle special characters in config values', async () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          workspace: '~/workspace with spaces',
        },
      },
      providers: {
        openai: { apiKey: 'sk-key-with-special-chars_123' },
      },
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);

    await saveConfig(config);

    const writtenContent = vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string;
    expect(() => JSON.parse(writtenContent)).not.toThrow();
  });

  it('should not backup when config file does not exist', async () => {
    const config = ConfigSchema.parse({ agents: { defaults: { model: 'test' } } });

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);

    await saveConfig(config);

    // Should not try to copy when file doesn't exist
    expect(fs.promises.copyFile).not.toHaveBeenCalled();
    expect(fs.promises.writeFile).toHaveBeenCalled();
  });
});

describe('DEFAULT_PATHS export', () => {
  it('should export DEFAULT_PATHS from loader', () => {
    expect(DEFAULT_PATHS).toBeDefined();
    expect(DEFAULT_PATHS.config).toBeDefined();
    expect(DEFAULT_PATHS.workspace).toBeDefined();
  });

  it('should have consistent paths', () => {
    expect(DEFAULT_PATHS.config).toContain('.xopcbot');
    expect(DEFAULT_PATHS.config).toContain('config.json');
  });
});

describe('dotenv integration', () => {
  it('should call dotenv config on loadConfig', async () => {
    const dotenv = await import('dotenv');
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(dotenv.config).mockClear();

    loadConfig();

    // dotenv.config should be called
    expect(dotenv.config).toHaveBeenCalled();
  });
});
