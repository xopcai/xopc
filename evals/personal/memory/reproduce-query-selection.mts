import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { run:{type:'string'}, fixtures:{type:'string'}, case:{type:'string'}, out:{type:'string'} } });
if (!values.run || !values.fixtures || !values.case || !values.out) throw new Error('Specify --run, --fixtures, --case, --out');
const run=resolve(values.run), out=resolve(values.out), folder=join(run,'cases',values.case,'capture');
if (!existsSync(join(run,'completion.json')) || existsSync(out)) throw new Error('Require closed capture and a new output file');
const fixture=JSON.parse(readFileSync(join(resolve(values.fixtures),values.case+'.json'),'utf8'));
const captured=JSON.parse(readFileSync(join(folder,'result.json'),'utf8'));
const learned=JSON.parse(readFileSync(join(folder,'learning.json'),'utf8'));
const state=mkdtempSync(join(tmpdir(),'xopc-query-replay-'));
process.env.XOPC_STATE_DIR=state; process.env.XOPC_LOG_CONSOLE='false';
globalThis.fetch=async()=>{throw new Error('Network forbidden in deterministic replay');};
copyFileSync(join(folder,'state.sqlite'),join(state,'state.sqlite'));
const load=(path:string)=>import(pathToFileURL(join(process.cwd(),path)).href);
const {openXopcDatabase,closeXopcDatabase,getSqliteDatabase}=await load('src/storage/sqlite/index.ts');
const {ConfigSchema}=await load('src/config/schema.ts');
const {ExecutionContextCoordinator}=await load('src/agent/context/coordinator.ts');
const {resolveUserContextSessionAccess}=await load('src/user-context/access-policy.ts');
openXopcDatabase({path:join(state,'state.sqlite')});
try {
  const db=getSqliteDatabase(), before=Number(db.prepare('SELECT COUNT(*) AS n FROM ai_usage_events').get()!.n);
  const metadata=db.prepare('SELECT agent_id,project_id FROM sessions WHERE conversation_id=?').get(captured.conversationId)!;
  const workspace=learned.knowledge.find((row:any)=>row.scope_type==='workspace')?.scope_id;
  if(!workspace)throw new Error('No captured workspace scope');
  const config=ConfigSchema.parse({userContext:learned.policy});
  const transcript = db.prepare("SELECT payload_json FROM transcript_entries WHERE transcript_id=(SELECT active_transcript_id FROM sessions WHERE conversation_id=?) AND role='user' ORDER BY seq LIMIT 1").get(captured.conversationId)!;
  const storedUser=JSON.parse(String(transcript.payload_json));
  const wireText=typeof storedUser.content==='string'?storedUser.content:storedUser.content.filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n');
  const authored=/<user_message>\s*([\s\S]*?)\s*<\/user_message>/u.exec(wireText)?.[1]??wireText;
  const originalAudit=db.prepare('SELECT query_hash,budget_json FROM execution_context_runs WHERE conversation_id=? ORDER BY created_at LIMIT 1').get(captured.conversationId)!;
  const inputs=[{label:'plain',message:fixture.query},{label:'original-evaluator-wrapper',message:
    `[Memory evaluation question time: ${new Date(fixture.queryTime).toISOString()}. Use the supplied question time for historical references; do not assume missing personal facts.]\n${fixture.query}`},
    {label:'actual-author-with-host-timestamp',message:authored},
    {label:'runtime-plain-question',message:authored.slice(0,Math.max(0,authored.indexOf('[Memory evaluation question time:')))+fixture.query},
    {label:'actual-stored-wire-text',message:wireText}];
  const results=[];
  for(const input of inputs){
    const coordinator=new ExecutionContextCoordinator({getConfig:()=>config,
      getAccessForSession:(id:string)=>{const access=resolveUserContextSessionAccess(config,id);return {userModel:access.userModel,knowledge:access.knowledge,knowledgePolicy:access.knowledgePolicy};},
      getWorkspaceIdForSession:()=>workspace,getProjectIdForSession:()=>typeof metadata.project_id==='string'?metadata.project_id:undefined,
      ensureMemoryReady:async()=>{},searchExternalMemory:async()=>[]});
    const plan=await coordinator.prepare({role:'user',content:input.message,timestamp:Date.now()},captured.conversationId,randomUUID());
    const rows=db.prepare('SELECT object_type,object_id,included FROM execution_context_items WHERE run_id=?').all(plan.traceId);
    const replayAudit=db.prepare('SELECT query_hash,budget_json FROM execution_context_runs WHERE run_id=?').get(plan.traceId)!;
    results.push({label:input.label,query:input.message,queryHash:replayAudit.query_hash,actualQueryHash:originalAudit.query_hash,
      matchesCapturedQuery:replayAudit.query_hash===originalAudit.query_hash,budget:JSON.parse(String(replayAudit.budget_json)),
      rendered:plan.dynamicSystemContext,selected:rows});
  }
  const after=Number(db.prepare('SELECT COUNT(*) AS n FROM ai_usage_events').get()!.n);
  if(after!==before)throw new Error('Replay unexpectedly called a model');
  writeFileSync(out,JSON.stringify({modelCalls:0,sourceDatabaseHash:createHash('sha256').update(readFileSync(join(folder,'state.sqlite'))).digest('hex'),
    candidateRegeneration:false,agentId:metadata.agent_id,results},null,2)+'\n');
} finally {closeXopcDatabase();rmSync(state,{recursive:true,force:true});}
