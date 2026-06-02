import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCronCommand } from '../cron.js';

const toggleJob = vi.fn();
const runJobNow = vi.fn();
const listJobs = vi.fn(async () => []);
const stop = vi.fn(async () => {});

vi.mock('../cron-cli.js', () => ({
  withCronService: vi.fn(async (fn: (service: unknown) => Promise<void>) =>
    fn({
      listJobs,
      toggleJob,
      runJobNow,
      removeJob: vi.fn(),
      addJob: vi.fn(),
      stop,
    }),
  ),
}));

describe('Cron Command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers enable/disable/run/trigger subcommands', () => {
    const cmd = createCronCommand({} as any);
    const names = cmd.commands.map((sub) => sub.name());
    expect(names).toEqual(
      expect.arrayContaining(['list', 'add', 'remove', 'enable', 'disable', 'run', 'trigger']),
    );
  });

  it('enables a job by id', async () => {
    toggleJob.mockResolvedValue(true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = createCronCommand({} as any);
    await cmd.parseAsync(['node', 'test', 'enable', 'abc12345']);

    expect(toggleJob).toHaveBeenCalledWith('abc12345', true);
    logSpy.mockRestore();
  });

  it('runs a job by id', async () => {
    runJobNow.mockResolvedValue(undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const cmd = createCronCommand({} as any);
    await cmd.parseAsync(['node', 'test', 'run', 'abc12345']);

    expect(runJobNow).toHaveBeenCalledWith('abc12345');
    logSpy.mockRestore();
  });
});
