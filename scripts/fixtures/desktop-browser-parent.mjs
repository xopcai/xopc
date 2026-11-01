import { spawn } from 'node:child_process';

// Synthetic acceptance parent only. No Gateway, database, credentials or user workspace.
const [executable, entry, directory, generation] = process.argv.slice(2);
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].flatMap(key => process.env[key] ? [[key, process.env[key]]] : []));
Object.assign(env, { XOPC_PRIVATE_BROWSER_GENERATION: generation, XOPC_PRIVATE_BROWSER_PARENT: String(process.pid), XOPC_PRIVATE_BROWSER_USER_DATA: directory });
env.XOPC_PRIVATE_BROWSER_EXPIRES_AT = String(Date.now() + 120000);
const child = spawn(executable, [entry, '--xopc-private-browser-worker'], { env, detached: true, serialization: 'json', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let diagnostic = '';
child.stderr.on('data', chunk => { if (diagnostic.length < 4000) { const text = chunk.toString().slice(0, 4000 - diagnostic.length); diagnostic += text; process.send?.({ event: 'diagnostic', text }); } });
child.on('message', message => process.send?.(message));
child.once('error', () => process.send?.({ error: 'child-error' }));
child.once('exit', (code, signal) => { process.send?.({ event: 'child-exit', code, signal, diagnostic }, () => process.exit(0)); });
process.on('message', message => child.send(message));
process.send?.({ event: 'spawned', workerPid: child.pid });
