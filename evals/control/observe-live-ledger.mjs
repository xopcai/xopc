/** Read-only sidecar for launchers predating built-in ledger export. No credential files are persisted. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
const output = resolve(process.argv[2]);
const timer = setInterval(() => {
  const state = JSON.parse(readFileSync(join(output, 'campaign.json'), 'utf8'));
  for (const file of readdirSync(output).filter(name => name.endsWith('-model-requests.jsonl'))) {
    const id = file.replace('-model-requests.jsonl', '');
    const starts = readFileSync(join(output,file),'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(e => e.event==='start');
    const pids = [...new Set(starts.map(e=>e.pid))];
    for (const pid of pids) {
      let command; try { command = execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}); } catch { continue; }
      const port = command.match(/--port (\d+)/)?.[1]; if (!port) continue;
      for (const name of readdirSync(tmpdir()).filter(name=>name.startsWith('xopc-live-eval-'))) {
        const root=join(tmpdir(),name), configPath=join(root,'xopc.json');
        if (!existsSync(configPath)) continue;
        let config; try { config=JSON.parse(readFileSync(configPath,'utf8')); } catch {continue;}
        if (String(config.gateway.port)!==port) continue;
        let db;
        try {
          db=new DatabaseSync(join(root,'xopc.db'),{readOnly:true});
          const rows=db.prepare('SELECT id,provider,model,operation,status,started_at,finished_at,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,total_tokens,cloud_request_id,cloud_billing_json FROM ai_usage_events ORDER BY started_at,id').all();
          writeFileSync(join(output,id+'-runtime-usage.json'),JSON.stringify({observedAt:new Date().toISOString(),mode:'read-only-live-sidecar',finalSnapshotGuaranteed:false,rows},null,2));
        } catch { /* Database startup/cleanup may race the read-only observer. */ }
        finally {db?.close();}
      }
    }
  }
  if (state.status && !['running','paused'].includes(state.status)) {clearInterval(timer);}
},300);
