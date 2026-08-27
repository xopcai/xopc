import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerGatewayConnection } from '../gateway-process.js';
import { resolveTerminalWorkspace, TerminalManager } from '../ipc/terminal-ipc.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakePty {
  private readonly events = new EventEmitter();
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();

  onData(listener: (data: string) => void) {
    this.events.on('data', listener);
    return { dispose: () => this.events.off('data', listener) };
  }

  onExit(listener: (event: { exitCode: number; signal: number }) => void) {
    this.events.on('exit', listener);
    return { dispose: () => this.events.off('exit', listener) };
  }

  emitData(data: string) {
    this.events.emit('data', data);
  }

  emitExit(exitCode: number, signal = 0) {
    this.events.emit('exit', { exitCode, signal });
  }
}

function fakeOwner() {
  const events = new EventEmitter();
  let destroyed = false;
  return {
    send: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    once: events.once.bind(events),
    emitDestroyed: () => {
      destroyed = true;
      events.emit('destroyed');
    },
  };
}

describe('TerminalManager', () => {
  it('creates one PTY per session and forwards data', async () => {
    const child = new FakePty();
    const spawnPty = vi.fn(() => child);
    const resolveWorkspace = vi.fn(async () => '/tmp/project');
    const owner = fakeOwner();
    const manager = new TerminalManager({
      resolveWorkspace,
      spawnPty: spawnPty as never,
    });

    const input = { sessionKey: 'agent:main:webchat:default:direct:one', sessionId: 'session-1', cols: 100, rows: 30 };
    const first = await manager.create(owner as never, input);
    const second = await manager.create(owner as never, input);

    expect(second.terminalId).toBe(first.terminalId);
    expect(resolveWorkspace).toHaveBeenCalledOnce();
    expect(spawnPty).toHaveBeenCalledOnce();
    expect(spawnPty).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: '/tmp/project', cols: 100, rows: 30 }),
    );

    child.emitData('\u001b[32mready\u001b[0m\r\n');
    expect(owner.send).toHaveBeenCalledWith('terminal:data', {
      terminalId: first.terminalId,
      data: '\u001b[32mready\u001b[0m\r\n',
      sequence: 1,
    });
    const replayed = await manager.create(owner as never, input);
    expect(replayed.replay).toContain('ready');
    expect(replayed.replaySequence).toBe(1);
  });

  it('deduplicates concurrent creation for the same session', async () => {
    const child = new FakePty();
    let releaseWorkspace!: (cwd: string) => void;
    const resolveWorkspace = vi.fn(() => new Promise<string>((resolve) => {
      releaseWorkspace = resolve;
    }));
    const spawnPty = vi.fn(() => child);
    const manager = new TerminalManager({ resolveWorkspace, spawnPty: spawnPty as never });
    const input = {
      sessionKey: 'agent:main:webchat:default:direct:concurrent',
      sessionId: 'session-concurrent',
      cols: 80,
      rows: 24,
    };

    const first = manager.create(fakeOwner() as never, input);
    const second = manager.create(fakeOwner() as never, input);
    releaseWorkspace('/tmp/project');

    expect((await first).terminalId).toBe((await second).terminalId);
    expect(resolveWorkspace).toHaveBeenCalledOnce();
    expect(spawnPty).toHaveBeenCalledOnce();
  });

  it('writes, resizes, reports exit, and closes a PTY', async () => {
    const child = new FakePty();
    const owner = fakeOwner();
    const manager = new TerminalManager({
      resolveWorkspace: async () => '/tmp/project',
      spawnPty: (() => child) as never,
    });
    const terminal = await manager.create(owner as never, {
      sessionKey: 'agent:main:webchat:default:direct:two',
      sessionId: 'session-2',
      cols: 80,
      rows: 24,
    });

    manager.write(terminal.terminalId, 'pnpm test\r');
    manager.resize(terminal.terminalId, 120, 40);
    expect(child.write).toHaveBeenCalledWith('pnpm test\r');
    expect(child.resize).toHaveBeenCalledWith(120, 40);

    child.emitExit(2, 15);
    expect(owner.send).toHaveBeenCalledWith('terminal:exit', {
      terminalId: terminal.terminalId,
      exitCode: 2,
      signal: 15,
    });
    expect((await manager.create(owner as never, {
      sessionKey: terminal.sessionKey,
      sessionId: terminal.sessionId,
      cols: 80,
      rows: 24,
    })).exited).toBe(true);

    manager.close(terminal.terminalId);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('kills the PTY when its renderer is destroyed', async () => {
    const child = new FakePty();
    const owner = fakeOwner();
    const manager = new TerminalManager({
      resolveWorkspace: async () => '/tmp/project',
      spawnPty: (() => child) as never,
    });
    await manager.create(owner as never, {
      sessionKey: 'agent:main:webchat:default:direct:three',
      sessionId: 'session-3',
      cols: 80,
      rows: 24,
    });

    owner.emitDestroyed();
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('does not leave a PTY behind when the renderer is destroyed during creation', async () => {
    const child = new FakePty();
    const owner = fakeOwner();
    let releaseWorkspace!: (cwd: string) => void;
    const manager = new TerminalManager({
      resolveWorkspace: () => new Promise<string>((resolve) => {
        releaseWorkspace = resolve;
      }),
      spawnPty: (() => child) as never,
    });
    const creation = manager.create(owner as never, {
      sessionKey: 'agent:main:webchat:default:direct:destroyed',
      sessionId: 'session-destroyed',
      cols: 80,
      rows: 24,
    });
    owner.emitDestroyed();
    releaseWorkspace('/tmp/project');

    await expect(creation).rejects.toThrow('renderer was destroyed');
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('rejects invalid terminal dimensions before spawning', async () => {
    const spawnPty = vi.fn();
    const manager = new TerminalManager({
      resolveWorkspace: async () => '/tmp/project',
      spawnPty: spawnPty as never,
    });

    await expect(manager.create(fakeOwner() as never, {
      sessionKey: 'session-key',
      sessionId: 'session-id',
      cols: 1,
      rows: 24,
    })).rejects.toThrow('cols must be an integer');
    expect(spawnPty).not.toHaveBeenCalled();
  });
});

describe('resolveTerminalWorkspace', () => {
  it('uses the registered shared gateway connection in Electron dev', async () => {
    registerGatewayConnection({ port: 18790, token: 'dev-token' });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        payload: { sessionId: 'session-dev' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        payload: { effectiveWorkspacePath: process.cwd() },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveTerminalWorkspace('session-key', 'session-dev')).resolves.toBe(process.cwd());
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:18790/api/sessions/resolve?sessionKey=session-key',
      expect.objectContaining({ headers: { Authorization: 'Bearer dev-token' } }),
    );
  });
});
