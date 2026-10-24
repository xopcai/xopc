/** Live Cloud smoke test. Sends only a generated image and dispatches no native input. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { ConfigSchema } from '../src/config/schema.js';
import { getApiKey, getModelRegistry } from '../src/providers/index.js';
import { resolveXopcModelRouterUrl } from '../src/providers/xopc-cloud-config.js';
import { XopcCloudModelSource } from '../src/providers/xopc-cloud-model-source.js';
import { getModelCatalogStore } from '../src/providers/model-catalog-store.js';
import { createPhoneModel } from '../src/phone/model-adapter.js';
import { initializeTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { closeXopcDatabase } from '../src/storage/sqlite/index.js';
import { applyXopcCloudCapabilitySetup } from '../src/gateway/xopc-cloud-capability-setup.js';

const token = await getApiKey('xopc-cloud');
if (!token) throw Error('Sign into xopc Cloud before verification');
const frame = await sharp(Buffer.from('<svg width="800" height="600"><rect width="800" height="600" fill="white"/><rect x="300" y="250" width="200" height="80" fill="#1769e0"/><text x="400" y="302" text-anchor="middle" font-size="28" fill="white">Continue</text></svg>'))
  .png({ compressionLevel: process.argv.includes('--large-frame') ? 0 : 9 }).toBuffer();
try {
  if (process.argv.includes('--provision-preview')) {
    const bundle = process.env.XOPC_PHONE_PROVISION_BUNDLE;
    if (!bundle || !process.env.XOPC_SERVER) throw Error('Set XOPC_PHONE_PROVISION_BUNDLE and XOPC_SERVER');
    const userId = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()).sub;
    const remote = '/var/www/xopc-platform/apps/model-gateway/phone-provision.mjs';
    execFileSync('rsync', ['-az', bundle, `${process.env.XOPC_SERVER}:${remote}`]);
    const result = execFileSync('ssh', ['-o', 'BatchMode=yes', process.env.XOPC_SERVER,
      'export PATH=/root/.nvm/versions/node/v24.14.1/bin:$PATH; cd /var/www/xopc-platform/apps/model-gateway && node phone-provision.mjs'], {
      input: JSON.stringify({ userId, image: `data:image/png;base64,${frame.toString('base64')}` }), encoding: 'utf8', timeout: 90_000, maxBuffer: 32_000,
    });
    console.log(result.trim());
    execFileSync('ssh', ['-o', 'BatchMode=yes', process.env.XOPC_SERVER,
      'export PATH=/root/.nvm/versions/node/v24.14.1/bin:$PATH; pm2 restart xopc-model-gateway'], { stdio: 'ignore' });
  }
  let healthy = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    try { healthy = (await fetch(new URL('/health', resolveXopcModelRouterUrl()), { signal: AbortSignal.timeout(3000) })).ok; } catch {}
    if (healthy) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!healthy) throw Error('Cloud gateway health check failed');
  const catalog = await new XopcCloudModelSource().fetch();
  if (catalog.status !== 'fetched') throw Error('Cloud catalog unavailable');
  const phone = catalog.models.find(m => m.id === 'phone');
  assert.equal(phone?.phoneUse?.profile, 'autoglm-phone-v1');
  assert.equal(phone?.maxOutputTokens, 2048);
  const store = getModelCatalogStore();
  store.replaceSourceModels('xopc-cloud', catalog.source, catalog.models);
  getModelRegistry().refresh();

  // Exercise the actual login completion against a disposable in-memory catalog.
  const repository = initializeTestAgentCatalog();
  let config = ConfigSchema.parse({});
  const service = { get currentConfig() { return config; }, saveConfig: async (next: typeof config) => { config = next; return { saved: true }; } };
  assert.equal((await applyXopcCloudCapabilitySetup(service)).configured, true);
  assert.equal(repository.getSettings().defaults.models.phoneUse?.primary, 'xopc-cloud/phone');
  const first = repository.getSettings().defaults;
  repository.updateDefaults({ ...first, models: { ...first.models, phoneUse: { primary: 'custom/phone', fallbacks: [] } } }, repository.getSettings().revision);
  assert.equal((await applyXopcCloudCapabilitySetup(service)).configured, true);
  assert.equal(repository.getSettings().defaults.models.phoneUse?.primary, 'custom/phone');
  const adapter = await createPhoneModel('xopc-cloud/phone', config, 'main');
  const decision = await adapter.predict({ goal: 'Click the blue Continue button once.', allowedApps: [], history: [], observation: {
    frameId: 'synthetic', capturedAt: Date.now(), width: 800, height: 600, rotation: 0,
    package: 'synthetic.fixture', frame, elements: [],
  } }, AbortSignal.timeout(60_000));
  assert.equal(decision.kind, 'action');
  if (decision.kind !== 'action' || decision.action.type !== 'tap') throw Error('Expected synthetic tap');
  const [x, y] = decision.action.point;
  assert.ok(x >= 375 && x < 625 && y >= 416 && y < 550, 'Tap must be inside the synthetic button');
  console.log(JSON.stringify({ status: 'passed', publicModel: 'xopc-cloud/phone', profile: phone.phoneUse.profile,
    defaultAfterCloudConnect: true, independentModelPreserved: true, imageBytes: frame.length,
    syntheticButtonGrounding: true, nativeInputExecuted: false }));
} finally { frame.fill(0); closeXopcDatabase(); }
