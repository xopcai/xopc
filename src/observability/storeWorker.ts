/** Self-contained worker source works in tsx, published unbundled Node, and Electron builds. */
export const traceStoreWorkerSource = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const file = workerData.path;
fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(file);
let config = workerData.config;
let dropped = 0;
let paused = false;
let lastPruned = 0;
if (Number(db.prepare('PRAGMA user_version').get().user_version) > 1) throw new Error('Trace database schema is newer than this runtime');
function limits() {
  db.exec('PRAGMA max_page_count=' + Math.floor((config.local.maxStoreMiB - 4) * 1048576 / 8192));
}
db.exec('PRAGMA busy_timeout=100; PRAGMA page_size=4096; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA wal_autocheckpoint=128; PRAGMA journal_size_limit=1048576;');
db.exec('CREATE TABLE IF NOT EXISTS traces (trace_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, conversation_id TEXT, run_id TEXT, agent_id TEXT, owner TEXT, data TEXT NOT NULL, partial_reason TEXT); CREATE INDEX IF NOT EXISTS trace_time ON traces(started_at,trace_id); CREATE INDEX IF NOT EXISTS trace_conversation ON traces(conversation_id,started_at); CREATE TABLE IF NOT EXISTS spans (trace_id TEXT NOT NULL, span_id TEXT NOT NULL, data TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(trace_id,span_id)); CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, epoch INTEGER NOT NULL, window INTEGER NOT NULL, written INTEGER NOT NULL); INSERT OR IGNORE INTO state VALUES(1,0,0,0); CREATE TABLE IF NOT EXISTS leases (owner TEXT PRIMARY KEY, heartbeat INTEGER NOT NULL); PRAGMA user_version=1;');
limits();
function size() {
  return ['', '-wal', '-shm'].reduce((sum, suffix) => { try { return sum + fs.statSync(file + suffix).size; } catch { return sum; } }, 0);
}
function permissions() { for (const suffix of ['', '-wal', '-shm']) { try { fs.chmodSync(file + suffix, 0o600); } catch {} } }
function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function heartbeat() {
  db.prepare('INSERT INTO leases VALUES (?,?) ON CONFLICT(owner) DO UPDATE SET heartbeat=excluded.heartbeat').run(workerData.owner, Date.now());
  const stale = db.prepare('SELECT trace_id,data FROM traces WHERE ended_at IS NULL AND (started_at < ? OR owner IN (SELECT owner FROM leases WHERE heartbeat < ?)) LIMIT 256').all(Date.now()-86400000, Date.now()-120000);
  for (const row of stale) { const data=JSON.parse(row.data); data.endedAt=Date.now(); data.status='interrupted'; db.prepare('UPDATE traces SET ended_at=?,status=?,data=? WHERE trace_id=?').run(data.endedAt,data.status,JSON.stringify(data),row.trace_id); }
  db.prepare('DELETE FROM leases WHERE heartbeat < ? AND NOT EXISTS (SELECT 1 FROM traces WHERE traces.owner=leases.owner AND ended_at IS NULL)').run(Date.now()-120000);
}
function remove(ids) {
  for (const row of ids) { db.prepare('DELETE FROM spans WHERE trace_id=?').run(row.trace_id); db.prepare('DELETE FROM traces WHERE trace_id=?').run(row.trace_id); }
}
function allocatedBytes() { return (Number(db.prepare('PRAGMA page_count').get().page_count) - Number(db.prepare('PRAGMA freelist_count').get().freelist_count)) * 4096; }
function counts() {
  const t=db.prepare('SELECT COUNT(*) AS traces FROM traces').get();
  const s=db.prepare('SELECT COUNT(*) AS spans,COALESCE(SUM(bytes),0) AS bytes FROM spans').get();
  return { ...t,...s };
}
function prune() {
  transaction(() => {
    remove(db.prepare('SELECT trace_id FROM traces WHERE ended_at IS NOT NULL AND started_at < ? LIMIT 1000').all(Date.now()-config.local.retentionDays*86400000));
    for(let i=0;i<10;i++) {
      const c=counts();
      if(c.traces < config.local.maxTraces && c.spans < config.local.maxSpans && c.bytes < (config.local.maxStoreMiB-4)*1048576*0.3 && allocatedBytes() < (config.local.maxStoreMiB-4)*1048576*0.3) break;
      const old=db.prepare('SELECT trace_id FROM traces WHERE ended_at IS NOT NULL ORDER BY started_at LIMIT ?').all(Math.max(1,Math.min(100,Math.ceil(config.local.maxTraces/10))));
      if(!old.length) break;
      remove(old);
    }
  });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE); PRAGMA incremental_vacuum(16384); PRAGMA wal_checkpoint(TRUNCATE);');
  lastPruned=Date.now();
  permissions();
}
function put(records, epoch) {
  const max=config.local.maxStoreMiB*1048576;
  const initial=counts();
  if(size()>max*0.75 || initial.traces>=config.local.maxTraces || initial.spans>=config.local.maxSpans || initial.bytes>(max-4194304)*0.4 || allocatedBytes()>(max-4194304)*0.4 || Date.now()-lastPruned>60000) prune();
  if(size()>max-2097152) { paused=true; dropped+=records.length; return; }
  paused=false;
  let acceptedEpoch;
  transaction(() => {
    const state=db.prepare('SELECT * FROM state WHERE id=1').get();
    acceptedEpoch=state.epoch;
    if(epoch !== null && epoch !== state.epoch) { dropped+=records.length; return; }
    const minute=Math.floor(Date.now()/60000);
    let written=minute===state.window ? state.written : 0;
    let c=counts();
    for(const source of records) {
      const r={ ...source, attributes:{ ...source.attributes } };
      const root=!r.parentSpanId || r.attributes['xopc.localRoot']===true;
      if(written>=config.local.maxWriteMiBPerMinute*1048576+65536) { dropped++; continue; }
      let trace=db.prepare('SELECT * FROM traces WHERE trace_id=?').get(r.traceId);
      if(!trace) {
        if(c.traces>=config.local.maxTraces) { dropped++; continue; }
        const a=r.attributes;
        const overview={ ...r, attributes: Object.fromEntries(Object.entries(a).filter(([k]) => !k.endsWith('.input') && !k.endsWith('.output'))) };
        db.prepare('INSERT INTO traces VALUES(?,?,?,?,?,?,?,?,?,NULL)').run(r.traceId,r.startedAt,root?r.endedAt??null:null,root?r.status:'running',a['xopc.conversationId']??null,a['xopc.runId']??null,a['xopc.agentId']??null,workerData.owner,JSON.stringify(overview));
        c.traces++;
        trace=db.prepare('SELECT * FROM traces WHERE trace_id=?').get(r.traceId);
      }
      let text=JSON.stringify(r);
      let bytes=Buffer.byteLength(text);
      const previous=db.prepare('SELECT bytes FROM spans WHERE trace_id=? AND span_id=?').get(r.traceId,r.spanId);
      const total=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(bytes),0) AS bytes FROM spans WHERE trace_id=?').get(r.traceId);
      const limited=c.bytes+bytes>(max-4194304)*0.4 || total.bytes+bytes-(previous?.bytes??0)>config.local.maxTraceKiB*1024 || written+bytes*(root?2:1)>config.local.maxWriteMiBPerMinute*1048576;
      if(limited) {
        delete r.attributes['langfuse.observation.input']; delete r.attributes['langfuse.observation.output'];
        r.attributes['xopc.partialReason']='quota'; text=JSON.stringify(r); bytes=Buffer.byteLength(text);
        db.prepare('UPDATE traces SET partial_reason=? WHERE trace_id=?').run('quota',r.traceId);
      }
      if(!previous && (c.spans>=config.local.maxSpans || total.n>=1000 || total.bytes+bytes>config.local.maxTraceKiB*1024) || written+bytes*(root?2:1)>config.local.maxWriteMiBPerMinute*1048576+65536) {
        dropped++; db.prepare('UPDATE traces SET partial_reason=? WHERE trace_id=?').run('quota',r.traceId);
        continue;
      } else {
        db.prepare('INSERT INTO spans VALUES(?,?,?,?) ON CONFLICT(trace_id,span_id) DO UPDATE SET data=excluded.data,bytes=excluded.bytes').run(r.traceId,r.spanId,text,bytes);
        if(!previous) c.spans++;
        written+=bytes*(root?2:1); c.bytes+=bytes-(previous?.bytes??0);
      }
      if(r.attributes['xopc.partialReason']) db.prepare('UPDATE traces SET partial_reason=? WHERE trace_id=?').run(String(r.attributes['xopc.partialReason']),r.traceId);
      if(root) db.prepare('UPDATE traces SET started_at=?,ended_at=?,status=?,data=?,conversation_id=?,run_id=?,agent_id=? WHERE trace_id=?').run(r.startedAt,r.endedAt??null,r.status,text,r.attributes['xopc.conversationId']??null,r.attributes['xopc.runId']??null,r.attributes['xopc.agentId']??null,r.traceId);
    }
    db.prepare('UPDATE state SET window=?,written=? WHERE id=1').run(minute,written);
  });
  permissions();
  return acceptedEpoch;
}
function list(q) {
  const where=[]; const values=[];
  for(const [key,column] of [['status','status'],['conversationId','conversation_id'],['runId','run_id'],['agentId','agent_id']]) if(q[key]) { where.push(column+'=?'); values.push(q[key]); }
  if(q.from!==undefined) { where.push('started_at>=?'); values.push(q.from); }
  if(q.to!==undefined) { where.push('started_at<?'); values.push(q.to); }
  if(q.cursor) { const [time,id]=q.cursor.split(':'); where.push('(started_at < ? OR (started_at=? AND trace_id<?))'); values.push(Number(time),Number(time),id); }
  const limit=Math.min(100,Math.max(1,q.limit||30));
  const rows=db.prepare('SELECT * FROM traces'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY started_at DESC,trace_id DESC LIMIT ?').all(...values,limit+1);
  const more=rows.length>limit; const page=rows.slice(0,limit);
  return { traces:page.map(row => { const r=JSON.parse(row.data); delete r.attributes['langfuse.observation.input']; delete r.attributes['langfuse.observation.output']; const stats={generations:0,tokens:0,knownCostUsd:0,unknownCostCalls:0}; for(const value of db.prepare('SELECT data FROM spans WHERE trace_id=?').all(row.trace_id)) { const span=JSON.parse(value.data); if(span.type!=='generation') continue; stats.generations++; stats.tokens+=Number(span.attributes['gen_ai.usage.input_tokens']||0)+Number(span.attributes['gen_ai.usage.output_tokens']||0); const cost=span.attributes['langfuse.observation.cost_details']; const total=cost ? JSON.parse(cost).total : undefined; if(typeof total==='number') stats.knownCostUsd+=total; else stats.unknownCostCalls++; } return {...r,partialReason:row.partial_reason,stats}; }), nextCursor:more? page.at(-1).started_at+':'+page.at(-1).trace_id:null };
}
heartbeat(); permissions();
const timer=setInterval(() => { try { heartbeat(); prune(); } catch {} },60000); timer.unref();
parentPort.on('message', msg => {
  try {
    let value;
    if(msg.op==='put') value=put(msg.data.records,msg.data.epoch);
    if(msg.op==='configure') { config=msg.data; limits(); prune(); }
    if(msg.op==='status') value={...counts(),physicalBytes:size(),dropped,paused,lastPruned,epoch:db.prepare('SELECT epoch FROM state WHERE id=1').get().epoch};
    if(msg.op==='list') value=list(msg.data);
    if(msg.op==='detail') {
      const row=db.prepare('SELECT * FROM traces WHERE trace_id=?').get(msg.data);
      value=row? {trace:{...JSON.parse(row.data),partialReason:row.partial_reason},spans:db.prepare('SELECT data FROM spans WHERE trace_id=? ORDER BY json_extract(data,\'$.startedAt\'),span_id LIMIT 1000').all(msg.data).map(x=>JSON.parse(x.data))}:null;
    }
    if(msg.op==='prune') { prune(); value=true; }
    if(msg.op==='clear') { value=transaction(() => { db.exec('DELETE FROM spans; DELETE FROM traces; UPDATE state SET epoch=epoch+1 WHERE id=1'); return db.prepare('SELECT epoch FROM state WHERE id=1').get().epoch; }); prune(); }
    parentPort.postMessage({id:msg.id,value});
  } catch(error) { parentPort.postMessage({id:msg.id,error:'Trace storage operation failed: '+String(error.message).slice(0,200)}); }
});
`;
