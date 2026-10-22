import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd();
const output = resolve(process.argv[2] ?? '.xopc-evals/memory-evidence-reproduction.json');
mkdirSync(dirname(output), { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), 'xopc-evidence-repro-'));
process.env.XOPC_STATE_DIR = temporary;
process.env.XOPC_LOG_CONSOLE = 'false';
const load = (path: string) => import(pathToFileURL(join(root,path)).href);
const { openXopcDatabase, closeXopcDatabase } = await load('src/storage/sqlite/index.ts');
const { applyWorkCandidates } = await load('src/memory-learning/work-capture.ts');
openXopcDatabase({path:join(temporary,'repro.sqlite')});
const text = '青禾选择 SQLite，因为需要离线运行。';
const base = {kind:'project_fact',topicKey:'qinghe-storage',predicate:'storage.choice',statement:text,
 scope:'workspace',confidence:0.95,importance:0.8};
const input = {evidence:[{ref:'source1',role:'user',text,createdAt:Date.now()}],conversationId:'synthetic-repro',
 agentId:'main',workspaceId:temporary,processingPolicy:'remote_allowed',runId:'synthetic-run'};
const result:Record<string,unknown> = {modelCalls:0,isolated:true,productModified:false};
try {
 result.singleQuote = applyWorkCandidates({...input,candidates:[{...base,evidence:[{ref:'source1',quote:'青禾选择 SQLite'}]}]});
 try {
  result.multipleQuotesSameSource = applyWorkCandidates({...input,candidates:[{...base,evidence:[
   {ref:'source1',quote:'青禾选择 SQLite'},{ref:'source1',quote:'需要离线运行'}]}]});
 } catch(error) {result.multipleQuotesSameSourceError = String(error);}
 try {
  result.newItemMultipleQuotesSameSource = applyWorkCandidates({...input,candidates:[{...base,topicKey:'new-qinghe-storage',evidence:[
   {ref:'source1',quote:'青禾选择 SQLite'},{ref:'source1',quote:'需要离线运行'}]}]});
 } catch(error) {result.newItemMultipleQuotesSameSourceError = String(error);}
 result.distinctSourceControl = applyWorkCandidates({...input,evidence:[...input.evidence,{ref:'source2',role:'user',text,createdAt:Date.now()}],candidates:[{...base,topicKey:'distinct-source-control',evidence:[
  {ref:'source1',quote:'青禾选择 SQLite'},{ref:'source2',quote:'需要离线运行'}]}]});
 writeFileSync(output,JSON.stringify(result,null,2)+'\n', { flag: 'wx' });
 console.log(JSON.stringify(result));
} finally {closeXopcDatabase();rmSync(temporary,{recursive:true,force:true});}
