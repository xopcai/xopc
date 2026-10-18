import {createServer} from 'node:http';
/** The ledger is evaluator-owned; it never reads agent-authored receipt files. */
export async function createRecoveryService(rows,emit){
 const committed=new Map(rows.slice(0,2).map(r=>[r.id,{...r}]));let transient=false;
 const server=createServer(async(req,res)=>{let status=404,id=null;try{
  if(req.method==='GET'&&req.url==='/state'){status=200;res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({rows:[...committed.values()]}));}
  else if(req.method==='POST'&&req.url==='/rows'){
   const chunks=[];for await(const c of req)chunks.push(c);const row=JSON.parse(Buffer.concat(chunks).toString());id=row.id;
   const expected=rows.find(r=>r.id===id);
   if(!expected||Object.keys(row).length!==2||row.cents!==expected.cents||req.headers['idempotency-key']!==id)status=422;
   else if(committed.has(id))status=409;
   else if(id==='3'&&!transient){transient=true;status=503;}
   else {committed.set(id,{...row});status=201;}
   res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify({id,status}));
  }else{res.writeHead(404);res.end();}
 }catch{status=400;res.writeHead(status);res.end();}finally{await emit('agent.event',{kind:'harness.recovery.request',method:req.method,path:req.url,id,status});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`http://127.0.0.1:${server.address().port}`,async finish(){await new Promise(r=>server.close(r));await emit('agent.event',{kind:'harness.recovery.snapshot',rows:[...committed.values()]});}};
}
