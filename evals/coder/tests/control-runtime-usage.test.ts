import{DatabaseSync}from'node:sqlite';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{describe,it,expect}from'vitest';
// @ts-expect-error Native ESM export is shared with standalone evaluation launchers.
import{readRuntimeUsage}from'../../control/runtime-usage.mjs';
describe('post-stop runtime export',()=>{
 it('opens its own readonly connection after the application closes its handle',()=>{
  const root=mkdtempSync(join(tmpdir(),'usage-post-stop-')),path=join(root,'state.db');
  try{const db=new DatabaseSync(path);db.exec('CREATE TABLE ai_usage_events(id TEXT,provider TEXT,model TEXT,operation TEXT,status TEXT,started_at INTEGER,finished_at INTEGER,input_tokens INTEGER,output_tokens INTEGER,cache_read_tokens INTEGER,cache_write_tokens INTEGER,total_tokens INTEGER,cloud_request_id TEXT,cloud_billing_json TEXT)');db.exec("INSERT INTO ai_usage_events VALUES('r','xopc-cloud','fixed','agent.answer','succeeded',1,2,10,2,0,0,12,'cloud-r',NULL)");db.close();expect(readRuntimeUsage(path)).toMatchObject([{id:'r',total_tokens:12,cloud_request_id:'cloud-r'}]);}
  finally{rmSync(root,{recursive:true,force:true});}
 });
});
