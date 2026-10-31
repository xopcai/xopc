import { ShellUpstream, type RemoteTarget } from './upstream.js';
import { startShell } from './server.js';

const parent = process.parentPort;
const send = (value: unknown) => parent ? parent.postMessage(value) : process.send?.(value);
let upstream: ShellUpstream | undefined;
let shell: Awaited<ReturnType<typeof startShell>> | undefined;
let identity: { gatewayId: string; publicKey: string } | undefined;
let initialized = false, activated = false, closed = false;
let queue = Promise.resolve();

async function handle(message: { id: number; command: string; target?: RemoteTarget; assets?: string; epoch?: number }) {
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
    else if (message.command === 'stop') {
      closed = true; await shell?.close(); upstream?.close(); send({ id: message.id, ok: true }); process.exit(0);
    } else throw new Error('SHELL_COMMAND_DENIED');
    send({ id: message.id, ok: true, value });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'SHELL_FAILED';
    send({ id: message.id, ok: false, error: code });
  }
}
const receive = (message: Parameters<typeof handle>[0]) => { queue = queue.then(() => handle(message)); };
if (parent) parent.on('message', event => receive(event.data));
else process.on('message', receive);
process.on('disconnect', () => process.exit(0));
