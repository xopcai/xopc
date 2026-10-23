import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {afterEach,describe,expect,it} from 'vitest';
import {hash} from '../../control/evidence.js';
import {assessPersonalLatency} from '../../control/personal-latency.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'personal-latency-gate-'));roots.push(root);mkdirSync(join(root,'personal'));mkdirSync(join(root,'source'));writeFileSync(join(root,'source/candidate.ts'),'frozen');
 const write=(path:string,value:unknown)=>writeFileSync(join(root,path),JSON.stringify(value));
 const registration={registeredAt:'2026-01-01',candidateSourceHashes:{'candidate.ts':hash('frozen')},gate:{submitHostMs:250,requestToSubmitMs:20000,acknowledgementMs:5000,pingMs:5000,totalMs:600000}};
 write('registration.json',registration);write('campaign.json',{startedAt:'2026-01-02',validity:'valid',sourceChanged:false,status:'completed',pool:{active:0,queued:0}});
 write('personal/summary.json',{suiteVersion:7,total:1,requestedRounds:1,requestedScenarios:['mixed'],trials:[{success:true}]});
 const report={success:true,benchmark:{version:7,sourceChangedDuringRun:false},rawTimings:{requestSent:0,taskPersisted:10000,submitToolReturned:10001,personalInitialCompleted:13000,pingSent:15000,pingCompleted:17000,personalResultDelivered:100000,submitToolMs:5}};
 write('personal/mixed-round-1.json',report);write('personal/runtime-usage.json',{finalSnapshotGuaranteed:true,rows:[{id:'usage',operation:'agent.answer',status:'succeeded',cloud_request_id:'cloud',total_tokens:100}]});
 writeFileSync(join(root,'personal-model-requests.jsonl'),[{event:'start',requestId:'http',usageEventId:'usage',lease:'l'},{event:'end',requestId:'http',cloudRequestId:'cloud',lease:'l',status:200,usage:{total:100}}].map(e=>JSON.stringify(e)).join('\n'));
 return{root,write,report,registration,assess:()=>assessPersonalLatency(root,join(root,'registration.json'),join(root,'source'))};
}
describe('Personal v7 fixed latency acceptance',()=>{
 it('requires the full v7 verdict plus latency and independent accounting',()=>expect(fixture().assess()).toMatchObject({promotion:'promoted',tokens:100,personalAcceptance:{overallAccepted:true}}));
 it('retains a 5.3-second ping failure even after successful delivery',()=>{const f=fixture();f.report.rawTimings.pingCompleted=20300;f.write('personal/mixed-round-1.json',f.report);expect(f.assess()).toMatchObject({promotion:'rejected',personalAcceptance:{latencyFailures:[{key:'pingResponse',actual:5300,limit:5000}]}});});
 it('rejects a relaxed threshold rather than turning a slow request green',()=>{const f=fixture();f.registration.gate.pingMs=6000;f.write('registration.json',f.registration);expect(f.assess().reasons).toContain('Latency gates changed or missing');});
 it('does not override the original failed trial when latency alone passes',()=>{const f=fixture();f.report.success=false;f.write('personal/mixed-round-1.json',f.report);expect(f.assess().promotion).toBe('rejected');});
 it('rejects changed source and lost tails',()=>{const f=fixture();writeFileSync(join(f.root,'source/candidate.ts'),'changed');f.write('personal/runtime-usage.json',{rows:[]});expect(f.assess().promotion).toBe('rejected');});
});
