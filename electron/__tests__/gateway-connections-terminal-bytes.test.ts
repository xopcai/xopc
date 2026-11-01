import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';

import { canonicalJson } from '@xopcai/endpoint-tools-protocol';

import { expect, it, vi } from 'vitest';

import { DesktopExecutionLease } from '../desktop/operation-journal.js';
import { DesktopTerminalBytes } from '../desktop/terminal-bytes.js';
import { DesktopTerminalLedger } from '../desktop/terminal-input-ledger.js';
import { DesktopContainerEngine } from '../desktop/container-engine.js';

class Socket extends Duplex {
  readonly writes: Buffer[] = [];
  hold = false;
  _read() {}
  _write(bytes: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    this.writes.push(Buffer.from(bytes)); if (!this.hold) callback();
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'xopc-terminal-bytes-')), lease = new DesktopExecutionLease(root);
  const binding = { sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() };
  const ledger = new DesktopTerminalLedger(lease, binding), socket = new Socket(); socket.on('error', () => {});
  const frames: any[] = [], unknown = vi.fn(), ended = vi.fn(); let current = true;
  const bytes = new DesktopTerminalBytes({ binding, ledger, socket, lastInputSequence: 0, current: () => current, emit: frame => { frames.push(frame); }, onUnknown: unknown, onStreamClosed: ended });
  const input = (text: string, sequence = 1) => ({ ...binding, inputId: randomUUID(), sequence, bytes: Buffer.from(text).toString('base64') });
  return { root, lease, binding, ledger, socket, frames, bytes, input, unknown, ended, invalidate: () => { current = false; },
    cleanup: async () => { bytes.close(); ledger.close(); lease.close(); await rm(root, { recursive: true, force: true }); } };
}
it('applies a bounded output window with cumulative acknowledgements, ordered bytes and no progress-message substitution', async () => {
  const f = await fixture();
  try {
    f.bytes.startOutput(); const chunks = Array.from({ length: 5 }, (_, index) => Buffer.alloc(65536, index + 1));
    for (const chunk of chunks) f.socket.push(chunk);
    await vi.waitFor(() => expect(f.frames).toHaveLength(16)); expect(f.socket.isPaused()).toBe(true);
    expect(f.frames.every(frame => Buffer.from(frame.bytes, 'base64').length <= 16384 && JSON.stringify(frame).length < 256 * 1024)).toBe(true);
    expect(() => f.bytes.acknowledge({ ...f.binding, generation: randomUUID(), throughSequence: 16 })).toThrow('ACK_INVALID');
    expect(() => f.bytes.acknowledge({ ...f.binding, throughSequence: 17 })).toThrow('ACK_INVALID');
    f.bytes.acknowledge({ ...f.binding, throughSequence: 16 }); await vi.waitFor(() => expect(f.frames).toHaveLength(20));
    f.bytes.acknowledge({ ...f.binding, throughSequence: 8 }); expect(f.frames).toHaveLength(20);
    expect(Buffer.concat(f.frames.map(frame => Buffer.from(frame.bytes, 'base64')))).toEqual(Buffer.concat(chunks));
    expect(f.frames.map(frame => frame.sequence)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    f.bytes.acknowledge({ ...f.binding, throughSequence: 20 }); f.socket.push(null);
    await vi.waitFor(() => expect(f.ended).toHaveBeenCalledOnce()); expect(f.unknown).not.toHaveBeenCalled();
  } finally { await f.cleanup(); }
});
it('records before writing, acknowledges dispatch only and returns a stable duplicate receipt without writing again', async () => {
  const f = await fixture();
  try {
    const input = f.input('terminal-secret-body-fixture');
    expect(await f.bytes.input(input, new AbortController().signal)).toMatchObject({ dispatch: 'accepted', sequence: 1 });
    expect(await f.bytes.input(input, new AbortController().signal)).toMatchObject({ dispatch: 'accepted' }); expect(f.socket.writes).toHaveLength(1);
    await expect(f.bytes.input({ ...input, bytes: Buffer.from('changed').toString('base64') }, new AbortController().signal)).rejects.toThrow('IDENTITY_MISMATCH');
    await expect(f.bytes.input(f.input('new id, old sequence'), new AbortController().signal)).rejects.toThrow('SEQUENCE_INVALID');
    expect(f.socket.writes).toHaveLength(1);
    expect((await readFile(join(f.root, 'terminal-inputs.db'))).includes(Buffer.from('terminal-secret-body-fixture'))).toBe(false);
  } finally { await f.cleanup(); }
});
it('keeps a lost dispatch acknowledgement pending/unknown and refuses replay even after reopening durable metadata', async () => {
  const f = await fixture();
  try {
    const input = f.input('once only'); vi.spyOn(f.ledger, 'finish').mockRejectedValue(new Error('fixture disk acknowledgement lost'));
    await expect(f.bytes.input(input, new AbortController().signal)).rejects.toThrow('acknowledgement lost');
    expect(f.socket.writes).toHaveLength(1); expect(f.unknown).toHaveBeenCalledOnce(); expect(f.socket.destroyed).toBe(true);
    f.bytes.close(); f.ledger.close();
    const ledger = new DesktopTerminalLedger(f.lease, f.binding), socket = new Socket(); socket.on('error', () => {});
    const recovered = new DesktopTerminalBytes({ binding: f.binding, ledger, socket, lastInputSequence: 0, current: () => true, emit: () => {}, onUnknown: () => {}, onStreamClosed: () => {} });
    try { expect(await recovered.input(input, new AbortController().signal)).toMatchObject({ dispatch: 'unknown' }); expect(socket.writes).toHaveLength(0); }
    finally { recovered.close(); ledger.close(); }
  } finally { await f.cleanup(); }
});
it('refuses late authority after durable record and never writes when recording fails', async () => {
  const f = await fixture();
  try {
    const input = f.input('not started'), record = f.ledger.record.bind(f.ledger);
    vi.spyOn(f.ledger, 'record').mockImplementationOnce(async (...args) => { await record(...args); f.invalidate(); });
    await expect(f.bytes.input(input, new AbortController().signal)).rejects.toThrow('AUTHORITY_INVALID');
    expect(f.socket.writes).toHaveLength(0); expect(await f.ledger.find(input.inputId)).toMatchObject({ dispatch: 'notStarted' });
    expect(f.unknown).toHaveBeenCalledOnce();
  } finally { await f.cleanup(); }
  const g = await fixture();
  try {
    vi.spyOn(g.ledger, 'record').mockRejectedValueOnce(new Error('fixture disk full'));
    await expect(g.bytes.input(g.input('no write'), new AbortController().signal)).rejects.toThrow('disk full'); expect(g.socket.writes).toHaveLength(0); expect(g.unknown).toHaveBeenCalledOnce();
  } finally { await g.cleanup(); }
});
it('marks an interrupted socket write unknown and fences old connection bytes and noncanonical base64', async () => {
  const f = await fixture();
  try {
    const input = f.input('partial input'), controller = new AbortController();
    await expect(f.bytes.input({ ...input, connectionInstanceId: randomUUID() }, controller.signal)).rejects.toThrow('IDENTITY_MISMATCH');
    await expect(f.bytes.input({ ...input, bytes: 'Zh==' }, controller.signal)).rejects.toThrow('IDENTITY_MISMATCH');
    f.socket.hold = true;
    const pending = f.bytes.input(input, controller.signal), rejected = expect(pending).rejects.toThrow('INPUT_UNKNOWN');
    await vi.waitFor(() => expect(f.socket.writes).toHaveLength(1)); controller.abort(); await rejected;
    expect(await f.ledger.find(input.inputId)).toMatchObject({ dispatch: 'unknown' }); expect(f.socket.destroyed).toBe(true);
  } finally { await f.cleanup(); }
});

it.skipIf(process.env.XOPC_CONTAINER_LIVE !== '1')('carries real Docker TTY output as ordered frames and suppresses repeated durable stdin dispatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-terminal-live-')), lease = new DesktopExecutionLease(root);
  const engine = await DesktopContainerEngine.connect(), imageId = await engine.resolveInstalledImage('node:26.12.1-bookworm-slim');
  const owner = { ownerId: randomUUID(), workspaceId: randomUUID(), operationId: randomUUID() }, volume = await engine.ensureWorkspace(owner.ownerId, owner.workspaceId);
  const id = await engine.create({ ...owner, imageId, argv: ['/bin/sh'], tty: true }), binding = { sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() };
  const ledger = new DesktopTerminalLedger(lease, binding); let stream: DesktopTerminalBytes | undefined;
  try {
    const socket = await engine.attachTerminal(id, owner), frames: any[] = [], unknown = vi.fn();
    stream = new DesktopTerminalBytes({ binding, socket, ledger, lastInputSequence: 0, current: () => true, emit: frame => { frames.push(frame); }, onUnknown: unknown, onStreamClosed: () => {} });
    await engine.start(id, owner); stream.startOutput();
    const input = { ...binding, inputId: randomUUID(), sequence: 1, bytes: Buffer.from("printf x >> /home/node/dispatch-count; printf 'LIVE_%s\\n' READY\r").toString('base64') };
    expect(await stream.input(input, AbortSignal.timeout(5000))).toMatchObject({ dispatch: 'accepted' });
    const output = () => Buffer.concat(frames.map(frame => Buffer.from(frame.bytes, 'base64'))).toString();
    await vi.waitFor(() => expect(output()).toContain('LIVE_READY'), { timeout: 5000 });
    expect(await stream.input(input, AbortSignal.timeout(5000))).toMatchObject({ dispatch: 'accepted' });
    const second = { ...binding, inputId: randomUUID(), sequence: 2, bytes: Buffer.from("printf 'COUNT_'; wc -c < /home/node/dispatch-count\r").toString('base64') };
    expect(await stream.input(second, AbortSignal.timeout(5000))).toMatchObject({ dispatch: 'accepted' });
    await vi.waitFor(() => expect(output()).toMatch(/COUNT_1\r?\n/), { timeout: 5000 });
    expect(frames.map(frame => frame.sequence)).toEqual(Array.from({ length: frames.length }, (_, index) => index + 1));
    stream.acknowledge({ ...binding, throughSequence: frames.at(-1).sequence }); expect(unknown).not.toHaveBeenCalled();
    stream.close(); expect(await engine.remove(id, owner)).toEqual({ confirmed: true });
  } finally {
    stream?.close(); expect(await engine.remove(id, owner)).toEqual({ confirmed: true }); ledger.close(); lease.close();
    execFileSync('docker', ['--host', `unix://${engine.socketPath}`, 'volume', 'rm', volume], { stdio: 'ignore' }); await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('keeps a committed pending input non-replayable after a real metadata-owner SIGKILL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xopc-terminal-crash-'));
  const binding = { sessionId: randomUUID(), generation: randomUUID(), connectionInstanceId: randomUUID() }, input = { ...binding, inputId: randomUUID(), sequence: 1, bytes: 'QQ==' };
  const url = (file: string) => JSON.stringify(pathToFileURL(join(process.cwd(), 'electron/desktop', file + '.ts')).href);
  const code = `import {DesktopExecutionLease} from ${url('operation-journal')};import {DesktopTerminalLedger} from ${url('terminal-input-ledger')};
    process.once('message',async message=>{try{const lease=new DesktopExecutionLease(message.root),ledger=new DesktopTerminalLedger(lease,message.binding);await ledger.record(message.inputId,message.fingerprint,1);process.send({ready:true});}catch(error){process.send({error:String(error)});process.exit(1);}});`;
  const child = spawn(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '--eval', code], { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: root }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let lease: DesktopExecutionLease | undefined, ledger: DesktopTerminalLedger | undefined, bytes: DesktopTerminalBytes | undefined, logs = '';
  child.stderr!.on('data', chunk => { logs = (logs + chunk.toString()).slice(-1000); });
  try {
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Pending input fixture timeout: ' + logs)), 10000);
      child.once('message', (value: any) => { clearTimeout(timer); value.ready ? resolve() : reject(new Error(JSON.stringify(value))); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Pending input owner exited: ' + logs)); }); child.once('error', reject);
    });
    child.send({ root, binding, inputId: input.inputId, fingerprint: createHash('sha256').update(canonicalJson(input)).digest('hex') });
    await ready; expect(() => new DesktopExecutionLease(root)).toThrow('ALREADY_OWNED');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    lease = new DesktopExecutionLease(root); ledger = new DesktopTerminalLedger(lease, binding);
    expect(await ledger.find(input.inputId)).toMatchObject({ dispatch: 'pending' });
    const socket = new Socket(); socket.on('error', () => {}); const unknown = vi.fn();
    bytes = new DesktopTerminalBytes({ binding, ledger, socket, lastInputSequence: 0, current: () => true, emit: () => {}, onUnknown: unknown, onStreamClosed: () => {} });
    expect(await bytes.input(input, new AbortController().signal)).toMatchObject({ dispatch: 'unknown' }); expect(socket.writes).toHaveLength(0); expect(unknown).toHaveBeenCalledOnce();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
    bytes?.close(); ledger?.close(); lease?.close(); await rm(root, { recursive: true, force: true });
  }
}, 15000);
