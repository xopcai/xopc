import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { candidateGuide, guideRouting } from './conversational-setup-evaluation/guidance.js';
import { grade, scenarios, type Arm, type Call } from './conversational-setup-evaluation/cases.js';

const { values } = parseArgs({ options: {
  worker: { type: 'boolean' }, out: { type: 'string', default: '.xopc-evals/conversational-setup' },
  split: { type: 'string', default: 'development' }, arms: { type: 'string', default: 'baseline,manual,skill,inline' },
  repeats: { type: 'string', default: '1' }, cases: { type: 'string' }, concurrency: { type: 'string', default: '2' },
  'dry-run': { type: 'boolean' },
  'fixture-only': { type: 'boolean' },
  model: { type: 'string', default: 'openai/gpt-5.5' },
} });
const modelRef = values.model;
const out = resolve(values.out);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const sourceHashes = () => Object.fromEntries([
  'scripts/evaluate-conversational-setup.mts', 'scripts/conversational-setup-evaluation/cases.ts',
  'scripts/conversational-setup-evaluation/guidance.ts', 'src/agent/tools/xopc-use-tool.ts',
  'src/agent/tools/skills-tools.ts', 'src/agent/tools/tool-manual-tool.ts',
  'src/agent/prompt/sections/tooling.ts', 'src/agent/embedded/run-turn.ts',
  'src/agent/prompt/system-prompt.ts', 'src/agent/prompt/sections/memory-skills.ts',
].map(path => [path, hash(readFileSync(resolve(path), 'utf8'))]));

