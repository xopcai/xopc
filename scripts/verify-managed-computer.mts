/** Synthetic live test using the operator's existing, refreshable platform login. */
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { getApiKey } from '../src/providers/index.js';
import { ComputerModelAdapter, GUI_PLUS_SYSTEM_PROMPT, predictComputerStep } from '../src/computer/model-adapter.js';

const token = await getApiKey('xopc-cloud');
if (!token) throw new Error('Sign into xopc Cloud before verification');
const image = await sharp(Buffer.from('<svg width="800" height="600"><rect width="800" height="600" fill="white"/><rect x="300" y="250" width="200" height="80" rx="10" fill="#1769e0"/><text x="400" y="302" text-anchor="middle" font-size="28" fill="white">Continue</text></svg>')).png({ compressionLevel: process.argv.includes('--large-frame') ? 0 : 9 }).toBuffer();
if (process.argv.includes('--provision-preview')) {
  const helper = process.env.XOPC_COMPUTER_PROVISION_BUNDLE;
  if (!helper || !process.env.XOPC_SERVER || !process.env.DASHSCOPE_API_KEY) throw new Error('Provisioning prerequisites unavailable');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  const remote = '/var/www/xopc-platform-releases/d61a802/apps/model-gateway';
  execFileSync('rsync', ['-az', helper, `${process.env.XOPC_SERVER}:${remote}/computer-provision.mjs`]);
  const result = execFileSync('ssh', ['-o', 'BatchMode=yes', process.env.XOPC_SERVER,
    `export PATH=/root/.nvm/versions/node/v24.14.1/bin:$PATH; cd ${remote} && node computer-provision.mjs`], {
    input: JSON.stringify({ apiKey: process.env.DASHSCOPE_API_KEY, userId: claims.sub, image: `data:image/png;base64,${image.toString('base64')}`, system: GUI_PLUS_SYSTEM_PROMPT }),
    encoding: 'utf8', timeout: 100_000, maxBuffer: 128_000,
  });
  console.log(result.trim());
}
const baseUrl = 'https://router.xopc.ai/v1';
const modelId = 'computer-gui-plus-preview';
let deployment: { revision: string; origin: string } | undefined;
for (let i = 0; i < 12; i++) {
  const response = await fetch(`${baseUrl}/models`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Platform catalog HTTP ${response.status}`);
  const catalog = await response.json() as any;
  deployment = catalog.data?.find((m: any) => m.id === modelId)?.xopc?.computerDeployment;
  if (deployment) break;
  await new Promise(r => setTimeout(r, 5_000));
}
if (!deployment || deployment.origin !== 'https://dashscope.aliyuncs.com') throw new Error('Pinned Alibaba deployment unavailable');
const unpinned = await fetch(`${baseUrl}/chat/completions`, { method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: modelId, messages: [{ role: 'user', content: 'Synthetic unpinned rejection test' }], max_tokens: 1 }),
  signal: AbortSignal.timeout(15_000) });
if (unpinned.status !== 409) throw new Error(`Expected deployment-pin rejection, got ${unpinned.status}`);
await unpinned.body?.cancel();
const adapter = new ComputerModelAdapter({ modelId, baseUrl, apiKey: token,
  profile: 'gui-plus-2026-02-26', deploymentRevision: deployment.revision });
try {
  let modelRequests = 0;
  const observation = await predictComputerStep(adapter, { image, mimeType: 'image/png', width: 800, height: 600,
    goal: 'Read the label on the blue button. Do not click or suggest an action.', summary: 'Synthetic test only.', readOnly: true }, () => { modelRequests++; });
  if (observation.kind !== 'answer' || !/continue/i.test(observation.text)) throw new Error('Managed visual observation assertion failed');
  const proposal = await predictComputerStep(adapter, { image, mimeType: 'image/png', width: 800, height: 600,
    goal: 'Click the blue Continue button once.', summary: 'Synthetic test only.' }, () => { modelRequests++; });
  if (proposal.kind !== 'action' || proposal.action.kind !== 'click'
    || proposal.action.point.x < 300 || proposal.action.point.x >= 500
    || proposal.action.point.y < 250 || proposal.action.point.y >= 330) throw new Error('Managed grounding assertion failed');
  console.log(JSON.stringify({ status: 'passed', route: `xopc-cloud/${modelId}`, hostedModel: 'gui-plus-2026-02-26', fixture: 'synthetic-button', modelRequests,
    imageBytes: image.length, visualObservation: 'passed', unpinnedRequest: 'rejected-409', screenshotOfPersonalDesktop: false }));
} finally { image.fill(0); }
