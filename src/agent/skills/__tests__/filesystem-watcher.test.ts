import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type WatchEvent = 'addDir' | 'add' | 'change' | 'unlink' | 'unlinkDir' | 'error';
type WatchCallback = (...args: unknown[]) => void;

function createMockWatcher() {
  const handlers = new Map<WatchEvent, WatchCallback[]>();
  const watcher = {
    on: vi.fn((event: WatchEvent, cb: WatchCallback) => {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      return watcher;
    }),
    close: vi.fn(async () => undefined),
    emit: (event: WatchEvent, ...args: unknown[]) => {
      for (const cb of handlers.get(event) ?? []) cb(...args);
    },
  };
  return watcher;
}

const createdWatchers: Array<ReturnType<typeof createMockWatcher>> = [];
const watchMock = vi.fn(() => {
  const watcher = createMockWatcher();
  createdWatchers.push(watcher);
  return watcher;
});

vi.mock('chokidar', () => ({
  default: { watch: watchMock },
}));

describe('SkillFilesystemWatcher', () => {
  let stateDir: string;
  let workspaceDir: string;
  let previousStateDir: string | undefined;
  let homeDir: string;

  beforeEach(() => {
    vi.useFakeTimers();
    watchMock.mockClear();
    createdWatchers.length = 0;
    stateDir = mkdtempSync(path.join(tmpdir(), 'xopc-skill-watch-state-'));
    workspaceDir = mkdtempSync(path.join(tmpdir(), 'xopc-skill-watch-workspace-'));
    previousStateDir = process.env.XOPC_STATE_DIR;
    homeDir = mkdtempSync(path.join(tmpdir(), 'xopc-skill-watch-home-'));
    process.env.XOPC_STATE_DIR = stateDir;
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(stateDir, 'skills.json'),
      JSON.stringify({ load: { watchDebounceMs: 10 } }),
    );
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (previousStateDir === undefined) delete process.env.XOPC_STATE_DIR;
    else process.env.XOPC_STATE_DIR = previousStateDir;
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(workspaceDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('debounces filesystem events before refreshing skills', async () => {
    const { SkillFilesystemWatcher } = await import('../filesystem-watcher.js');
    const changes: Array<{ changedPath?: string }> = [];
    const watcher = new SkillFilesystemWatcher({
      onChange: (event) => changes.push(event),
      agentsSkillsDir: path.join(homeDir, '.agents', 'skills'),
    });
    watcher.watchWorkspace(workspaceDir);

    const workspaceIndex = (watchMock.mock.calls as unknown as Array<[string]>).findIndex(
      ([root]) => path.resolve(root) === path.resolve(workspaceDir),
    );
    const workspaceWatcher = createdWatchers[workspaceIndex];
    const skillPath = path.join(workspaceDir, '.xopc', 'skills', 'demo', 'SKILL.md');
    workspaceWatcher?.emit('add', skillPath);
    workspaceWatcher?.emit('change', skillPath);

    await vi.advanceTimersByTimeAsync(9);
    expect(changes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(changes).toEqual([{ reason: 'watch', changedPath: skillPath }]);

    watcher.dispose();
  });

  it('watches workspace roots but ignores non-skill paths', async () => {
    const { SkillFilesystemWatcher } = await import('../filesystem-watcher.js');
    const watcher = new SkillFilesystemWatcher({
      onChange: () => undefined,
      agentsSkillsDir: path.join(homeDir, '.agents', 'skills'),
    });
    watcher.watchWorkspace(workspaceDir);

    const calls = watchMock.mock.calls as unknown as Array<
      [string, { ignored: (watchPath: string, stats?: { isDirectory?: () => boolean }) => boolean }]
    >;
    const workspaceCall = calls.find(([root]) => path.resolve(root) === path.resolve(workspaceDir));
    expect(workspaceCall).toBeTruthy();
    const ignored = workspaceCall![1].ignored;

    expect(ignored(path.join(workspaceDir, 'src'), { isDirectory: () => true })).toBe(true);
    expect(ignored(path.join(workspaceDir, 'skills'), { isDirectory: () => true })).toBe(true);
    expect(ignored(path.join(workspaceDir, '.xopc'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(workspaceDir, '.xopc', 'settings.json'), {})).toBe(true);
    expect(ignored(path.join(workspaceDir, '.xopc', 'skills'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(workspaceDir, '.xopc', 'skills', 'demo'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(workspaceDir, '.xopc', 'skills', '.tmp-demo-1'), { isDirectory: () => true })).toBe(true);
    expect(ignored(path.join(workspaceDir, '.xopc', 'skills', 'demo', 'README.md'), {})).toBe(true);
    expect(ignored(path.join(workspaceDir, '.xopc', 'skills', 'demo', 'SKILL.md'), {})).toBe(false);
    expect(ignored(path.join(workspaceDir, '.agents'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(workspaceDir, '.agents', 'skills'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(workspaceDir, '.agents', 'skills', 'demo'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(workspaceDir, '.agents', 'skills', 'demo', 'README.md'), {})).toBe(true);
    expect(ignored(path.join(workspaceDir, '.agents', 'skills', 'demo', 'SKILL.md'), {})).toBe(false);

    watcher.dispose();
  });

  it('watches ~/.agents/skills and ignores non-SKILL.md files', async () => {
    const { SkillFilesystemWatcher } = await import('../filesystem-watcher.js');
    const watcher = new SkillFilesystemWatcher({
      onChange: () => undefined,
      agentsSkillsDir: path.join(homeDir, '.agents', 'skills'),
    });
    const agentsRoot = path.join(homeDir, '.agents', 'skills');
    const calls = watchMock.mock.calls as unknown as Array<
      [string, { ignored: (watchPath: string, stats?: { isDirectory?: () => boolean }) => boolean }]
    >;
    const agentsCall = calls.find(([root]) => path.resolve(root) === path.resolve(agentsRoot));

    expect(agentsCall).toBeTruthy();
    const ignored = agentsCall![1].ignored;
    expect(ignored(path.join(agentsRoot, 'demo'), { isDirectory: () => true })).toBe(false);
    expect(ignored(path.join(agentsRoot, 'demo', 'README.md'), {})).toBe(true);
    expect(ignored(path.join(agentsRoot, 'demo', 'SKILL.md'), {})).toBe(false);
    watcher.dispose();
  });

  it('stops watching ~/.agents/skills after the compatibility source is disabled', async () => {
    const { SkillFilesystemWatcher } = await import('../filesystem-watcher.js');
    const agentsRoot = path.join(homeDir, '.agents', 'skills');
    const watcher = new SkillFilesystemWatcher({
      onChange: () => undefined,
      agentsSkillsDir: agentsRoot,
    });
    const calls = watchMock.mock.calls as unknown as Array<[string]>;
    const agentsIndex = calls.findIndex(
      ([root]) => path.resolve(root) === path.resolve(agentsRoot),
    );
    const agentsWatcher = createdWatchers[agentsIndex];

    writeFileSync(
      path.join(stateDir, 'skills.json'),
      JSON.stringify({ load: { sources: { agentsGlobal: { enabled: false } } } }),
    );
    watcher.watchAgentsGlobalSkillsDir();

    expect(agentsWatcher?.close).toHaveBeenCalledOnce();
    watcher.dispose();
  });

  it('does not start watchers when skills.load.watch is false', async () => {
    writeFileSync(path.join(stateDir, 'skills.json'), JSON.stringify({ load: { watch: false } }));
    const { SkillFilesystemWatcher } = await import('../filesystem-watcher.js');
    const watcher = new SkillFilesystemWatcher({
      onChange: () => undefined,
      agentsSkillsDir: path.join(homeDir, '.agents', 'skills'),
    });
    watcher.watchWorkspace(workspaceDir);

    expect(watchMock).not.toHaveBeenCalled();

    watcher.dispose();
  });
});
