import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { queueTiming } from './performance.js';
import { assessVerification } from './verification.js';
import { assessCycle } from './reconciliation.js';
import { runCampaign, validatePlan } from './campaign.js';
import { ControlStore, readSources } from './store.js';
import { record } from './types.js';
import { livePilotPlan } from './live-plan.js';
import { RequestPool, startPool, type PoolEndpoint } from './request-pool.js';

const [command, ...args] = process.argv.slice(2);
const { values } = parseArgs({ args, options: {
  index: { type: 'string', default: '.xopc-evals/control/index.db' }, sources: { type: 'string', default: 'evals/control/sources.json' },
  'validation-output': { type: 'string' },
  plan: { type: 'string' }, output: { type: 'string' }, file: { type: 'string' }, id: { type: 'string' }, action: { type: 'string' },
  model: { type: 'string' }, origins: { type: 'string' }, 'include-personal': { type: 'boolean', default: false },
  'pool-endpoint': { type: 'string' }, generation: { type: 'string', default: '4' }, judge: { type: 'string', default: '2' }, parent: { type: 'string', default: '4' },
  left: { type: 'string' }, right: { type: 'string' }, resume: { type: 'boolean', default: false },
} });
const store = new ControlStore(values.index!);
try {
  if (command === 'pool') {
    if (!values.output) throw new Error('Shared pool needs a fresh --output endpoint file');
    const pool = new RequestPool({ generation: Number(values.generation), judge: Number(values.judge) }, Number(values.parent), snapshot => store.event('request.shared-pool', snapshot));
    const endpoint = await startPool(pool);
    try { writeFileSync(values.output, JSON.stringify({ url: endpoint.url, token: endpoint.token }), { flag: 'wx', mode: 0o600 }); }
    catch (error) { endpoint.server.close(); throw error; }
    console.log('Shared pool running. Endpoint credentials written to the private output file; pass --pool-endpoint to every campaign sharing this quota.');
    await new Promise<void>(resolveClose => {
      const close = () => { pool.close(); endpoint.server.closeAllConnections(); endpoint.server.close(() => resolveClose()); };
      process.once('SIGINT', close); process.once('SIGTERM', close);
    });
  } else if (command === 'import') {
    const results = readSources(values.sources!).map(source => ({ path: source.path, ...store.import(source) }));
    console.log(JSON.stringify(results, null, 2));
    if (results.some(r => r.error)) process.exitCode = 1;
  } else if (command === 'supplement') {
    if (!values.id || !values.file) throw new Error('--id and --file required');
    store.supplementImprovement(values.id,resolve(values.file),record(JSON.parse(readFileSync(values.file,'utf8'))));
    console.log('Appended evidence supplement; the original decision is unchanged.');
  } else if (command === 'export') {
    if (!values.output) throw new Error('Fresh --output required');
    const evidence = [];
    for (let offset = 0;; offset += 100) { const page = store.list({offset,limit:100}); evidence.push(...page.items); if (offset + page.items.length >= page.total) break; }
    writeFileSync(resolve(values.output), JSON.stringify({ schemaVersion:1, exportedAt:new Date().toISOString(), scope:'metadata and normalized evidence only; no raw transcripts or credentials', overview:store.overview(), campaigns:store.campaigns(), improvements:store.improvements(), evidence }, null, 2) + '\n', {flag:'wx',mode:0o600});
    console.log('Exported metadata with source references; original evidence is unchanged.');
  } else if (command === 'list') console.log(JSON.stringify(store.overview(), null, 2));
  else if (command === 'compare') console.log(JSON.stringify(store.compare(values.left ?? '', values.right ?? ''), null, 2));
  else if (command === 'improvement') {
    if (!values.file) throw new Error('--file required');
    console.log(store.improvement(record(JSON.parse(readFileSync(values.file, 'utf8')))));
  } else if (['assess-cycle', 'assess-verification'].includes(command ?? '')) {
    if (!values.file || !values.output || !values.id) throw new Error('--file registration, --output campaign directory and --id improvement required');
    const result = command === 'assess-verification' ? assessVerification(resolve(values.output), resolve(values.file)) : assessCycle(resolve(values.output), resolve(values.file), values['validation-output'] ? resolve(values['validation-output']) : undefined);
    const directories = [resolve(values.output), ...(values['validation-output'] ? [resolve(values['validation-output'])] : [])];
    const evidence = store.list({limit:100}).items.filter(e => directories.some(d => e.source.startsWith(d + '/')));
    const targetCampaign = store.campaigns().find(c => c.output === resolve(values.output!));
    const poolEvents = targetCampaign ? store.db.prepare("SELECT at,data FROM events WHERE type='request.pool' AND json_extract(data,'$.campaignId')=? ORDER BY seq").all(String(targetCampaign.id)).map(e=>({at:e.at,data:JSON.parse(String(e.data))})) : [];
    const decision = { ...result, queueTiming:queueTiming(poolEvents), evidenceIds: evidence.map(e => e.id) };
    writeFileSync(resolve(values.output, command === 'assess-verification' ? 'verification.json' : 'decision.json'), JSON.stringify(decision, null, 2) + '\n', {flag:'wx'});
    store.decideImprovement(values.id, decision);
    for (const campaign of store.campaigns().filter(c => directories.includes(String(c.output)))) {
      const audit = result.audit.filter(a => a.files.wire.startsWith(String(campaign.output) + '/'));
      store.campaign(String(campaign.id), {...campaign, reconciliation: audit, improvementId: values.id, candidateDecision: result.promotion});
    }
    console.log(JSON.stringify({promotion:result.promotion,reasons:result.reasons,audit:result.audit},null,2));
  } else if (command === 'signal') {
    if (!values.id || !['pause', 'resume', 'cancel'].includes(values.action ?? '')) throw new Error('--id and --action pause|resume|cancel required');
    if (!store.campaigns().some(c => c.id === values.id)) throw new Error('Unknown campaign');
    store.event('campaign.control', { id: values.id, action: values.action });
    console.log('Control request recorded; wait for campaign acknowledgement.');
  } else if (command === 'prepare-live') {
    if (!values.model || !values.origins || !values.output) throw new Error('--model, --origins and fresh --output required');
    const plan = livePilotPlan(values.model, values.origins.split(','), values['include-personal']);
    writeFileSync(values.output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Prepared live plan; no model calls. Review the model origins, quota, cases and Personal configured models before running.');
  } else if (command === 'run') {
    if (!values.plan || !values.output) throw new Error('--plan and fresh --output required');
    const plan = validatePlan(JSON.parse(readFileSync(values.plan, 'utf8')));
    let shared: PoolEndpoint | undefined;
    if (values['pool-endpoint']) {
      const data = record(JSON.parse(readFileSync(values['pool-endpoint'], 'utf8')));
      const url = new URL(String(data.url));
      if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || typeof data.token !== 'string') throw new Error('Shared pool endpoint must be a trusted loopback broker');
      shared = { url: url.origin, token: data.token };
    }
    const state = await runCampaign(plan, process.cwd(), resolve(values.output), store, values.resume, shared);
    console.log(JSON.stringify(state, null, 2));
    if (state.status !== 'completed' || state.validity !== 'valid') process.exitCode = 1;
  } else throw new Error('Usage: eval:control import|list|compare|improvement|run|signal; see evals/control/README.md');
} finally { store.close(); }
