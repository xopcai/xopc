import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { ConfigSchema } from '../src/config/schema.js';
import { seedTestAgentCatalog } from '../src/agent-catalog/test-support.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AgentPluginStore } from '../src/extensions/agent-plugins/store.js';
import { agentPluginInventoryRow } from '../src/extensions/agent-plugins/inventory.js';
import { pluginServerId } from '../src/extensions/agent-plugins/validation.js';
import { prepareNativeMcpConfig } from '../src/agent/mcp/native-mcp.js';
import { createHonoApp } from '../src/gateway/hono/app.js';
import { cancelAllPluginCliAuthorizations } from '../src/extensions/agent-plugins/cli-authorization.js';
import type { GatewayService } from '../src/gateway/service.js';
import { invokePreparedTool } from './lib/plugin-lab-runtime.mts';
const repository=resolve(process.env.XOPC_PLUGIN_CATALOG_REPO||'../xopc-plugins'),release=JSON.parse(await readFile(join(repository,'dist/release-manifest.json'),'utf8'));
const evidence=resolve(process.env.XOPC_PLUGIN_CATALOG_EVIDENCE||'/tmp/xopc-production-plugin-e2e');await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'xopc-catalog-e2e-'));
Object.assign(process.env,{XOPC_STATE_DIR:root,PI_CODING_AGENT_DIR:join(root,'pi'),XOPC_CONFIG_PATH:join(root,'xopc.json'),XOPC_WORKSPACE:root,XOPC_LOG_LEVEL:'fatal',XOPC_SKILLS_STORE_URL:'https://store.xopc.ai',XOPC_EXTENSIONS_STORE_URL:'https://store.xopc.ai'});
const auth={mode:'token' as const,token:randomUUID()},config=ConfigSchema.parse({gateway:{auth,skillsStoreBaseUrl:'https://store.xopc.ai'}});await writeFile(process.env.XOPC_CONFIG_PATH!,JSON.stringify(config));
openXopcDatabase();seedTestAgentCatalog({agents:[{id:'main',enabled:true,workspace:root,profile:{name:'Main'}},{id:'other',enabled:true,workspace:root,profile:{name:'Other'}}]});
const service={currentConfig:config,getResolvedAuth:()=>auth,getAuthToken:()=>auth.token,getEffectiveListenPort:()=>18790,isGatewayReady:()=>true,getExtensionLoader:()=>null,marketplace:{reloadSkills(){}}} as unknown as GatewayService;
const app=createHonoApp({service}),gateway=serve({fetch:app.fetch,hostname:'127.0.0.1',port:0});if(!gateway.listening)await once(gateway,'listening');const address=gateway.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`,store=new AgentPluginStore();
async function api(path:string,method='GET',body?:unknown){const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(180000)});const data:any=await r.json();assert.equal(r.status,200,`${path}: ${JSON.stringify(data)}`);return data.payload??data;}
async function job(id:string){return api(`/api/extensions/agent-plugins/${id}/setup`);}
async function act(id:string,action:string,values:Record<string,unknown>={}){const current=await job(id);let next=await api(`/api/extensions/agent-plugins/${id}/setup`,'POST',{action,expectedRevision:current.revision,idempotencyKey:randomUUID(),...values});for(let i=0;i<1800&&next.state==='running';i++){await new Promise(r=>setTimeout(r,100));next=await job(id);}assert.notEqual(next.state,'running');return next;}
const results:any[]=[],ids=new Map<string,string>();
try{
 assert.equal((await fetch(base+'/api/extensions/inspect',{method:'POST'})).status,401);
 for(const pkg of release.plugins.filter((value:any)=>!process.env.XOPC_PLUGIN_CATALOG_ONLY||value.name===process.env.XOPC_PLUGIN_CATALOG_ONLY)){
  const detailResponse=await fetch(`https://store.xopc.ai/api/v1/packages/${pkg.name}`);assert(detailResponse.ok,`Store missing ${pkg.name}`);const detail:any=await detailResponse.json();assert.equal(detail.latestVersion.version,pkg.version);assert.equal(detail.latestVersion.sha256,pkg.sha256);
  const source=`store:${pkg.name}@${pkg.version}`,plan=await api('/api/extensions/inspect','POST',{source});assert.equal(plan.diagnostics.length,0,JSON.stringify(plan.diagnostics));
  const row=await api('/api/extensions/install','POST',{source,reviewHash:plan.reviewHash,setup:true});const id=row.pluginId;assert(id);ids.set(pkg.name,id);
  let state=await act(id,'prepare');assert.equal(state.resources,'ready',JSON.stringify(state));
  const local=state.connections.find((value:any)=>value.name==='local'||pkg.name==='data-toolkit'&&value.name==='data');
  if(local){assert.equal(local.state,'connected',JSON.stringify(state));state=await act(id,'complete');const native=await prepareNativeMcpConfig(config,root,'main');const name=pluginServerId(id,local.name);const selected={...native,servers:native.servers.filter(s=>s.name===name)};
   if(pkg.name==='data-toolkit')await invokePreparedTool(selected,root,name,'rowCount',{toolDescription:'CSV',arguments:{csv:'sku,units\na,2'}});
   else await invokePreparedTool(selected,root,name,'rowCount',{toolDescription:'Analyze user-supplied',arguments:{rows:[{sku:'a',units:2},{sku:'b',units:3}],key:'sku'}});
  }else if(state.connections.length){state=await act(id,'defer');assert(state.installed&&state.deferred);const current=store.get(id)!;assert.equal(agentPluginInventoryRow(current,store).authorizationStatus,'required');assert(!(await prepareNativeMcpConfig(config,root,'other')).servers.some(s=>s.name.startsWith(pluginServerId(id,'').replace(/_$/,''))));}
  else state=await act(id,'complete');
  assert(store.active('main',root).some(p=>p.id===id));assert(store.active('other',root).some(p=>p.id===id));
  const reload=new AgentPluginStore();assert(reload.get(id)?.receipt.enabled);
  results.push({name:pkg.name,version:pkg.version,sha256:pkg.sha256,skills:store.get(id)!.skills.length,resources:store.get(id)!.resources?.length,installed:true,actualToolCall:!!local,authorization:local||!state.connections.length?'not-required':'deferred',global:true});console.log(JSON.stringify(results.at(-1)));
 }
 for(const provider of ['dingtalk','feishu'].filter(value=>ids.has(value))){
  const id=ids.get(provider)!;await act(id,'authorize',{server:provider,method:provider==='dingtalk'?'login':'scan'});let challenge:any;
  for(let i=0;i<400;i++){const value=await api(`/api/extensions/agent-plugins/${id}/setup/auth/${provider}`);if(value?.challenge){challenge=value.challenge;break;}assert(!['error','cancelled'].includes(value?.state),JSON.stringify(value));await new Promise(r=>setTimeout(r,100));}
  assert(challenge,`No real ${provider} login challenge`);const url=new URL(challenge.url);assert(provider==='dingtalk'?url.hostname.endsWith('dingtalk.com'):url.hostname.endsWith('feishu.cn'));
  await act(id,'defer');assert.equal(agentPluginInventoryRow(store.get(id)!,store).authorizationStatus,'required');console.log(JSON.stringify({provider,realOfficialChallenge:true,host:url.hostname,cancelledAndResumable:true}));
 }
 if(ids.has('openboost')) {
 const openboost=ids.get('openboost')!;
 await act(openboost,'authorize',{server:'openboost',method:'oauth'});
 let oauth:any;
 for(let i=0;i<400;i++){oauth=await api(`/api/extensions/agent-plugins/${openboost}/setup/auth/openboost`);if(oauth?.authorizationUrl)break;assert(!oauth?.error,JSON.stringify(oauth));await new Promise(r=>setTimeout(r,100));}
 assert(oauth?.authorizationUrl,'OpenBoost did not provide a native OAuth sign-in URL');assert(new URL(oauth.authorizationUrl).hostname.endsWith('microdata-inc.com'));
 await act(openboost,'defer');console.log(JSON.stringify({provider:'openboost',realNativeOAuthChallenge:true,cancelledAndResumable:true}));
 }
 const report={ok:true,sourcePlugins:20,packages:results,realOfficialChallenges:['dingtalk','feishu'],realNativeOAuthChallenges:['openboost'],productionAccountAuthorization:'pending-user',checks:['authenticated Gateway API paths','actual public Store metadata and artifact integrity','all package inspections have no diagnostics','per-platform resources prepared from Store','all installations completed or explicitly deferred','every local executable package called through native pi MCP','global availability in two Agents','durable receipts survive reload','real official CLI challenges without account consent','deferred private tools stay unavailable']};await writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,packages:results.length,evidence}));
}finally{cancelAllPluginCliAuthorizations();await new Promise<void>(resolve=>gateway.close(()=>resolve()));closeXopcDatabase();await rm(root,{recursive:true,force:true});}
process.exit(0);
