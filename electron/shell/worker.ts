import { ShellUpstream, type RemoteTarget } from './upstream.js';
import { startShell } from './server.js';
import { RemoteFileUpstream } from '../files/remote-transport.js';

const parent = process.parentPort;
const send = (value: unknown) => parent ? parent.postMessage(value) : process.send?.(value);
let upstream: ShellUpstream | undefined;
let shell: Awaited<ReturnType<typeof startShell>> | undefined;
let identity: { gatewayId: string; publicKey: string } | undefined;
let initialized = false, activated = false, closed = false;
let queue = Promise.resolve();
const revokedFileSessions = new Set<string>();
let fileSessionsDisabled = false;
let activeFileRequest: { session: string; abort: AbortController } | undefined;

async function handle(message: { id: number; command: string; renewalId?: string; target?: RemoteTarget; assets?: string; epoch?: number; hostOrigin?: unknown;
  fileId?: string; text?: string; revision?: string; conversationId?: unknown; directoryId?: unknown; fileSession?: string }) {
  try {
    if (closed) throw new Error('SHELL_CLOSED');
    let value: unknown;
    if (message.command === 'authenticate' && !initialized && message.target) {
      initialized = true;
      upstream = new ShellUpstream(message.target);
      identity = await upstream.authenticate(); value = identity;
    } else if (message.command === 'activate' && identity && upstream && !activated && message.assets && Number.isSafeInteger(message.epoch)) {
      activated = true;
      shell = await startShell(upstream, message.assets, message.epoch!, identity.gatewayId);
      value = { origin: shell.origin, proof: shell.proof, epoch: shell.epoch };
    } else if (message.command === 'bootstrap' && shell) value = shell.bootstrap();
    else if (message.command === 'renew' && shell) value = await shell.renew();
    else if (message.command === 'commit-renewal' && shell) value = shell.commitRenewal(message.renewalId);
    else if (message.command === 'host-origin' && shell) value = shell.setHostOrigin(message.epoch, message.hostOrigin);
    else if (message.command.startsWith('files-') && shell && upstream && message.epoch === shell.epoch) {
      if (fileSessionsDisabled || !message.fileSession || !/^[a-f0-9-]{36}$/.test(message.fileSession) || revokedFileSessions.has(message.fileSession)) throw new Error('REMOTE_FILE_SESSION_REVOKED');
      const abort = new AbortController(); activeFileRequest = { session: message.fileSession, abort };
      const files = new RemoteFileUpstream(upstream), signal = AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]);
      try {
      if (message.command === 'files-browse') value = await files.browse(message.conversationId, signal, message.directoryId);
      else if (message.command === 'files-read' && typeof message.fileId === 'string') value = await files.read(message.fileId, signal);
      else if (message.command === 'files-put' && typeof message.fileId === 'string' && typeof message.text === 'string' && typeof message.revision === 'string') value = await files.put(message.fileId, message.text, message.revision, signal);
      else throw new Error('SHELL_COMMAND_DENIED');
      } finally { if (activeFileRequest?.abort === abort) activeFileRequest = undefined; }
    }
    else if (message.command === 'stop') {
      closed = true; await shell?.close(); upstream?.close(); send({ id: message.id, ok: true }); process.exit(0);
    } else throw new Error('SHELL_COMMAND_DENIED');
    send({ id: message.id, ok: true, value });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SHELL_FAILED';
    send({ id: message.id, ok: false, error: code });
  }
}
const receive = (message: Parameters<typeof handle>[0]) => {
  // Cancellation bypasses the network work queue, including file requests not dispatched yet.
  if (message.command === 'files-cancel' && typeof message.fileSession === 'string' && /^[a-f0-9-]{36}$/.test(message.fileSession)) {
    if (revokedFileSessions.size >= 128) fileSessionsDisabled = true;
    else revokedFileSessions.add(message.fileSession);
    if (activeFileRequest?.session === message.fileSession) activeFileRequest.abort.abort();
    send({ id: message.id, ok: true }); return;
  }
  queue = queue.then(() => handle(message));
};
if (parent) parent.on('message', event => receive(event.data));
else process.on('message', receive);
process.on('disconnect', () => process.exit(0));
