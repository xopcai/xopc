import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {assessVerification} from '../../control/verification.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'cancel-gate-'));roots.push(root);mkdirSync(join(root,'cancellation'));
 const write=(p:string,data:unknown)=>writeFileSync(join(root,p),JSON.stringify(data));
 write('registration.json',{registeredAt:'2026-01-01',scope:'bounded cancellation',candidateSourceHashes:{wire:'frozen'},jobs:[{id:'cancellation',kind:'cancellation',expected:1}]});
 write('campaign.json',{startedAt:'2026-01-02',validity:'valid',sourceChanged:false});
 write('cancellation/summary.json',{manifest:{sourceChangedDuringRun:false,sourceHashes:{wire:'frozen'}},trials:[{success:true,stopReason:'aborted',canceledAt:1,finishedAt:100,totalTokens:14,inputTokens:10,outputTokens:4}]});
 write('cancellation/runtime-usage.json',{finalSnapshotGuaranteed:true,rows:[{id:'usage',cloud_request_id:'cloud',status:'aborted',operation:'agent.answer',input_tokens:10,output_tokens:4,total_tokens:14}]});
 writeFileSync(join(root,'cancellation-model-requests.jsonl'),[{event:'start',requestId:'http',lease:'lease',usageEventId:'usage'},{event:'end',requestId:'http',lease:'lease',cloudRequestId:'cloud',status:200,usage:{total:14},rawUsage:{prompt_tokens:10,completion_tokens:4,total_tokens:14}}].map(e=>JSON.stringify(e)).join('\n'));
 return {root,write,assess:()=>assessVerification(root,join(root,'registration.json'))};
}
describe('canceled live request acceptance',()=>{
 it('accepts observed final usage without reclassifying the logical request as successful',()=>{expect(fixture().assess()).toMatchObject({promotion:'promoted',scope:'bounded cancellation',tokens:14});});
 it('rejects zero components even when aggregate totals match',()=>{const f=fixture();f.write('cancellation/runtime-usage.json',{finalSnapshotGuaranteed:true,rows:[{id:'usage',cloud_request_id:'cloud',status:'aborted',operation:'agent.answer',input_tokens:0,output_tokens:0,total_tokens:14}]});expect(f.assess().promotion).toBe('rejected');});
 it('rejects a successful answer substituted for a cancellation',()=>{const f=fixture();const p=join(f.root,'cancellation/summary.json'),r=JSON.parse(readFileSync(p,'utf8'));r.trials[0].stopReason='stop';writeFileSync(p,JSON.stringify(r));expect(f.assess().promotion).toBe('rejected');});
 it('rejects a changed candidate or an excessive drain',()=>{const f=fixture();const p=join(f.root,'cancellation/summary.json'),r=JSON.parse(readFileSync(p,'utf8'));r.manifest.sourceHashes.wire='changed';r.trials[0].finishedAt=20000;writeFileSync(p,JSON.stringify(r));expect(f.assess().promotion).toBe('rejected');});
});
