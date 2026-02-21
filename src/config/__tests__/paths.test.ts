import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  XOPCBOT_DIR,
  DEFAULT_BASE_DIR,
  DEFAULT_PATHS,
  getDefaultConfigPath,
  getDefaultWorkspacePath,
  getBaseDir,
  getGlobalPluginsDir,
  getWorkspacePluginsDir,
  getBundledPluginsDir,
  getBundledSkillsDir,
  resolvePluginSdkPath,
} from '../paths.js';

describe('constants', () => {
  it('should define XOPCBOT_DIR', () => {
    expect(XOPCBOT_DIR).toBe('.xopcbot');
  });

  it('should define DEFAULT_BASE_DIR', () => {
    expect(DEFAULT_BASE_DIR).toBeDefined();
    expect(DEFAULT_BASE_DIR).toContain(XOPCBOT_DIR);
  });
});

describe('DEFAULT_PATHS', () => {
  it('should define config path', () => {
    expect(DEFAULT_PATHS.config).toBeDefined();
    expect(DEFAULT_PATHS.config).toContain('config.json');
  });

  it('should define workspace path', () => {
    expect(DEFAULT_PATHS.workspace).toBeDefined();
    expect(DEFAULT_PATHS.workspace).toContain('workspace');
  });

  it('should define sessions path', () => {
    expect(DEFAULT_PATHS.sessions).toBeDefined();
    expect(DEFAULT_PATHS.sessions).toContain('sessions');
  });

  it('should define plugins path', () => {
    expect(DEFAULT_PATHS.plugins).toBeDefined();
    expect(DEFAULT_PATHS.plugins).toContain('.plugins');
  });

  it('should define global plugins path', () => {
    expect(DEFAULT_PATHS.globalPlugins).toBeDefined();
    expect(DEFAULT_PATHS.globalPlugins).toContain('plugins');
  });

  it('should define memory path', () => {
    expect(DEFAULT_PATHS.memory).toBeDefined();
    expect(DEFAULT_PATHS.memory).toContain('memory');
  });

  it('should define cron jobs path', () => {
    expect(DEFAULT_PATHS.cronJobs).toBeDefined();
    expect(DEFAULT_PATHS.cronJobs).toContain('cron-jobs.json');
  });
});

describe('getDefaultConfigPath', () => {
  beforeEach(() => {
    delete process.env.XOPCBOT_CONFIG;
  });

  afterEach(() => {
    delete process.env.XOPCBOT_CONFIG;
  });

  it('should return default path when env var not set', () => {
    const path = getDefaultConfigPath();
    expect(path).toBe(DEFAULT_PATHS.config);
  });

  it('should return env var path when set', () => {
    process.env.XOPCBOT_CONFIG = '/custom/config.json';
    const path = getDefaultConfigPath();
    expect(path).toBe('/custom/config.json');
  });

  it('should handle empty env var', () => {
    process.env.XOPCBOT_CONFIG = '';
    const path = getDefaultConfigPath();
    // Empty string is falsy, so should fall back to default
    expect(path).toBe(DEFAULT_PATHS.config);
  });
});

describe('getDefaultWorkspacePath', () => {
  beforeEach(() => {
    delete process.env.XOPCBOT_WORKSPACE;
  });

  afterEach(() => {
    delete process.env.XOPCBOT_WORKSPACE;
  });

  it('should return default path when env var not set', () => {
    const path = getDefaultWorkspacePath();
    expect(path).toBe(DEFAULT_PATHS.workspace);
  });

  it('should return env var path when set', () => {
    process.env.XOPCBOT_WORKSPACE = '/custom/workspace';
    const path = getDefaultWorkspacePath();
    expect(path).toBe('/custom/workspace');
  });
});

describe('getBaseDir', () => {
  it('should return DEFAULT_BASE_DIR', () => {
    expect(getBaseDir()).toBe(DEFAULT_BASE_DIR);
  });
});

