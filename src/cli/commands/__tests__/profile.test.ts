import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createProfileCommand } from '../profile.js';

vi.mock('../../../config/profile.js', () => ({
  listProfiles: vi.fn(async () => [
    {
      name: 'default',
      stateDir: '/home/u/.xopc',
      isActive: true,
      agentCount: 1,
      createdAt: new Date('2026-01-01'),
    },
  ]),
  createProfile: vi.fn(),
  deleteProfile: vi.fn(),
  getCurrentProfile: vi.fn(() => 'default'),
  getSwitchCommand: vi.fn((name: string) => `export XOPC_PROFILE=${name}`),
  resolveProfileStateDir: vi.fn((name: string) => `/home/u/.xopc-${name}`),
}));

describe('Profile Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups list/create/delete/switch subcommands', () => {
    const cmd = createProfileCommand({} as any);
    expect(cmd.name()).toBe('profile');
    const names = cmd.commands.map((sub) => sub.name());
    expect(names).toEqual(expect.arrayContaining(['list', 'create', 'delete', 'switch']));
  });

  it('lists profiles as JSON', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cmd = createProfileCommand({} as any);

    await cmd.parseAsync(['node', 'test', 'list', '--json']);

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