if (values.worker) {
  const job = JSON.parse(process.env.XOPC_SETUP_EVAL_JOB!) as { caseId: string; arm: Arm; repeat: number; output: string; baseline: string; fixtureOnly: boolean };
  const scenario = scenarios.find(s => s.id === job.caseId)!;
  if (!scenario) throw new Error('Unknown case');
  const state = mkdtempSync(join(tmpdir(), 'xopc-dialogue-eval-'));
  const workspace = join(state, 'workspace'); mkdirSync(workspace);
  // Share the existing OAuth store and refresh lock, never duplicate refresh tokens.
  process.env.XOPC_CREDENTIALS_DIR ??= join(homedir(), '.xopc', 'credentials');
  process.env.XOPC_STATE_DIR = state;
  process.env.XOPC_WORKSPACE = workspace;
  process.env.XOPC_CONFIG_PATH = join(state, 'xopc.json');
  process.env.XOPC_CONFIG = process.env.XOPC_CONFIG_PATH;
  process.env.XOPC_LOG_DIR = join(state, 'logs');
  process.env.XOPC_LOG_LEVEL = 'fatal';
  process.env.XOPC_LOG_CONSOLE = 'false';
  process.env.XOPC_LOG_FILE = 'false';
  writeFileSync(process.env.XOPC_CONFIG_PATH, '{}', { mode: 0o600 });
  const started = performance.now();
  const result: Record<string, any> = { caseId: scenario.id, split: scenario.split, kind: scenario.kind, arm: job.arm,
    repeat: job.repeat, modelRef, sourceHashes:sourceHashes(), mode: job.fixtureOnly ? 'deterministic-harness-check' : 'real-model', state, calls: [], reply: '', requests: 0, input: 0, output: 0, cacheRead: 0, costUsd: 0 };
  let close: (()=>void) | undefined;
  let stop: (()=>Promise<void>) | undefined;
  try {
    await import('../src/infra/http-proxy-env.js');
    const { openXopcDatabase, closeXopcDatabase } = await import('../src/storage/sqlite/connection.js');
    const { AgentCatalogRepository } = await import('../src/agent-catalog/repository.js');
    const { AgentDefaultsSchema } = await import('../src/agent-config/schema.js');
    const { createConversation } = await import('../src/storage/sqlite/conversation-repository.js');
    const { AutomationService } = await import('../src/automations/index.js');
    const { createXopcUseTool } = await import('../src/agent/tools/xopc-use-tool.js');
    const { createToolManualTool } = await import('../src/agent/tools/tool-manual-tool.js');
    const { createSkillViewTool } = await import('../src/agent/tools/skills-tools.js');
    const { formatSkillsForPrompt } = await import('../src/agent/skills/format-skills-prompt.js');
    const { buildSystemPrompt } = await import('../src/agent/prompt/system-prompt.js');
    const { resolveModel } = await import('../src/providers/index.js');
    const { runXopcEmbeddedTurn } = await import('../src/agent/embedded/run-turn.js');
    const { InMemoryTranscriptRuntime } = await import('../src/agent/embedded/transcript-runtime.js');
    const { evictAllEmbeddedSessionRunners, drainEmbeddedSessionRunnerShutdowns } = await import('../src/agent/embedded/session-runner.js');
    const { createAgentTurnPolicy } = await import('../src/agent/orchestration/agent-turn-policy.js');
    const { Type } = await import('@sinclair/typebox');
    openXopcDatabase({ path: join(state, 'xopc.db') }); close = closeXopcDatabase;
    const repository = new AgentCatalogRepository();
    const defaults = AgentDefaultsSchema.parse({ models: { chat: { primary: 'openai/gpt-5.4', fallbacks: [] }, intents: {} } });
    repository.ensureInitialized(defaults);
    const original = repository.get('main')!;
    repository.update('main', original.revision, { id: 'main', enabled: true, workspace,
      profile: { name: 'Ada', description: '原有简介', language: 'zh-CN', style: '简洁' } });
    repository.markProvisioned('main');
    repository.create({ id: 'coder', enabled: true, profile: { name: 'Coder' }, models: { chat: { primary: 'openai/gpt-5.4', fallbacks: [] } } }, { ready: true });
    if (scenario.kind === 'duplicate') repository.create({ id: 'xiaomei', enabled: true, profile: { name: '小美' } }, { ready: true });
    const conversationId = randomUUID();
    createConversation({ agentId: 'main', sourceChannel: 'webchat', name: 'Synthetic evaluation' }, state, conversationId);
    const automation = new AutomationService(); await automation.initialize(); stop = () => automation.stop();
    const seed = (name: string) => automation.create({ name, enabled: true, trigger: { kind: 'manual' }, action: { kind: 'agent', instruction: 'Synthetic fixture; no external action.' }, conversationMode: 'new_session', delivery: { notificationPolicy: 'none', destinations: [] } });
    await seed('每日工作总结'); await seed('其他日程');
    const baselineDefaults = JSON.stringify(repository.getSettings().defaults);
    const baseTool = createXopcUseTool({ getCurrentAgentId: () => 'main', getCurrentConversationId: () => conversationId,
      getWorkspace: () => workspace, getAutomationService: () => automation, authorizeCapability: () => true });
    const baseManual = createToolManualTool();
    // Freeze the original manual so subsequent shipping changes cannot alter the baseline.
    const baselineManual = readFileSync(job.baseline, 'utf8');
    const manual = { ...baseManual,
      parameters: job.arm === 'manual' ? Type.Object({ tool: Type.String(), topic: Type.Optional(Type.String()) }) : baseManual.parameters,
      description: baseManual.description + (job.arm === 'manual' ? ' xopc_use topic guide covers conversational configuration, scope, voice and automation workflows.' : ''),
      async execute(id: string, args: {tool:string;topic?:string}, signal?: AbortSignal) {
        if (args.tool === 'xopc_use') return { content: [{ type: 'text' as const, text: job.arm === 'manual' && args.topic === 'guide' ? candidateGuide : baselineManual }], details: {} };
        return baseManual.execute(id, { tool: args.tool }, signal, undefined as never);
      },
    };
    const skillDir = join(state, 'eval-skill'); mkdirSync(skillDir);
    const description = 'Help users configure and use xopc through conversation: change Agent settings, inspect capabilities, set up voice or automations. Do not use for ordinary writing or coding.';
    const content = `---\nname: xopc-guide\ndescription: ${description}\n---\n\n${candidateGuide}`;
    writeFileSync(join(skillDir, 'SKILL.md'), content);
    const skill = { name: 'xopc-guide', description, filePath: join(skillDir, 'SKILL.md'), baseDir: skillDir,
      source: 'builtin' as const, origin: { kind: 'builtin' } as any, disableModelInvocation: false, metadata: { name:'xopc-guide',description }, content };
    // Actual skill_view validation, path handling and on-demand file reading; isolated index only.
    const manager = { findSkill: (name: string) => name === skill.name ? skill : undefined,
      getEnabledSkillsForAgentSession: () => [skill] };
    const skillTool = createSkillViewTool({ getSkillManager: () => manager as any });
    let injected = false;
    const track = (tool: any) => ({ ...tool, async execute(id: string, args: any, signal: AbortSignal, update: any) {
      if (tool.name === 'xopc_use' && scenario.kind === 'conflict' && args.mode === 'agent' && args.command === 'update' && !injected) {
        injected = true;
        const latest = repository.get('main')!;
        repository.update('main', latest.revision, { id: latest.id, enabled: latest.enabled, workspace: latest.workspace,
          profile: { ...latest.profile, description: '用户同时更新的简介' } });
      }
      const receipt = await tool.execute(id,args,signal,update);
      const text = receipt.content.filter((c: any)=>c.type==='text').map((c: any)=>c.text).join('\n');
      (result.calls as Call[]).push({name:tool.name,args,ok:!text.startsWith('Error:') && !(receipt.details as any)?.errorCode,result:text});
      return receipt;
    } });
    const tools = [baseTool,manual,...(job.arm==='skill'?[skillTool]:[])].map(track);
    const routing = job.arm === 'manual' ? '\n'+guideRouting : job.arm === 'inline' ? '\n'+candidateGuide : job.arm==='skill'
      ? formatSkillsForPrompt([skill],undefined,{registeredToolNames:tools.map(t=>t.name)}) : '';
    const systemPrompt = buildSystemPrompt(workspace, { agentId:'main', toolNames:tools.map(t=>t.name),
      runtime:{version:'evaluation',model:modelRef,agentId:'main',channel:'webchat',thinkingLevel:'low'},
      userTimezone:'Asia/Shanghai',agentProfile:{name:'Ada',description:'原有简介',language:'zh-CN',style:'简洁'},
      extraSystemPrompt:routing });
    const model = resolveModel(modelRef);
    const fixture = async () => {
      if (scenario.kind !== 'negative' && ['manual', 'skill'].includes(job.arm)) {
        const guideTool = tools.find(tool => tool.name === (job.arm === 'manual' ? 'tool_manual' : 'skill_view'))!;
        const loaded = await guideTool.execute(randomUUID(), job.arm === 'manual' ? { tool: 'xopc_use', topic: 'guide' } : { name: 'xopc-guide' }, new AbortController().signal, undefined);
        if (!JSON.stringify(loaded).includes('Conversational xopc configuration and use')) throw new Error('Candidate guide did not load');
      }
      const use = async (mode: string, command: string, args: Record<string,unknown> = {}) => {
        const receipt=await tools[0].execute(randomUUID(),{mode,command,args},new AbortController().signal,undefined);
        return receipt.content.filter((c:any)=>c.type==='text').map((c:any)=>c.text).join('\n');
      };
      if(['rename','conflict','model'].includes(scenario.kind)) {
        await use('agent','get',{id:'main'});
        let latest=repository.get('main')!;
        const patch=()=>scenario.kind==='model'?{models:{chat:{primary:'openai/gpt-5.5',fallbacks:[]}}}:{profile:{...latest.profile,name:'小舟'}};
        const first=await use('agent','update',{id:'main',expectedRevision:latest.revision,patch:patch(),idempotencyKey:'first'});
        if(first.startsWith('Error:')) {await use('agent','get',{id:'main'});latest=repository.get('main')!;await use('agent','update',{id:'main',expectedRevision:latest.revision,patch:patch(),idempotencyKey:'retry'});}
      } else if(scenario.kind==='create') {await use('agent','list');await use('agent','create',{id:'xiaomei',profile:{name:'小美',style:'温柔亲切',language:'zh-CN'}});}
      else if(scenario.kind==='default') {await use('agent','list');await use('agent','set_default',{id:'coder',expectedRevision:repository.getSettings().revision});}
      else if(scenario.kind==='duplicate') await use('agent','list');
      else if(scenario.kind==='pause') {await use('automation','list');const a=(await automation.list()).find(a=>a.name==='每日工作总结')!;await use('automation','pause',{automationId:a.id,expectedRevision:a.updatedAtMs,idempotencyKey:'pause'});}
      else if(scenario.kind==='draft') await use('automation','create',{name:'阅读提醒',enabled:false,trigger:{kind:'schedule',schedule:{kind:'cron',expr:'0 9 * * *',tz:'Asia/Shanghai'}},action:{kind:'agent',instruction:'提醒我读书'},delivery:{notificationPolicy:'attention',destinations:[]}});
      else if(scenario.kind==='voice') await use('settings','open',{section:'capabilities/voice',title:'语音设置'});
      else if(scenario.kind==='capabilities') await use('agent','get',{id:'main'});
      const text=scenario.kind==='voice'?'还需要设备权限和实际录音测试。':scenario.kind==='gmail'?'没有邮箱连接工具，无法完成真实读取，需要先连接授权。':scenario.kind==='capabilities'?'当前模型配置已读取，联网、看图、语音实际状态无法确认，尚未验证。':'完成。';
      return {ok:true,lastAssistantText:text};
    };
    const outcome = job.fixtureOnly ? await fixture() : await runXopcEmbeddedTurn({ conversationId, runId: randomUUID(), model: {...model,maxTokens:4096}, modelRef,
      tools, workspaceDir:workspace, transcriptRuntime:new InMemoryTranscriptRuntime({runtimeId:conversationId,cwd:workspace}),
      thinkingLevel:'low',timeoutMs:150_000,abortSignal:AbortSignal.timeout(150_000),systemPrompt,
      userMessage:{role:'user',content:scenario.prompt,timestamp:Date.now()},requireVisibleReply:true,
      turnPolicy:createAgentTurnPolicy({maxTurns:10,maxToolFailures:4}),
      onEvent(event) {
        if(event.type==='message_end' && event.message.role==='assistant') {
          const usage=event.message.usage;
          result.requests++; result.input+=usage.input;result.output+=usage.output;result.cacheRead+=usage.cacheRead;result.costUsd+=usage.cost.total;
        }
      },
    });
    result.outcome = outcome; result.reply = outcome.lastAssistantText ?? '';
    result.agents = repository.list(); result.defaultAgentId=repository.getSettings().defaultAgentId;
    result.defaults=repository.getSettings().defaults;
    result.automations=await automation.list();
    result.checks=grade(scenario,result as any);
    result.checks.globalDefaultsPreserved=JSON.stringify(result.defaults)===baselineDefaults;
    result.passed=outcome.ok && Object.values(result.checks).every(Boolean);
    evictAllEmbeddedSessionRunners(); await drainEmbeddedSessionRunnerShutdowns();
  } catch(error) { result.error=error instanceof Error ? error.message : String(error);result.passed=false; }
  finally {
    await stop?.(); close?.(); result.sourceChangedDuringRun=JSON.stringify(result.sourceHashes)!==JSON.stringify(sourceHashes());
    result.elapsedMs=Math.round(performance.now()-started); write(job.output,result);
  }
  console.log(JSON.stringify({caseId:scenario.id,arm:job.arm,passed:result.passed,error:result.error,requests:result.requests,elapsedMs:result.elapsedMs}));
  process.exit(result.error ? 2 : 0);
} else {
  if (process.env.XOPC_SETUP_EVAL_LIVE !== '1' && !values['dry-run'] && !values['fixture-only']) throw new Error('Set XOPC_SETUP_EVAL_LIVE=1 for authorized GPT-5.5 usage');
  const arms=values.arms.split(',') as Arm[];
  if(!arms.length || arms.some(a=>!['baseline','manual','skill','inline'].includes(a)))throw new Error('Unknown arm');
  const repeats=Number(values.repeats), concurrency=Number(values.concurrency);
  if(!Number.isInteger(repeats)||repeats<1||repeats>3||!Number.isInteger(concurrency)||concurrency<1||concurrency>3)throw new Error('Invalid repeats/concurrency');
  const selected=scenarios.filter(s=>s.split===values.split && (!values.cases || values.cases.split(',').includes(s.id)));
  if(!selected.length)throw new Error('No matching cases');
  mkdirSync(out,{recursive:true});
  const {xopcUseManual}=await import('../src/agent/tool-manuals/xopc-use.js');
  const baseline=join(out,'baseline-manual.md');
  if(!existsSync(baseline))writeFileSync(baseline,xopcUseManual);
  const jobs=Array.from({length:repeats},(_,repeat)=>selected.flatMap((s,i)=>arms.map((_,j)=>({caseId:s.id,arm:arms[(i+repeat+j)%arms.length],repeat:repeat+1,output:join(out,`${s.id}-${repeat+1}-${arms[(i+repeat+j)%arms.length]}.json`),baseline,fixtureOnly:Boolean(values['fixture-only'])})))).flat();
  const manifest={version:3,modelRef,agent:'main',prompt:'production-buildSystemPrompt-including-skill-selection',mode:values['fixture-only']?'deterministic-harness-check':'real-model',thinking:'low',maxTokens:4096,arms,repeats,caseIds:selected.map(s=>s.id),
    caseHash:hash(JSON.stringify(scenarios)),guideHash:hash(candidateGuide),baselineHash:hash(readFileSync(baseline,'utf8')),
    harnessHash:hash(readFileSync(import.meta.filename,'utf8')),
    sourceHashes:sourceHashes(),
    protocol:'Fresh child process/database/workspace per sample; rotating arm order; identical scenario assertions. Real model and product tools. External email/audio deliberately unavailable.',
    selection:'Rank development arms by complete scenario passes, then fewer failed assertions, then median input+cacheRead tokens. Evaluate top two on untouched holdout twice. Do not remove failed model trials.',
    infrastructureRetry:'At most one fresh-process retry, only for transient provider/network failures before any tool execution. Preserve both immutable attempt receipts; never retry a failed product assertion or an uncertain write. Include exhausted failures in logical sample ranking.',
    jobs:jobs.length};
  const manifestPath=join(out,'manifest.json');
  if(existsSync(manifestPath) && JSON.stringify(JSON.parse(readFileSync(manifestPath,'utf8')))!==JSON.stringify(manifest))throw new Error('Manifest changed: choose a new directory');
  write(manifestPath,manifest);
  if(values['dry-run']){console.log(JSON.stringify(manifest));process.exit(0);}
  const summarize=()=>{
    const rows=jobs.filter(j=>existsSync(j.output)).map(j=>JSON.parse(readFileSync(j.output,'utf8')));
    const median=(x:number[])=>x.length?[...x].sort((a,b)=>a-b)[Math.floor(x.length/2)]:null;
    const groups=Object.fromEntries(arms.map(arm=>{const group=rows.filter(r=>r.arm===arm);return [arm,{total:group.length,passed:group.filter(r=>r.passed).length,
      failedChecks:group.reduce((n,r)=>n+Object.values(r.checks??{}).filter(v=>!v).length,0),errors:group.filter(r=>r.error||r.outcome?.errorMessage).length,
      medianMs:median(group.map(r=>r.elapsedMs)),medianInputTokens:median(group.map(r=>r.input+r.cacheRead)),requests:group.reduce((n,r)=>n+r.requests,0),
      physicalAttempts:group.reduce((n,r)=>n+(r.attempts?.length??1),0),
      guideLoads:group.filter(r=>r.calls.some((c:Call)=>c.name==='skill_view'||c.name==='tool_manual'&&c.args.topic==='guide')).length}];}));
    const paired=Object.fromEntries(arms.flatMap((a,i)=>arms.slice(i+1).map(b=>{let wins=0,losses=0,ties=0;for(const test of selected)for(let repeat=1;repeat<=repeats;repeat++){
      const x=rows.find(r=>r.caseId===test.id&&r.repeat===repeat&&r.arm===a),y=rows.find(r=>r.caseId===test.id&&r.repeat===repeat&&r.arm===b);if(!x||!y)continue;
      if(x.passed&&!y.passed)wins++;else if(!x.passed&&y.passed)losses++;else ties++;
    }return [`${a}:${b}`,{wins,losses,ties}];})));
    const fatalProvider=(r:any)=>r.error||/not supported|unauthorized|credentials|quota|rate limit|401|403/i.test(r.outcome?.errorMessage??'');
    const modelUnavailable=rows.some(fatalProvider);
    const sourceChanged=rows.some(r=>r.sourceChangedDuringRun||JSON.stringify(r.sourceHashes)!==JSON.stringify(manifest.sourceHashes));
    const ranking=Object.entries(groups).sort(([,a],[,b])=>b.passed-a.passed||a.failedChecks-b.failedChecks||(a.medianInputTokens??Infinity)-(b.medianInputTokens??Infinity)).map(([arm])=>arm);
    write(join(out,'summary.json'),{manifest,status:sourceChanged?'source_changed':modelUnavailable?'infrastructure_blocked':rows.length===jobs.length?'completed':'incomplete',completed:rows.length,groups,paired,
      ranking:rows.length===jobs.length&&!modelUnavailable&&!sourceChanged&&!values['fixture-only']?ranking:[],
      failures:rows.filter(r=>!r.passed).map(r=>({caseId:r.caseId,arm:r.arm,repeat:r.repeat,error:r.error??r.outcome?.errorMessage,checks:r.checks,reply:r.reply})),limitations:['Small sample; descriptive comparison, not population-level significance.','Real configured model, embedded agent loop and SQLite product mutations; no real OAuth login flow, microphone or mailbox.','Human reply quality requires review; regex checks are bounded proxies.','Listed USD costs use catalog estimates, not account billing.']});
    return {completed:rows.length,groups};
  };
  let cursor=0,stop=false;
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(!stop && cursor<jobs.length){const job=jobs[cursor++];if(existsSync(job.output))continue;
      console.log(JSON.stringify({stage:'start',caseId:job.caseId,arm:job.arm,repeat:job.repeat}));
      const attempts:any[]=[];
      for(let attempt=1;attempt<=2;attempt++) {
        const attemptJob={...job,output:job.output.replace(/\.json$/,`-attempt${attempt}.json`)};
        if(!existsSync(attemptJob.output)) {
          const code=await new Promise<number|null>((done,reject)=>{const child=spawn(process.execPath,['--import','tsx',import.meta.filename,'--worker','--model',modelRef],{
            env:{...process.env,XOPC_SETUP_EVAL_JOB:JSON.stringify(attemptJob)},stdio:['ignore','inherit','inherit']});
            const timer=setTimeout(()=>child.kill('SIGTERM'),210_000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);done(code);});});
          if(!existsSync(attemptJob.output))write(attemptJob.output,{...attemptJob,passed:false,error:`Worker exited ${code} without a receipt`,calls:[],requests:0,input:0,cacheRead:0,elapsedMs:210000});
        }
        const receipt=JSON.parse(readFileSync(attemptJob.output,'utf8'));attempts.push({...receipt,outputPath:attemptJob.output});
        const transient=receipt.outcome?.terminationReason==='provider_error'&&/connection error|timed out|fetch failed|ECONNRESET|502|503/i.test(receipt.outcome?.errorMessage??'')&&!receipt.calls.length;
        if(!transient||attempt===2)break;
        console.log(JSON.stringify({stage:'infrastructure_retry',caseId:job.caseId,arm:job.arm,attempt}));
      }
      const row={...attempts.at(-1),attempts:attempts.map(r=>({path:r.outputPath,passed:r.passed,error:r.error??r.outcome?.errorMessage,toolCalls:r.calls.length})),
        elapsedMs:attempts.reduce((n,r)=>n+r.elapsedMs,0),input:attempts.reduce((n,r)=>n+r.input,0),output:attempts.reduce((n,r)=>n+r.output,0),
        cacheRead:attempts.reduce((n,r)=>n+r.cacheRead,0),requests:attempts.reduce((n,r)=>n+r.requests,0)};
      write(job.output,row);
      if(row.error||/not supported|unauthorized|credentials|quota|rate limit|401|403/i.test(row.outcome?.errorMessage??''))stop=true;
      console.log(JSON.stringify({stage:'progress',...summarize()}));
    }
  }));
  console.log(JSON.stringify({stage:'finished',...summarize()}));
}
