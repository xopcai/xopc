/** Read a completed synthetic capture through unchanged production search functions. */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { db:{type:'string'}, conversation:{type:'string'}, query:{type:'string'},
  term:{type:'string'}, 'han-term':{type:'string'}, 'whole-token':{type:'string'}, out:{type:'string'} } });
if(!values.db||!values.conversation||!values.query||!values.out)throw new Error('Require --db --conversation --query --out');
const source=resolve(values.db), output=resolve(values.out), root=process.cwd();
if(existsSync(source+'-wal')&&statSync(source+'-wal').size)throw new Error('Use a closed, checkpointed capture database');
if(existsSync(output))throw new Error('Refusing existing reproduction output');
const temporary=mkdtempSync(join(tmpdir(),'xopc-search-repro-'));
process.env.XOPC_STATE_DIR=temporary;process.env.XOPC_LOG_CONSOLE='false';
const load=(path:string)=>import(pathToFileURL(join(root,path)).href);
const {openXopcDatabase,closeXopcDatabase}=await load('src/storage/sqlite/index.ts');
const {listSessionMetadata}=await load('src/storage/sqlite/session-repository.ts');
const {searchSessionTranscript}=await load('src/storage/sqlite/transcript-repository.ts');
copyFileSync(source,join(temporary,'copy.sqlite'));openXopcDatabase({path:join(temporary,'copy.sqlite')});
try{
 const sourceFound=(query:string)=>listSessionMetadata({search:query,limit:100}).items.some((r:any)=>r.key===values.conversation);
 const result:any={modelCalls:0,isolatedCopy:true,sourceDatabaseHash:createHash('sha256').update(readFileSync(source)).digest('hex'),
  conversationId:values.conversation,query:values.query,listedSourceFound:sourceFound(values.query),
  phraseRecall:searchSessionTranscript(values.conversation,values.query,{limit:2,matchMode:'phrase'}),
  keywordRecall:searchSessionTranscript(values.conversation,values.query,{limit:2,matchMode:'keyword'})};
 if(values.term)result.singleTermRecall=searchSessionTranscript(values.conversation,values.term,{limit:2});
 if(values['han-term']){
  result.hanSubstringListingSourceFound=sourceFound(values['han-term']);
  result.hanSubstringRecallOnKnownSource=searchSessionTranscript(values.conversation,values['han-term'],{limit:2});
 }
 if(values['whole-token'])result.wholeTokenListingSourceFound=sourceFound(values['whole-token']);
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(output);
}finally{closeXopcDatabase();rmSync(temporary,{recursive:true,force:true});}
