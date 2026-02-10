import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig, saveConfig, getConfigPath } from '../loader.js';
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

  it('should save config to file', () => {
    const config = ConfigSchema.parse({
      agents: {
        defaults: {
          model: 'test-model',
        },
      },
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveConfig(config);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/tmp/test-home/.xopcbot/config.json',
      expect.stringContaining('test-model'),
      'utf-8'
    );
  });

  it('should create parent directories if they do not exist', () => {
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveConfig(config);

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/test-home/.xopcbot', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalled();
  });

  it('should handle custom config path', () => {
    const customPath = '/custom/path/config.json';
    const config = ConfigSchema.parse({});

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveConfig(config, customPath);

    expect(fs.writeFileSync).toHaveBeenCalledWith(customPath, expect.any(String), 'utf-8');
  });

  it('should write pretty-printed JSON', () => {
    const config = ConfigSchema.parse({ agents: { defaults: { model: 'test' } } });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    saveConfig(config);

    const writtenContent = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
    // Should be indented JSON
    expect(writtenContent).toContain('\n');
    expect(() => JSON.parse(writtenContent)).not.toThrow();
  });
});

describe('getConfigPath', () => {
  beforeEach(() => {
    delete process.env.CONFIG_PATH;
  });

  it('should return default path', () => {
    const path = getConfigPath();
    expect(path).toBe('/tmp/test-home/.xopcbot/config.json');
  });

  it('should return env var path when set', () => {
    process.env.CONFIG_PATH = '/env/config.json';
    const path = getConfigPath();
    expect(path).toBe('/env/config.json');

    delete process.env.CONFIG_PATH;
  });
});
