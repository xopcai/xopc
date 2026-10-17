import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentAdapter } from '@agent-evals/protocol';
import { EvalRunner, loadSuite } from '@agent-evals/runner';
import { ArtifactStore, EvalStore } from '@agent-evals/storage';
import { expect, it } from 'vitest';

import { growthCalibrationAdapter } from '../apps/cli/src/growth-calibration.js';

it('calibrates six isolated growth tasks and rejects plausible wrong solutions and scope changes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'growth-calibration-'));
  const directory = fileURLToPath(new URL('../suites/xopc-agent-growth/', import.meta.url));
  const fixture = JSON.parse(execFileSync(process.execPath, [join(directory, 'create-fixture.mjs'), root], {encoding:'utf8'})) as {repo:string;caseCommits:Record<string,string>};
  const saved = new Map<string, string | undefined>();
  const set = (name: string, value: string) => { saved.set(name, process.env[name]); process.env[name] = value; };
  set('EVAL_FIXTURE_REPO', fixture.repo);
  for (const [id, commit] of Object.entries(fixture.caseCommits)) set(`EVAL_FIXTURE_${id}_COMMIT`, commit);
  const store = new EvalStore(join(root, 'evals.db'));
  try {
    const repeated = JSON.parse(execFileSync(process.execPath, [join(directory, 'create-fixture.mjs'), root], {encoding:'utf8'}));
    expect(repeated.caseCommits).toEqual(fixture.caseCommits);
    const suite = await loadSuite(join(directory, 'suite.yaml'));
    expect(suite.cases).toHaveLength(6);
    for (const c of suite.cases) expect(c.budget).toEqual({timeoutMs:300000,maxModelRequests:40,maxTokens:300000});
    const reference = growthCalibrationAdapter();
    const adapter: AgentAdapter = { id: reference.id, async run(request, onEvent, signal) {
      const result = await reference.run(request,request.variant.id === 'unverified' ? () => {} : onEvent,signal);
      const workspace = request.environment.workspace;
      const id = request.evalCase.id.split('-')[0];
      const files = execFileSync('git',['ls-files'],{cwd:workspace,encoding:'utf8'});
      expect(files).not.toContain('reference.mjs');
      expect(files).not.toContain('hidden/');
      expect(files).not.toContain('fixture/');
      if (request.variant.id === 'corrupt') {
        if (id === 'I01') {
          const path = join(workspace,'result.json'); const value=JSON.parse(readFileSync(path,'utf8'));value.netCents=99900;writeFileSync(path,JSON.stringify(value));
        } else if (id === 'I02') {
          const path=join(workspace,'result.json');const value=JSON.parse(readFileSync(path,'utf8'));value.maxAttempts=2;writeFileSync(path,JSON.stringify(value));
        } else if (id === 'E01') writeFileSync(join(workspace,'deliverables/result.json'),'{"rowCount":2,"totalCents":3501}');
        else if (id === 'E02') {
          const path=join(workspace,'src/export.mjs');writeFileSync(path,readFileSync(path,'utf8').replace('all.reduce','all.slice(0,limit).reduce'));
        } else if (id === 'P01') {
          const path=join(workspace,'src/reservations.mjs');writeFileSync(path,readFileSync(path,'utf8').replace('catalog.invalidate(sku);',''));
        } else {
          const path=join(workspace,'src/query.mjs');writeFileSync(path,readFileSync(path,'utf8').replace('labels.every(label=>(ticket.labels','labels.some(label=>(ticket.labels'));
        }
      } else if (request.variant.id === 'scope') writeFileSync(join(workspace,'README.md'),'Unrequested rewrite.');
      return result;
    }};
    const result = await new EvalRunner({store,artifactStore:new ArtifactStore(join(root,'artifacts')),adapters:[adapter]})
      .runExperiment(suite,{name:'Growth calibration',randomizeVariantOrder:false,variants:['broken','reference','corrupt','scope','unverified'].map(id=>({id,adapter:adapter.id}))});
    expect(result.runs).toHaveLength(30);
    for (let i=0;i<result.runs.length;i+=5) {
      expect(result.runs[i]?.status).toBe('failed');
      expect(result.runs[i+1]?.status,JSON.stringify(result.runs[i+1]?.grades)).toBe('passed');
      expect(result.runs[i+2]?.status,suite.cases[i/5]?.id).toBe('failed');
      expect(result.runs[i+3]?.grades[1]?.passed).toBe(false);
      expect(result.runs[i+4]?.status).toBe(suite.cases[i/5]!.id.startsWith('I') ? 'passed' : 'failed');
    }
    const extra: AgentAdapter = {id:'unrequested-output', async run(request,onEvent,signal) {
      const result=await reference.run(request,onEvent,signal);
      writeFileSync(join(request.environment.workspace,'unrequested.test.cjs'),'// No feature or test was requested.');
      return result;
    }};
    const extraResult = await new EvalRunner({store,artifactStore:new ArtifactStore(join(root,'artifacts')),adapters:[extra]})
      .runExperiment({...suite,cases:suite.cases.filter(c=>c.id.startsWith('E01'))},{name:'Reject extra completed-task outputs',variants:[{id:'extra',adapter:extra.id}]});
    expect(extraResult.runs[0]?.status).toBe('failed');
    expect(extraResult.runs[0]?.grades[0]?.passed).toBe(false);
  } finally {
    for (const [name,value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name]=value; }
    store.close();rmSync(root,{recursive:true,force:true});
  }
},120000);
