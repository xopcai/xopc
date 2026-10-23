import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { freezeMemoryConfig } from './config-snapshot.mjs';
const { values } = parseArgs({ options: { a: { type: 'string' }, b: { type: 'string' }, episodes: { type: 'string' },
  fixtures: { type: 'string' }, out: { type: 'string' } } });
for (const key of ['a','b','episodes','fixtures','out'] as const) if (!values[key]) throw new Error(`Missing --${key}`);
const a = resolve(values.a!), b = resolve(values.b!), out = resolve(values.out!), episodes = resolve(values.episodes!), fixtures = resolve(values.fixtures!);
if (existsSync(out)) throw new Error('Refusing to overwrite stage results');
mkdirSync(out, { recursive: true });
const save = (name: string, data: unknown) => writeFileSync(join(out, name), JSON.stringify(data, null, 2)+'\n');
const hashFile = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
if (hashFile(join(a,'pnpm-lock.yaml')) !== hashFile(join(b,'pnpm-lock.yaml'))) throw new Error('A/B lockfiles differ');
const protocolFiles = readdirSync(join(a,'evals/personal/memory')).filter(file => /\.(mts|py)$/.test(file));
for (const file of protocolFiles) if (hashFile(join(a,'evals/personal/memory',file)) !== hashFile(join(b,'evals/personal/memory',file))) throw new Error(`A/B evaluator differs: ${file}`);
const frozen = freezeMemoryConfig();
const poolPath = join(out, 'pools');
const pool = spawn('python3', [join(a,'evals/personal/style/request_pools.py'), '--out', poolPath], { stdio: ['ignore','ignore','inherit'] });
const endpoint = join(poolPath,'endpoint.json');
const statuses: Record<string, unknown> = {};
const manifest = { version: 2, orchestratorHash: hashFile(new URL(import.meta.url).pathname),
  createdAt: new Date().toISOString(), a, b,
  lockHash: hashFile(join(a,'pnpm-lock.yaml')), configSnapshotHash: frozen.hash,
  selectionHash: hashFile(join(fixtures,'selection.json')),
  episodeSelections: Object.fromEntries(['development','validation'].map(split => [split, hashFile(join(episodes,split,'selection.json'))])),
  protocolHashes: Object.fromEntries(protocolFiles.map(file => [file, hashFile(join(a,'evals/personal/memory',file))])),
  models: { candidate: 'xopc-cloud/openai-codex/gpt-5.6-sol', judge: 'xopc-cloud/openai-codex/gpt-6.1-sol' },
  pools: { generation: 4, judge: 4, sharedAcrossVariants: true, physicalRequests: true },
  predeclaredGate: 'B development and validation: every world/all 4 checkpoint gates and QA correct, no capture/judge protocol errors, source unchanged. A may fail quality but not protocol. Validation failure stops full184; analyzed validation becomes development.',
  stages: ['development A/B', 'candidate frozen', 'independent validation B', 'full184 A/B only after validation pass', 'native grading same saved answers'],
  repetitions: 1, resultsNeverRegeneratedForScore: true };
save('manifest.json',manifest);
const run = (cwd: string, args: string[], key: string) => new Promise<number>((done,reject) => {
  const child = spawn(process.execPath,['--import','tsx',...args], { cwd, env: { ...process.env,
    XOPC_MEMORY_CONFIG_SNAPSHOT: frozen.path, XOPC_MEMORY_CONFIG_HASH: frozen.hash }, stdio: ['ignore','pipe','pipe'] });
  child.stdout.on('data', data => process.stdout.write(`[${key}] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[${key}] ${data}`));
  child.once('error',reject); child.once('exit',code => { statuses[key] = code; save('status.json',statuses); done(code ?? -1); });
});
const capture = (cwd: string, fixture: string, label: string, key: string) => run(cwd,
  ['evals/personal/memory/run.mts','--fixtures',fixture,'--out',join(out,key),'--config-snapshot',frozen.path,'--endpoint',endpoint,'--label',label,
    '--model',manifest.models.candidate,'--judge',manifest.models.judge],key);
const accepted = (key: string) => {
  const summary = JSON.parse(readFileSync(join(out,key,'summary.json'),'utf8'));
  const completion = JSON.parse(readFileSync(join(out,key,'completion.json'),'utf8'));
  return summary.completed === 8 && !completion.sourceChanged && !completion.errors
    && summary.results.every((row: any) => row.episode?.passed && row.judgment?.correct && !row.error);
};
try {
  while (!existsSync(endpoint)) { if (pool.exitCode !== null) throw new Error('Pool failed'); await new Promise(r => setTimeout(r,100)); }
  const dev = await Promise.all([capture(a,join(episodes,'development'),'A','development-A'), capture(b,join(episodes,'development'),'B','development-B')]);
  if (dev.some(code => code !== 0) || !accepted('development-B')) {
    save('gate.json',{ stage: 'development', passed: false, full184Started: false, validationOpened: false });
    process.exitCode = 2;
  } else {
    save('candidate-freeze.json',{ at: new Date().toISOString(), manifest: JSON.parse(readFileSync(join(out,'development-B/manifest.json'),'utf8')),
      note: 'No product or evaluator edits after this point; validation is not used to select candidate.' });
    const valid = await capture(b,join(episodes,'validation'),'B','validation-B');
    if (valid !== 0 || !accepted('validation-B')) {
      save('gate.json',{stage:'validation',passed:false,full184Started:false,validationOpened:true}); process.exitCode=2;
    } else {
      save('gate.json',{stage:'validation',passed:true,full184Started:true,validationOpened:true});
      const fullCodes = await Promise.all([capture(a,fixtures,'A','full184-A'),capture(b,fixtures,'B','full184-B')]);
      if (fullCodes.some(code => code !== 0)) process.exitCode = 1;
      const nativeCodes = await Promise.all([['A',a],['B',b]].map(([label,cwd]) => run(cwd,['evals/personal/memory/grade-native.mts',
        '--run',join(out,`full184-${label}`),'--fixtures',fixtures,'--out',join(out,`native-${label}`),'--endpoint',endpoint],`native-${label}`)));
      if (nativeCodes.some(code => code !== 0)) process.exitCode = 1;
    }
  }
} finally {
  if (existsSync(endpoint)) {
    const auth = JSON.parse(readFileSync(endpoint,'utf8'));
    const response = await fetch(auth.url+'/status',{method:'POST',headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},body:'{}'});
    save('pool-status.json',await response.json());
  }
  pool.kill('SIGINT'); frozen.close(); save('finished.json',{at:new Date().toISOString(),statuses,exitCode:process.exitCode??0});
}
