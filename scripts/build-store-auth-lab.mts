import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import AdmZip from 'adm-zip';
const dir = resolve(process.argv[2] || '/tmp/xopc-store-auth-lab-artifacts');
await mkdir(dir, { recursive: true });
const code = await readFile('scripts/fixtures/store-plugin-lab/auth-lab-tool.mjs');
const sha256 = createHash('sha256').update(code).digest('hex'), file = `${sha256}.bin`;
await writeFile(join(dir, file), code);
const command = (args: string[]) => ({ command: 'node', args: ['${PLUGIN_RESOURCES}/auth-program', ...args] });
const cli = (id: string, title: string, kind: 'cli' | 'qr') => ({ id, title, type: 'cli', instructions: [kind === 'qr' ? 'Scan the QR code, or open its authorization page, and approve the synthetic account.' : 'Open the CLI sign-in page and approve the synthetic account.'], login: command(['login', kind]), check: command(['check']), timeoutSeconds: 180 });
const name = 'xopc-plugin-auth-lab', version = '1.0.0';
const manifest = { name, version, description: 'TEST ONLY: token, client key/secret, CLI and QR authorization with skip and reconnect.',
  userConfig: Object.fromEntries([['accessToken', 'Access Token'], ['clientKey', 'Client Key'], ['clientSecret', 'Client Secret']].map(([key, title]) => [key, { type: 'string', title, required: true, sensitive: key !== 'clientKey', default: '' }])),
  extensions: { 'ai.xopc': { setup: { version: 1, resources: [{ id: 'auth-program', url: `https://store.xopc.ai/files/assets/plugin-resources/${file}`, sha256 }], authorizations: [
    { id: 'token', title: 'Sandbox Token', servers: ['token'], methods: [{ id: 'token', title: 'Access Token', type: 'form', fields: ['accessToken'], instructions: ['Test only. Enter lab-token; do not enter a real account token.'] }] },
    { id: 'client', title: 'Sandbox App', servers: ['client'], methods: [{ id: 'manual', title: 'Client Key / Secret', type: 'form', fields: ['clientKey', 'clientSecret'], instructions: ['Test only. Client Key: lab-client. Client Secret: lab-secret.'] }, cli('qr', 'Scan QR code', 'qr')] },
    { id: 'cli', title: 'Sandbox CLI', servers: ['cli'], methods: [cli('login', 'CLI sign-in', 'cli')] },
    { id: 'qr', title: 'Sandbox QR', servers: ['qr'], methods: [cli('scan', 'Scan QR code', 'qr')] },
  ] } } },
};
const mcpServers = Object.fromEntries(['token', 'client', 'cli', 'qr'].map(kind => [kind, { ...command(['serve', kind]), env: { LAB_ACCOUNT_HOME: '${PLUGIN_ACCOUNTS}/' + kind, ...(kind === 'token' ? { LAB_TOKEN: '${user_config.accessToken}' } : kind === 'client' ? { LAB_CLIENT: '${user_config.clientKey}', LAB_SECRET: '${user_config.clientSecret}' } : {}) } }]));
const zip = new AdmZip(); zip.addFile('.codex-plugin/plugin.json', Buffer.from(JSON.stringify(manifest, null, 2))); zip.addFile('.mcp.json', Buffer.from(JSON.stringify({ mcpServers }, null, 2)));
zip.addFile('README.md', Buffer.from('# Authorization Lab\n\nSynthetic test-only Store plugin. Skip all authorization, return to details, then exercise Token (lab-token), Client Key/Secret (lab-client/lab-secret), CLI browser login and QR login. All programs are stored on the Store.\n'));
const bytes = zip.toBuffer(), archive = `${name}-${version}.zip`; await writeFile(join(dir, archive), bytes);
await writeFile(join(dir, 'release.json'), JSON.stringify({ resources: [{ sha256, file }], packages: [{ name, version, type: 'plugin', file: archive, sha256: createHash('sha256').update(bytes).digest('hex') }] }, null, 2));
console.log(JSON.stringify({ dir, name, version }));
