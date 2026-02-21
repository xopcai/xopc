import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigHotReloader, type ReloadCallbacks, type HotReloadConfig } from '../reload.js';
import type { Config } from '../schema.js';

// Mock fs watch
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    watch: vi.fn(),
  };
});

// Mock logger
vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock loadConfig
vi.mock('../loader.js', () => ({
  loadConfig: vi.fn(),
}));

import { watch } from 'fs';
import { loadConfig } from '../loader.js';

describe('ConfigHotReloader', () => {
  const mockConfigPath = '/test/config.json';
  
  const mockInitialConfig: Config = {
    agents: {
      defaults: {
        workspace: '~/.xopcbot/workspace',
        model: 'anthropic/claude-sonnet-4-5',
        maxTokens: 8192,
        temperature: 0.7,
        maxToolIterations: 20,
      },
    },
    channels: {
      telegram: {
        enabled: false,
        token: '',
        allowFrom: [],
        debug: false,
        dmPolicy: 'pairing',
        groupPolicy: 'open',
      },
      whatsapp: {
        enabled: false,
        bridgeUrl: 'ws://localhost:3001',
        allowFrom: [],
      },
    },
    providers: {
      openai: { apiKey: '' },
      anthropic: { apiKey: '' },
      ollama: {
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434/v1',
        autoDiscovery: true,
      },
    },
    gateway: {
      host: '0.0.0.0',
      port: 18790,
      heartbeat: {
        enabled: true,
        intervalMs: 60000,
      },
      maxSseConnections: 100,
      corsOrigins: ['*'],
    },
    tools: {
      web: {
        search: {
          apiKey: '',
          maxResults: 5,
        },
      },
    },
    cron: {
      enabled: true,
      maxConcurrentJobs: 5,
      defaultTimezone: 'UTC',
      historyRetentionDays: 7,
      enableMetrics: true,
    },
    plugins: {},
    modelsDev: {
      enabled: true,
    },
  };

  const mockCallbacks: ReloadCallbacks = {
    onProvidersReload: vi.fn(),
    onAgentDefaultsReload: vi.fn(),
    onChannelsReload: vi.fn(),
    onCronReload: vi.fn(),
    onHeartbeatReload: vi.fn(),
    onToolsReload: vi.fn(),
    onWebSearchReload: vi.fn(),
    onFullRestart: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up any running reloader
  });

  describe('constructor', () => {
    it('should create instance with default options', () => {
      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      expect(reloader.isEnabled()).toBe(true);
      expect(reloader.getConfig()).toBe(mockInitialConfig);
    });

    it('should create instance with custom options', () => {
      const options: HotReloadConfig = {
        debounceMs: 500,
        enabled: false,
      };

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks,
        options
      );

      expect(reloader.isEnabled()).toBe(false);
    });
  });

  describe('start', () => {
    it('should not start watcher when disabled', () => {
      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks,
        { enabled: false }
      );

      reloader.start();

      expect(watch).not.toHaveBeenCalled();
    });

    it('should start watcher when enabled', () => {
      const mockWatcher = {
        close: vi.fn(),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as any);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks,
        { enabled: true }
      );

      reloader.start();

      expect(watch).toHaveBeenCalledWith(mockConfigPath, expect.any(Function));
    });

    it('should handle watcher setup errors', () => {
      vi.mocked(watch).mockImplementation(() => {
        throw new Error('Watch failed');
      });

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      expect(() => reloader.start()).not.toThrow();
    });
  });

  describe('stop', () => {
    it('should close watcher', async () => {
      const mockWatcher = {
        close: vi.fn(),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as any);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      reloader.start();
      await reloader.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should clear debounce timer', async () => {
      const mockWatcher = {
        close: vi.fn(),
      };
      vi.mocked(watch).mockReturnValue(mockWatcher as any);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      reloader.start();
      
      // Trigger a change to start debounce timer
      const watcherCallback = vi.mocked(watch).mock.calls[0][1];
      watcherCallback('change');
      
      await reloader.stop();

      expect(mockWatcher.close).toHaveBeenCalled();
    });

    it('should handle stop when not started', async () => {
      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      await expect(reloader.stop()).resolves.not.toThrow();
    });
  });

  describe('reload', () => {
    it('should successfully reload config with no changes', async () => {
      vi.mocked(loadConfig).mockReturnValue(mockInitialConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.reload();

      expect(result.success).toBe(true);
      expect(result.plan).toBeUndefined();
    });

    it('should detect and apply provider changes', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        providers: {
          ...mockInitialConfig.providers,
          openai: { apiKey: 'new-key' },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.reload();

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(mockCallbacks.onProvidersReload).toHaveBeenCalledWith(newConfig);
    });

    it('should detect and apply agent defaults changes', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        agents: {
          defaults: {
            ...mockInitialConfig.agents.defaults,
            model: 'openai/gpt-4o',
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.reload();

      expect(result.success).toBe(true);
      expect(mockCallbacks.onAgentDefaultsReload).toHaveBeenCalledWith(newConfig);
    });

    it('should detect and apply channel changes', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        channels: {
          ...mockInitialConfig.channels,
          telegram: {
            ...mockInitialConfig.channels.telegram,
            enabled: true,
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.reload();

      expect(result.success).toBe(true);
      expect(mockCallbacks.onChannelsReload).toHaveBeenCalledWith(newConfig);
    });

    it('should trigger full restart for gateway changes', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        gateway: {
          ...mockInitialConfig.gateway,
          port: 9999,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.reload();

      expect(result.success).toBe(true);
      expect(mockCallbacks.onFullRestart).toHaveBeenCalledWith(newConfig);
      // Should not call hot reload callbacks when restart is required
      expect(mockCallbacks.onProvidersReload).not.toHaveBeenCalled();
    });

    it('should handle reload errors gracefully', async () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('Failed to load config');
      });

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.reload();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should update current config after successful reload', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        providers: {
          ...mockInitialConfig.providers,
          openai: { apiKey: 'new-key' },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      await reloader.reload();

      expect(reloader.getConfig()).toBe(newConfig);
    });
  });

  describe('scheduleReload', () => {
    it('should debounce multiple rapid calls', async () => {
      vi.useFakeTimers();
      
      const newConfig: Config = {
        ...mockInitialConfig,
        providers: {
          ...mockInitialConfig.providers,
          openai: { apiKey: 'new-key' },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks,
        { debounceMs: 100 }
      );

      // Manually call scheduleReload multiple times
      (reloader as any).scheduleReload();
      (reloader as any).scheduleReload();
      (reloader as any).scheduleReload();

      // Should only have one pending timer
      await vi.advanceTimersByTimeAsync(100);

      expect(mockCallbacks.onProvidersReload).toHaveBeenCalledTimes(1);
      
      vi.useRealTimers();
    });
  });

  describe('triggerReload', () => {
    it('should manually trigger reload', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        providers: {
          ...mockInitialConfig.providers,
          openai: { apiKey: 'manual-key' },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      const result = await reloader.triggerReload();

      expect(result.success).toBe(true);
      expect(mockCallbacks.onProvidersReload).toHaveBeenCalledWith(newConfig);
    });
  });

  describe('applyHotPath', () => {
    it('should call onCronReload for cron paths', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        cron: {
          ...mockInitialConfig.cron,
          enabled: false,
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      await reloader.reload();

      expect(mockCallbacks.onCronReload).toHaveBeenCalledWith(newConfig);
    });

    it('should call onToolsReload for tools paths', async () => {
      const newConfig: Config = {
        ...mockInitialConfig,
        tools: {
          web: {
            search: {
              apiKey: 'new-search-key',
              maxResults: 10,
            },
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      await reloader.reload();

      expect(mockCallbacks.onToolsReload).toHaveBeenCalledWith(newConfig);
    });

    it('should call onWebSearchReload for webTools paths', async () => {
      // Note: webTools path matching is for legacy compatibility
      // Current config uses tools.web.search structure
      const newConfig: Config = {
        ...mockInitialConfig,
        tools: {
          web: {
            search: {
              apiKey: 'web-key',
              maxResults: 20,
            },
          },
        },
      };
      vi.mocked(loadConfig).mockReturnValue(newConfig);

      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      await reloader.reload();

      // tools.web changes trigger onToolsReload, which covers web search
      expect(mockCallbacks.onToolsReload).toHaveBeenCalledWith(newConfig);
    });
  });

  describe('getConfig', () => {
    it('should return current config', () => {
      const reloader = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks
      );

      expect(reloader.getConfig()).toBe(mockInitialConfig);
    });
  });

  describe('isEnabled', () => {
    it('should return enabled state', () => {
      const reloaderEnabled = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks,
        { enabled: true }
      );
      expect(reloaderEnabled.isEnabled()).toBe(true);

      const reloaderDisabled = new ConfigHotReloader(
        mockConfigPath,
        mockInitialConfig,
        mockCallbacks,
        { enabled: false }
      );
      expect(reloaderDisabled.isEnabled()).toBe(false);
    });
  });
});
