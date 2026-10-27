/** Real embedded main-model turns over the actual Gateway endpoint transport. */
import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { findSessionInput } from '../src/storage/sqlite/session-input-repository.js';
import { randomUUID, createHash } from 'node:crypto';
import { GatewayServer } from '../src/gateway/server.js';
import { openXopcDatabase, closeXopcDatabase } from '../src/storage/sqlite/connection.js';
import { AgentCatalogRepository } from '../src/agent-catalog/repository.js';
import { AgentDefaultsSchema } from '../src/agent-config/index.js';
import { createConversation } from '../src/storage/sqlite/conversation-repository.js';
import { ComputerRuntime } from '../src/computer/runtime.js';
import { createComputerUseTool } from '../src/agent/tools/computer-use-tool.js';
import { computerUseManual } from '../src/agent/tool-manuals/computer.js';
import { runXopcEmbeddedTurn } from '../src/agent/embedded/run-turn.js';
import { InMemoryTranscriptRuntime } from '../src/agent/embedded/transcript-runtime.js';
import { evictAllEmbeddedSessionRunners, drainEmbeddedSessionRunnerShutdowns } from '../src/agent/embedded/session-runner.js';
import { resolveModel } from '../src/providers/index.js';

const root = process.env.XOPC_STATE_DIR!;
const modelRef = 'ui-benchmark/qwen3.5-plus';
const config = JSON.parse(await readFile(join(root, 'xopc.json'), 'utf8'));
openXopcDatabase({ path: join(root, 'xopc.db') });
const catalog = new AgentCatalogRepository();
catalog.ensureInitialized(AgentDefaultsSchema.parse({ models: { chat: { primary: modelRef }, computerUse: { primary: modelRef } } }));
catalog.create({ id: 'paired-ui', workspace: join(root, 'workspace'), toolAllowlist: ['computer_use', 'tool_manual'] } as any, { ready: true });
const gateway = new GatewayServer({ port: config.gateway.port, bindHost: '127.0.0.1', bind: 'loopback', configPath: join(root, 'xopc.json'), enableHotReload: false });
await gateway.start();
if (!(gateway as any).server.listening) await once((gateway as any).server, 'listening');
const service = gateway.serviceInstance;
const runtime = new ComputerRuntime(service.endpointTools, () => service.currentConfig);
const nativeFetch = globalThis.fetch;
let calls: Array<{ headersMs:number; ok:boolean; vision:boolean; kind:'main'|'gui'; usage:unknown }> = [];
let usageReads: Promise<void>[] = [];
globalThis.fetch = async (url, init) => {
  const address = new URL(String(url));
  if (address.hostname !== 'dashscope.aliyuncs.com') return nativeFetch(url, init);
  const started = performance.now();
  const body = String(init?.body ?? '');
  const response = await nativeFetch(url, init);
  let request: any; try {request=JSON.parse(body);}catch{}
  const kind = request?.tools?.some((t:any)=>['computer_proposal','computer_observation'].includes(t.function?.name)) ? 'gui' : 'main';
  const metric: (typeof calls)[number] = {headersMs:performance.now()-started,ok:response.ok,vision:body.includes('data:image/'),kind,usage:null as unknown};
  calls.push(metric);
  usageReads.push(response.clone().text().then(text=>{
    const packets = text.startsWith('data:') ? text.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()) : [text];
    for(const packet of packets){try{const parsed=JSON.parse(packet);if(parsed.usage)metric.usage={inputTokens:parsed.usage.prompt_tokens??parsed.usage.input_tokens??null,outputTokens:parsed.usage.completion_tokens??parsed.usage.output_tokens??null,totalTokens:parsed.usage.total_tokens??null};}catch{}}
  }).catch(()=>{}));
  return response;
};
let running = false;
process.on('message', async (message: any) => {
  try {
    if (message.op === 'status') { process.send?.({ id: message.id, value: { endpoints: service.endpointTools.registry.list() } }); return; }
    if (message.op === 'stop') {
      await runtime.shutdown(); evictAllEmbeddedSessionRunners(); await drainEmbeddedSessionRunnerShutdowns();
      await gateway.stop(); closeXopcDatabase(); process.send?.({ id: message.id, value: true }, () => process.exit(0)); return;
    }
    if (message.op === 'public' && !running) {
      running = true; calls = []; usageReads = [];
      const owner = randomUUID(), clientMessageId = randomUUID();
      const headers = {Authorization:`Bearer ${config.gateway.auth.token}`,'Content-Type':'application/json'};
      const baseUrl = `http://127.0.0.1:${config.gateway.port}`;
      const task = 'Only use computer_use and tool_manual. In XopcInputBenchmark replace Benchmark text with exactly XOPC NETWORK VERIFIED, click Increment exactly once to reach Input count 1, verify both values and close. Use planner:"agent" and exec; do not use step/run or other tools. Await every ui.* call, including emitScreenshot; visual:true already attaches the image. Every exec that acts must first await ui.observe({}) and use that current snapshotId and element refs inside the same exec. Request a final visual:true observation and inspect the screenshot before claiming success. Never copy snapshots between exec calls. Only this disposable app is authorized.';
      const started = performance.now();
      const response = await fetch(`${baseUrl}/api/sessions/${owner}/inputs`, {method:'POST',headers,body:JSON.stringify({
        kind:'start',clientMessageId,creation:{agentId:'paired-ui',projectId:null,execution:null,temporary:true,model:modelRef,thinkingLevel:'off'},
        input:{content:task},origin:message.claim})});
      const accepted: any = await response.json();
      if(response.status !== 202) throw new Error(`PUBLIC_INPUT_${response.status}: ${JSON.stringify(accepted).slice(0,300)}`);
      let pollingRequests = 0;
      for(let n=0;n<180;n++) {
        await delay(1000);
        const polling = await fetch(`${baseUrl}/api/sessions/${owner}/input-state`,{headers});
        if(polling.status !== 200) throw new Error('PUBLIC_STATE_FAILED');
        await polling.json(); pollingRequests++;
        const input = findSessionInput(owner,clientMessageId);
        if(input && ['completed','failed','cancelled','suspended','interrupted'].includes(input.status)) {
          await Promise.allSettled(usageReads);
          running=false;
          process.send?.({id:message.id,value:{mode:'agent',transport:'public-session-input',elapsedMs:performance.now()-started,
            modelRef,ok:input.status==='completed',error:input.error,modelCalls:calls,cost:null,released:true,
            submission:{httpStatus:response.status,pollingRequests,inputStatus:input.status}}});
          return;
        }
      }
      throw new Error('PUBLIC_TURN_TIMEOUT');
    }
    if (message.op !== 'run' || running) throw new Error('PAIR_BUSY');
    running = true; calls = []; usageReads = [];
    const owner = createConversation({ agentId: 'paired-ui', sourceChannel: 'webchat' }, join(root, 'workspace')).key;
    service.endpointTools.bindings.bind(owner, message.endpointId);
    const runId = randomUUID();
    const base = createComputerUseTool({ runtime, context: () => ({ conversationId: owner, runId }) });
    const toolCalls: Array<{ op: string; durationMs: number; ok: boolean; status?: string; errorCode?: string; scriptError?: string; codeHash?: string }> = [];
    const tool = { ...base, async execute(id: string, args: any, ...rest: any[]) {
      const started = performance.now(); let ok = false; let detail: any; process.send?.({progress:{op:args.op}});
      try { if ((message.mode === 'agent' && ['step','run','observe'].includes(args.op)) || (message.mode === 'gui' && args.op === 'exec')) throw new Error('PAIR_WRONG_PLANNER'); const result = await (base.execute as any)(id, args, ...rest); detail = result.details; await appendFile(join(root,'fixture-tool-debug.jsonl'), JSON.stringify({mode:message.mode,args,detail})+'\n',{mode:0o600}); ok = !result.isError && !detail?.errorCode && detail?.status !== 'program_error'; if (!ok) process.send?.({progress:{op:args.op,status:detail?.status,errorCode:detail?.errorCode,scriptError:detail?.scriptError}}); return result; }
      catch (error) { const rawFailure = error instanceof Error ? error.message : String(error); let failure: unknown = rawFailure.slice(0,250); try { const parsed = JSON.parse(rawFailure); detail = {status:parsed.status,errorCode:parsed.errorCode,scriptError:parsed.scriptError}; failure = detail; } catch {} await appendFile(join(root,'fixture-tool-debug.jsonl'), JSON.stringify({mode:message.mode,args,failure})+'\n',{mode:0o600}); process.send?.({progress:{op:args.op,failure}}); throw error; }
      finally { toolCalls.push({ op: args.op, durationMs: performance.now() - started, ok, status:detail?.status,errorCode:detail?.errorCode,scriptError:detail?.scriptError,
        ...(typeof args.code === 'string' ? { codeHash: createHash('sha256').update(args.code).digest('hex') } : {}) }); }
    } };
    const task = 'In XopcInputBenchmark, replace the Benchmark text field with exactly XOPC NETWORK VERIFIED, then click Increment exactly once so Input count becomes 1. Verify both the exact field value and the counter. Do not click Increment again if it already reads 1. Only use this disposable app; close the computer session when finished.';
    const mode = message.mode === 'agent' ? 'agent' : 'gui';
    const instruction = mode === 'agent'
      ? 'Use open with planner:"agent" and exec for UI operations. Write your own UI JavaScript from actual observations. Await every ui.* call, including emitScreenshot; observe({visual:true}) already attaches the image. After any script failure reopen and inspect current state; never replay completed inputs. Request visual:true in an observation so you inspect a real screenshot. Every exec that acts must first await ui.observe({}) and use the returned current snapshotId and element refs in that same exec; never copy snapshot IDs between calls. You may use observed refs from elements directly. Do not call step/run or observe(question).'
      : 'Use open with planner:"gui" and the existing GUI-model run/step path. Do not call exec. Request an independent observe(question) to inspect the final window visually. Supply narrow native expectations to run and verify both requested states.';
    const started = performance.now();
    const result = await runXopcEmbeddedTurn({ conversationId: owner, runId,
      userMessage: { role: 'user', content: `${task}\nBenchmark protocol: ${instruction}`, timestamp: Date.now() }, model: resolveModel(modelRef), modelRef,
      tools: [tool], systemPrompt: `You operate a disposable native benchmark app. Continue routine authorized actions autonomously. Never claim success without actual evidence. ${instruction}\n${computerUseManual}`,
      thinkingLevel: 'off', workspaceDir: join(root, 'workspace'), timeoutMs: Number(process.env.XOPC_PAIR_TIMEOUT_MS ?? 180_000),
      transcriptRuntime: new InMemoryTranscriptRuntime({ runtimeId: owner, cwd: join(root, 'workspace') }),
      isWorkspaceTrusted: () => true });
    const elapsedMs = performance.now() - started;
    await Promise.allSettled(usageReads);
    const closed = await runtime.execute(owner, { op: 'close' });
    const report = runtime.getReport(owner);
    const value = { mode, elapsedMs, modelRef, ok: result.ok, error: result.errorMessage?.slice(0, 150),
      modelCalls: calls, mainModelRequests:calls.filter(c=>c.kind==='main').length, cost:null, toolCalls, report, released: closed.status === 'stopped',
      guiModelRequests: report?.counters.modelRequests ?? 0 };
    evictAllEmbeddedSessionRunners(); await drainEmbeddedSessionRunnerShutdowns(); running = false;
    process.send?.({ id: message.id, value });
  } catch (error) {
    running = false;
    process.send?.({ id: message.id, error: error instanceof Error ? error.message.slice(0, 250) : 'PAIR_GATEWAY_FAILED' });
  }
});
process.send?.({ ready: true });
