import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createModelsCommand } from '../models.js';

vi.mock('../../../providers/index.js', () => ({
  getAllModels: vi.fn(() => []),
  getAvailableModels: vi.fn(async () => []),
  getConfiguredProviders: vi.fn(async () => []),
  getProviderAuthState: vi.fn(async () => ({ authMode: 'none', authStatus: 'not_connected' })),
  getProviderDisplayName: vi.fn((id: string) => id),
  isProviderConfigured: vi.fn(async () => false),
  providerSupportsApiKey: vi.fn(() => true),
  providerSupportsOAuth: vi.fn(() => false),
  resolveModel: vi.fn((ref: string) => {
    const [provider, id] = ref.split('/');
    return { provider, id, name: id };
  }),
}));

vi.mock('../../../config/index.js', () => ({
  loadConfig: vi.fn(() => ({ agents: { defaults: {} } })),
  saveConfig: vi.fn(async () => {}),
}));

vi.mock('../../context.js', () => ({
  getContextWithOpts: vi.fn(() => ({ configPath: '/tmp/xopc.json' })),
}));

vi.mock('../../../auth/credentials.js', () => ({
  CredentialResolver: vi.fn(() => ({
    listProfiles: vi.fn(async () => []),
    listOAuthTokens: vi.fn(async () => []),
    saveApiKey: vi.fn(async () => {}),
    deleteProviderCredential: vi.fn(async () => {}),
  })),
}));

vi.mock('../../utils/oauth-login.js', () => ({
  runCliOAuthLogin: vi.fn(async () => ({ provider: 'test', credentials: { access: 'x', refresh: 'r', expires: 1 } })),
}));

describe('Models Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts `models list` subcommand', async () => {
    const cmd = createModelsCommand({} as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmd.parseAsync(['node', 'test', 'list', '--json']);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('keeps root `models --json` working', async () => {
    const cmd = createModelsCommand({} as any);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await cmd.parseAsync(['node', 'test', '--json']);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