describe('getGlobalPluginsDir', () => {
  it('should return global plugins directory', () => {
    const dir = getGlobalPluginsDir();
    expect(dir).toBe(DEFAULT_PATHS.globalPlugins);
  });

  it('should be under xopcbot dir', () => {
    const dir = getGlobalPluginsDir();
    expect(dir).toContain(XOPCBOT_DIR);
  });
});

describe('getWorkspacePluginsDir', () => {
  it('should return default workspace plugins dir', () => {
    const dir = getWorkspacePluginsDir();
    expect(dir).toContain('.plugins');
  });

  it('should use provided workspace path', () => {
    const customWorkspace = '/custom/workspace';
    const dir = getWorkspacePluginsDir(customWorkspace);
    expect(dir).toBe('/custom/workspace/.plugins');
  });

  it('should use default workspace when not provided', () => {
    const dir = getWorkspacePluginsDir();
    expect(dir).toContain(DEFAULT_PATHS.workspace);
    expect(dir).toContain('.plugins');
  });
});

describe('getBundledPluginsDir', () => {
  it('should return a path or null', () => {
    const dir = getBundledPluginsDir();
    // Can be a string path or null if resolution fails
    if (dir !== null) {
      expect(typeof dir).toBe('string');
      expect(dir).toContain('plugins');
    }
  });
});

describe('getBundledSkillsDir', () => {
  it('should return a path or null', () => {
    const dir = getBundledSkillsDir();
    // Can be a string path or null if resolution fails
    if (dir !== null) {
      expect(typeof dir).toBe('string');
      expect(dir).toContain('skills');
    }
  });
});

describe('resolvePluginSdkPath', () => {
  it('should return a path or null', () => {
    const path = resolvePluginSdkPath();
    // Can be a string path or null if resolution fails
    if (path !== null) {
      expect(typeof path).toBe('string');
      expect(path).toContain('plugin-sdk');
      expect(path).toContain('index.ts');
    }
  });
});

describe('path consistency', () => {
  it('should have consistent base directory across all paths', () => {
    const baseDir = getBaseDir();
    
    expect(DEFAULT_PATHS.config).toContain(baseDir);
    expect(DEFAULT_PATHS.workspace).toContain(baseDir);
    expect(DEFAULT_PATHS.sessions).toContain(baseDir);
    expect(DEFAULT_PATHS.plugins).toContain(baseDir);
    expect(DEFAULT_PATHS.globalPlugins).toContain(baseDir);
    expect(DEFAULT_PATHS.memory).toContain(baseDir);
  });

  it('should have unique paths for different purposes', () => {
    const paths = [
      DEFAULT_PATHS.config,
      DEFAULT_PATHS.workspace,
      DEFAULT_PATHS.sessions,
      DEFAULT_PATHS.plugins,
      DEFAULT_PATHS.globalPlugins,
      DEFAULT_PATHS.memory,
      DEFAULT_PATHS.cronJobs,
    ];
    
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });
});

describe('environment variable precedence', () => {
  beforeEach(() => {
    delete process.env.XOPCBOT_CONFIG;
    delete process.env.XOPCBOT_WORKSPACE;
  });

  afterEach(() => {
    delete process.env.XOPCBOT_CONFIG;
    delete process.env.XOPCBOT_WORKSPACE;
  });

  it('should prioritize XOPCBOT_CONFIG over default', () => {
    const defaultPath = getDefaultConfigPath();
    
    process.env.XOPCBOT_CONFIG = '/env/config.json';
    const envPath = getDefaultConfigPath();
    
    expect(envPath).not.toBe(defaultPath);
    expect(envPath).toBe('/env/config.json');
  });

  it('should prioritize XOPCBOT_WORKSPACE over default', () => {
    const defaultPath = getDefaultWorkspacePath();
    
    process.env.XOPCBOT_WORKSPACE = '/env/workspace';
    const envPath = getDefaultWorkspacePath();
    
    expect(envPath).not.toBe(defaultPath);
    expect(envPath).toBe('/env/workspace');
  });
});
