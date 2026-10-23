import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';

import { reconcileJob } from '../../control/reconciliation.js';
import { ControlStore } from '../../control/store.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); });
function fixture(wireTokens = 100) {
  const root = mkdtempSync(join(tmpdir(),'eval-reconcile-')); roots.push(root);
  mkdirSync(join(root,'job/benchmark'),{recursive:true});
  const events = [{event:'start',requestId:'a',lease:'1'},{event:'end',requestId:'a',lease:'1',status:200,usage:{total:wireTokens}},
    {event:'start',requestId:'b',lease:'2'},{event:'end',requestId:'b',lease:'2',status:200,usage:{total:17}}];
  writeFileSync(join(root,'job-model-requests.jsonl'),events.map(e=>JSON.stringify(e)).join('\n'));
  writeFileSync(join(root,'job/runtime-usage.json'),JSON.stringify({finalSnapshotGuaranteed:true,rows:[{operation:'agent.answer',status:'succeeded',total_tokens:100},{operation:'session.generate_title',status:'succeeded',total_tokens:17}]}));
  const db = new DatabaseSync(join(root,'job/benchmark/evals.db'));
  db.exec('CREATE TABLE eval_run_events(run_id TEXT,seq INTEGER,type TEXT,payload_json TEXT)');
  db.prepare('INSERT INTO eval_run_events VALUES(?,?,?,?)').run('r',1,'model.response',JSON.stringify({payload:{usage:{total:100}}})); db.close();
  return root;
}
describe('three observation reconciliation',()=>{
  it('counts auxiliary calls and refuses to equate task events with physical calls',()=>{
    expect(reconcileJob(fixture(),'job')).toMatchObject({physicalRequests:2,runtimeRequests:2,taskResponses:1,auxiliaryRequests:1,wireTokens:117,runtimeTokens:117,taskTokens:100,requestCountMatched:true,usageMatched:true,actualCharge:null});
  });
  it('retains provider/runtime token discrepancies instead of manufacturing equality',()=>{
    expect(reconcileJob(fixture(140),'job')).toMatchObject({requestCountMatched:true,usageMatched:false,providerMinusRuntimeTokens:40});
  });
  it('never reports partial response usage as a complete token total',()=>{
    const root=fixture(),path=join(root,'job-model-requests.jsonl');
    writeFileSync(path,readFileSync(path,'utf8').split('\n').slice(0,-1).join('\n'));
    expect(reconcileJob(root,'job')).toMatchObject({physicalRequests:2,completedRequests:1,unknownRequests:1,observedWireTokens:100,wireTokens:null,requestInventoryMatched:true,requestCountMatched:false,usageMatched:false});
  });
  it('detects per-request identity/token swaps even when aggregate totals agree',()=>{
    const root=fixture(),wire=join(root,'job-model-requests.jsonl'),ledger=join(root,'job/runtime-usage.json');
    const events=readFileSync(wire,'utf8').split('\n').map(line=>JSON.parse(line));
    for(const e of events){if(e.event==='start')e.usageEventId=e.requestId;else e.cloudRequestId=e.requestId;}
    writeFileSync(wire,events.map(e=>JSON.stringify(e)).join('\n'));
    writeFileSync(ledger,JSON.stringify({rows:[{id:'a',cloud_request_id:'a',operation:'agent.answer',status:'succeeded',total_tokens:17},{id:'b',cloud_request_id:'b',operation:'session.generate_title',status:'succeeded',total_tokens:100}]}));
    const db=new DatabaseSync(join(root,'job/benchmark/evals.db'));db.prepare('UPDATE eval_run_events SET payload_json=?').run(JSON.stringify({payload:{usage:{total:17}}}));db.close();
    expect(reconcileJob(root,'job')).toMatchObject({wireTokens:117,runtimeTokens:117,usageMatched:true,perRequestMatched:false});
  });
  it('retains known partial totals when an interrupted terminal explicitly has null usage',()=>{
    const root=fixture(),path=join(root,'job-model-requests.jsonl'),events=readFileSync(path,'utf8').split('\n').map(line=>JSON.parse(line));
    events[3]={...events[3],usage:null,error:'process_exit',terminalState:'interrupted'};
    writeFileSync(path,events.map(e=>JSON.stringify(e)).join('\n'));
    expect(reconcileJob(root,'job')).toMatchObject({observedWireTokens:100,wireTokens:null,unknownRequests:1,usageMatched:false});
  });
  it('persists rejection once and prevents overwriting the decision',()=>{
    const root=fixture(),store=new ControlStore(join(root,'index.db'));
    try {
      const id=store.improvement({problem:'p',hypothesis:'h',budget:{},protection:['quality'],decision:'pending'});
      const decision={promotion:'rejected',preregistrationHash:'fixed',audit:[],reasons:['incomplete execution']};
      store.decideImprovement(id,decision);
      expect(store.improvements()[0]).toMatchObject({promotion:'rejected',decision});
      expect(()=>store.decideImprovement(id,{...decision,promotion:'promoted'})).toThrow('immutable');
    } finally {store.close();}
  });
});
