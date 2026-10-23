import {DatabaseSync} from 'node:sqlite';

/** Open a fresh read-only connection; Gateway.stop may have closed the application's handle. */
export function readRuntimeUsage(path) {
 const db=new DatabaseSync(path,{readOnly:true});
 try {return db.prepare('SELECT id,provider,model,operation,status,started_at,finished_at,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,cloud_request_id,cloud_billing_json FROM ai_usage_events ORDER BY started_at,id').all();}
 finally{db.close();}
}
