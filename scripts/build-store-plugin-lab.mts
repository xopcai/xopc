import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
const dir = resolve(process.argv[2] || '/tmp/xopc-store-plugin-lab-artifacts');
const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/store-plugin-lab');
const store = (process.env.XOPC_EXTENSIONS_STORE_URL || 'https://store.xopc.ai').replace(/\/$/, '');
await mkdir(dir, { recursive: true });
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const code = await readFile(join(fixture, 'local-tool.mjs'));
const resources: Array<{ sha256: string; file: string }> = [];
async function resource(value: Buffer) {
  const sha256 = digest(value), file = `${sha256}.bin`;
  await writeFile(join(dir, file), value); resources.push({ sha256, file });
  return { url: `${store}/files/assets/plugin-resources/${file}`, sha256 };
}
const program = await resource(code);
const packages: Array<{ name: string; version: string; type: string; file: string; sha256: string }> = [];
for (const dialect of ['codex', 'claude']) {
  const name = `xopc-plugin-lab-${dialect}`;
  for (const version of ['1.0.0', '1.1.0-e2e-invalid', '1.1.0']) {
    const data = await resource(Buffer.from(JSON.stringify({ id: 'local-note-001', title: 'Store local dataset verified', version, synthetic: true })));
    const manifest = { name, version, description: 'TEST ONLY: verify Store installation, local configuration, OAuth and Agent tools using synthetic data.',
      userConfig: { accessKey: { type: 'string', title: 'Sandbox access key (any test value)', required: true, sensitive: true } },
      interface: { defaultPrompt: ['Read the Plugin Lab sandbox note and local dataset.'] },
      extensions: { 'ai.xopc': { setup: { version: 1, resources: [ { id: 'program', ...program }, { id: 'dataset', ...data, ...(version.includes('invalid') ? { sha256: '0'.repeat(64) } : {}) } ] } } },
    };
    const mcp = { mcpServers: { notes: { type: 'http', url: `${store}/plugin-lab/mcp` }, local: { command: 'node', args: ['${PLUGIN_RESOURCES}/program'], env: { LAB_ACCESS_KEY: '${user_config.accessKey}', LAB_DATASET: '${PLUGIN_RESOURCES}/dataset' } } } };
    const zip = new AdmZip();
    zip.addFile(`.${dialect}-plugin/plugin.json`, Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile('.mcp.json', Buffer.from(JSON.stringify(mcp, null, 2)));
    zip.addFile('skills/lab/SKILL.md', Buffer.from('---\nname: lab\ndescription: Verify Store-supplied sandbox notes and a local dataset.\n---\nUse the installed notes and local tools to read synthetic sandbox records. Report identifiers and versions. Never ask for real account secrets for this test.'));
    zip.addFile('README.md', Buffer.from('# XOPC Plugin Lab\n\nTest-only package. All records are synthetic. Install, prepare resources, enter any test access key, authorize the sandbox account, bind an Agent, then read both records. This does not log into Google, Gmail or other third-party accounts.\n'));
    const file = `${name}-${version}.zip`, bytes = zip.toBuffer(); await writeFile(join(dir, file), bytes);
    packages.push({ name, version, type: 'plugin', file, sha256: digest(bytes) });
  }
}
// Exercise the existing native Extension path alongside Agent Plugins.
const nativeName = 'xopc-extension-lab';
const native = new AdmZip();
native.addFile('xopc.extension.json', Buffer.from(JSON.stringify({ id: nativeName, name: 'XOPC Extension Lab (test only)', version: '1.0.1', description: 'Synthetic Store native Extension verification.', kind: 'utility', engines: { xopc: '>=0.0.1 <1.0.0', extensionApi: '^1.0.0' }, main: 'index.js', contracts: { tools: ['plugin_lab_status'] } })));
native.addFile('index.js', Buffer.from(`export default function(api) { api.registerTool({name:'plugin_lab_status',description:'Read synthetic Extension Lab status',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'extension-store-verified'}],details:{synthetic:true}}}}); }`));
native.addFile('package.json', Buffer.from(JSON.stringify({ name: nativeName, version: '1.0.1', type: 'module' })));
native.addFile('README.md', Buffer.from('# Extension Lab\nA synthetic read-only tool used for Store E2E verification.'));
const bytes = native.toBuffer(); await writeFile(join(dir, `${nativeName}-1.0.1.zip`), bytes);
packages.push({ name: nativeName, version: '1.0.1', type: 'extension', file: `${nativeName}-1.0.1.zip`, sha256: digest(bytes) });
await writeFile(join(dir, 'release.json'), JSON.stringify({ resources: [...new Map(resources.map(r => [r.sha256, r])).values()], packages }, null, 2));
console.log(JSON.stringify({ dir, resources: new Set(resources.map(r => r.sha256)).size, packages: packages.length }));
