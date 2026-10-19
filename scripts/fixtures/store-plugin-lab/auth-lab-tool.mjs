import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
const [mode, kind = 'cli', issuer = 'https://store.xopc.ai/plugin-auth-lab'] = process.argv.slice(2);
const home = process.env.LAB_ACCOUNT_HOME || process.env.PLUGIN_ACCOUNT_HOME;
const file = home ? join(home, 'account.json') : '';
async function saved() { try { return JSON.parse(await readFile(file, 'utf8')).expiresAt > Date.now(); } catch { return false; } }
if (mode === 'check') {
  console.log(JSON.stringify({ authenticated: await saved() }));
} else if (mode === 'login') {
  const response = await fetch(`${issuer}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind }) });
  if (!response.ok) throw new Error('Synthetic login unavailable');
  const attempt = await response.json();
  console.log(JSON.stringify({ type: 'challenge', kind: kind === 'qr' ? 'qr' : 'url', url: attempt.challengeUrl }));
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 750));
    const status = await fetch(attempt.pollUrl, { headers: { Authorization: `Bearer ${attempt.pollToken}` } });
    if (!status.ok) throw new Error('Synthetic login expired');
    const result = await status.json();
    if (result.approved) { await mkdir(home, { recursive: true, mode: 0o700 }); await writeFile(file, JSON.stringify({ synthetic: true, expiresAt: Date.now() + 86400000 }), { mode: 0o600 }); break; }
  }
} else if (mode === 'serve') {
  const authorized = kind === 'token' ? process.env.LAB_TOKEN === 'lab-token' : kind === 'client' ? process.env.LAB_CLIENT === 'lab-client' && process.env.LAB_SECRET === 'lab-secret' || await saved() : await saved();
  if (!authorized) process.exit(2);
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    const request = JSON.parse(line); if (request.id === undefined) continue;
    let result;
    if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', serverInfo: { name: 'plugin-auth-lab', version: '1.0.0' }, capabilities: { tools: {} } };
    else if (request.method === 'tools/list') result = { tools: [{ name: 'read_authorized_record', description: 'Read synthetic authorized data.', inputSchema: { type: 'object', properties: {} } }] };
    else if (request.method === 'tools/call') result = { content: [{ type: 'text', text: JSON.stringify({ id: `auth-${kind}-verified`, synthetic: true }) }] };
    else result = {};
    console.log(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
  }
}
