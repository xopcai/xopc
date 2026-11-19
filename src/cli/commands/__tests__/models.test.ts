import { Command } from 'commander';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { initializeTestAgentCatalog } from '../../../agent-catalog/test-support.js';
import { providerSupportsOAuth } from '../../../providers/index.js';
import { runCliOAuthLogin } from '../../utils/oauth-login.js';
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
  loadConfig: vi.fn(() => ({
    agents: {
      default: 'main',
      defaults: {
        models: { chat: { primary: 'deepseek/deepseek-v4-flash', fallbacks: [] }, intents: {} },
      },
      list: [],
    },
  })),
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
    initializeTestAgentCatalog();
    vi.clearAllMocks();
  });

  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['models --json', ['models', '--json']],
    ['models list --json', ['models', 'list', '--json']],
  ])('outputs JSON for %s', async (_command, args) => {
    const program = new Command().addCommand(createModelsCommand({} as any));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(args, { from: 'user' });

    expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({ providers: [], models: [] });
  });

  it('passes --provider to the nested auth login action', async () => {
    const program = new Command().addCommand(createModelsCommand({} as any));
    vi.mocked(providerSupportsOAuth).mockReturnValueOnce(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await program.parseAsync(['models', 'auth', 'login', '--provider', 'openai', '--method', 'oauth'], { from: 'user' });

    expect(runCliOAuthLogin).toHaveBeenCalledWith({ provider: 'openai', onProgress: expect.any(Function) });
  });
});
