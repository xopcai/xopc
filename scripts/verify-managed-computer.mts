/** Synthetic live test using the operator's existing, refreshable platform login. */
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { getApiKey } from '../src/providers/index.js';
import { ComputerModelAdapter, GUI_PLUS_SYSTEM_PROMPT, predictComputerStep } from '../src/computer/model-adapter.js';
import { computerDiagnostic } from '../src/computer/errors.js';

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
  profile: 'gui-plus-2026-02-26', deploymentRevision: deployment.revision }, async (url, init) => {
    const response = await fetch(url, init);
    if (process.argv.includes('--diagnostic') && response.ok) {
      const data = await response.clone().json() as any;
      console.log(JSON.stringify({ syntheticModelReply: String(data.choices?.[0]?.message?.content ?? '').slice(0, 2000) }));
    }
    return response;
  });
if (process.argv.includes('--action-matrix')) {
  const fixture = await sharp(Buffer.from(`<svg width="800" height="600"><rect width="800" height="600" fill="white"/>
    <rect x="300" y="30" width="200" height="60" fill="#1769e0"/><text x="400" y="68" text-anchor="middle" font-size="24" fill="white">Memories</text>
    <text x="250" y="220" font-size="22">Message</text><rect x="250" y="240" width="300" height="60" fill="#eee" stroke="#333"/>
    <rect x="100" y="350" width="600" height="200" fill="#fafafa" stroke="#999"/><text x="150" y="390" font-size="22">Scrollable list</text>
    <text x="150" y="430" font-size="18">Item 1</text><text x="150" y="470" font-size="18">Item 2</text>
    <rect x="680" y="360" width="8" height="50" fill="#aaa"/></svg>`)).png().toBuffer();
  const inButton = (a: any) => a.point?.x >= 300 && a.point.x < 500 && a.point.y >= 30 && a.point.y < 90;
  const selectedCase = process.argv.find(arg => arg.startsWith('--case='))?.slice(7);
  const cases = [
    { name: 'navigation', goal: '点击顶部导航栏中的 Memories 标签，进入 Memories 页面。', check: (a: any) => a.kind === 'click' && a.count === 1 && a.button === 'left' && inButton(a) },
    { name: 'double-click', goal: 'Double-click the Memories label.', check: (a: any) => a.kind === 'click' && a.count === 2 && inButton(a) },
    { name: 'right-click', goal: 'Right-click the Memories label once.', check: (a: any) => a.kind === 'click' && a.button === 'right' && inButton(a) },
    { name: 'type', goal: 'Type hello in the Message text field; do not submit.', check: (a: any) => a.kind === 'typeText' && a.text === 'hello' && a.point?.x >= 250 && a.point.x < 550 && a.point.y >= 240 && a.point.y < 300 },
    { name: 'key', goal: 'Press the Return key once in the current window.', check: (a: any) => a.kind === 'pressKeys' && a.keys.length === 1 && /^(return|enter)$/i.test(a.keys[0]) },
    { name: 'scroll', goal: 'Scroll down within the Scrollable list panel.', check: (a: any) => a.kind === 'scroll' && a.deltaY > 0 && a.deltaX === 0 && a.point.x >= 100 && a.point.x < 700 && a.point.y >= 350 && a.point.y < 550 },
    { name: 'wait', goal: 'Wait for one second before taking any further action.', check: (a: any) => a.kind === 'wait' && a.durationMs === 1000 },
  ].filter(test => !selectedCase || test.name === selectedCase);
  if (!cases.length) throw new Error('Unknown synthetic action case');
  let failures = 0;
  try {
    for (const test of cases) {
      let requests = 0;
      try {
        const proposal = await predictComputerStep(adapter, { image: fixture, mimeType: 'image/png', width: 800, height: 600,
          goal: test.goal, summary: 'Synthetic fixture. Message is an editable text field. Only predict the requested action; no native input will be executed.' }, () => { requests++; });
        const passed = proposal.kind === 'action' && test.check(proposal.action);
        if (!passed) failures++;
        console.log(JSON.stringify({ case: test.name, passed, requests, proposalKind: proposal.kind, actionKind: proposal.kind === 'action' ? proposal.action.kind : undefined }));
      } catch (error) {
        const diagnostic = computerDiagnostic(error);
        failures++; console.log(JSON.stringify({ case: test.name, passed: false, requests, diagnostic }));
        if (diagnostic?.httpStatus === 429) {
          const skipped = cases.slice(cases.indexOf(test) + 1).map(item => item.name);
          failures += skipped.length;
          console.log(JSON.stringify({ skipped, reason: 'rate_limited' })); break;
        }
      }
    }
  } finally { fixture.fill(0); image.fill(0); }
  console.log(JSON.stringify({ status: failures ? 'failed' : 'passed', cases: cases.length, failures, nativeInputExecuted: false, personalScreenshots: false }));
  process.exitCode = failures ? 1 : 0;
} else {
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
}
