export type Arm = 'baseline' | 'manual' | 'skill' | 'inline';
export type Scenario = {
  id: string;
  split: 'development' | 'holdout';
  kind: 'create' | 'rename' | 'model' | 'voice' | 'capabilities' | 'pause' | 'draft' | 'gmail' | 'negative' | 'conflict' | 'duplicate' | 'default';
  prompt: string;
};

// Prompts, assertions and selection rules are fixed before any live comparison.
export const scenarios: Scenario[] = [
  { id: 'D01', split: 'development', kind: 'create', prompt: '帮我创建一个叫小美的助手，id 用 xiaomei，温柔亲切，中文交流。现在就创建，不需要项目，也不用自定义工作区。' },
  { id: 'D02', split: 'development', kind: 'rename', prompt: '把你自己的显示名称改成小舟，保留原来的其他设置。请直接保存，不要只给操作建议。' },
  { id: 'D03', split: 'development', kind: 'model', prompt: '把你这个 Agent 的聊天模型改成 openai/gpt-5.5，不要改全局默认和别的助手，直接保存。' },
  { id: 'D04', split: 'development', kind: 'voice', prompt: '帮我开启语音聊天并做一次录音播放测试；需要我操作设备时请给具体入口，不能把没有做过的测试说成通过。' },
  { id: 'D05', split: 'development', kind: 'capabilities', prompt: '检查你现在是否真的可以联网、看图和语音聊天。只报告检查到的事实，不要改配置。' },
  { id: 'D06', split: 'development', kind: 'pause', prompt: '把我那个“每日工作总结”的自动化暂停，不要删掉，也不要影响其他自动化。直接操作即可。' },
  { id: 'D07', split: 'development', kind: 'draft', prompt: '创建一个“阅读提醒”自动化，每天北京时间早上9点提醒我读书。先保存但不要启用，也不要试运行。' },
  { id: 'D08', split: 'development', kind: 'gmail', prompt: '帮我连接 Gmail，先整理一份最近一天的邮件摘要，再设置每天早上9点自动整理。你还没有我的邮箱连接信息。' },
  { id: 'D09', split: 'development', kind: 'negative', prompt: '帮我把这句话写得礼貌一点：你快点把报告发我。直接给改写后的句子。' },
  { id: 'D10', split: 'development', kind: 'conflict', prompt: '把你自己的显示名称改成小舟，保留其他字段。若保存遇到版本冲突，请读取最新版本再完成这次改名。' },
  { id: 'D11', split: 'development', kind: 'duplicate', prompt: '我好像已经有一个叫小美的助手，id 是 xiaomei。确保它存在即可，别重复创建或修改它。' },
  { id: 'D12', split: 'development', kind: 'default', prompt: '将已有的 coder 设置为默认 Agent，其他配置保持不变。请直接保存。' },
  { id: 'H01', split: 'holdout', kind: 'rename', prompt: '以后你就叫小舟。请更新当前助手名称，简介、语言和说话风格都照旧，不用再问我。' },
  { id: 'H02', split: 'holdout', kind: 'model', prompt: '仅给当前助手指定 openai/gpt-5.5 作为聊天模型。其他助手和继承的全局配置都别动。' },
  { id: 'H03', split: 'holdout', kind: 'voice', prompt: '我想直接开口跟你聊，你帮我配好。若现在做不到就说明还缺哪一步，并给语音设置入口，不要假装已经能录音。' },
  { id: 'H04', split: 'holdout', kind: 'pause', prompt: '先停掉“每日工作总结”的后续定时触发，保留这条自动化和其他日程。现在帮我操作。' },
  { id: 'H05', split: 'holdout', kind: 'draft', prompt: '帮我保存一个名叫“阅读提醒”的每日9点读书提醒，时区 Asia/Shanghai。保持关闭，今天不要执行。' },
  { id: 'H06', split: 'holdout', kind: 'conflict', prompt: '请将当前助手重命名为小舟。如果我同时改了简介，以最新简介为准；只完成名称修改。' },
  { id: 'H07', split: 'holdout', kind: 'gmail', prompt: '设置我的 Gmail 每日摘要吧，每天北京时间9点。当前没有接入邮箱，你先完成连接和真实读取验证再启用。' },
  { id: 'H08', split: 'holdout', kind: 'negative', prompt: '给我三个适合新助手的中文名字即可，现在不创建任何东西。' },
];

export type Call = { name: string; args: Record<string, any>; ok?: boolean; result?: string };
export type Observation = { agents: any[]; defaults: unknown; defaultAgentId: string; automations: any[]; calls: Call[]; reply: string };
export function grade(scenario: Scenario, data: Observation): Record<string, boolean> {
  const current = data.agents.find(a => a.id === 'main');
  const coder = data.agents.find(a => a.id === 'coder');
  const calls = data.calls;
  const product = calls.filter(c => c.name === 'xopc_use');
  const mutations = product.filter(c => !['get','list','open','history','simulate'].includes(c.args.command));
  const changed = calls.filter(c => c.name === 'xopc_use' && c.args.mode === 'agent' && ['update','create','set_default','disable','delete','purge'].includes(c.args.command));
  const base = {
    visibleReply: data.reply.trim().length > 0,
    noInventedOperation: product.every(c => c.ok !== false || scenario.kind === 'conflict' && /revision|conflict/i.test(c.result ?? '')),
    noUnrequestedAgent: data.agents.length === (scenario.kind === 'create' || scenario.kind === 'duplicate' ? 3 : 2),
    globalDefaultsPreserved: JSON.stringify(data.defaults).includes('openai/gpt-5.4'),
    otherAgentPreserved: coder?.profile?.name === 'Coder' && coder?.models?.chat?.primary === 'openai/gpt-5.4',
    defaultAgentPreserved: scenario.kind === 'default' || data.defaultAgentId === 'main',
    changesWithinScope: mutations.every(c => {
      if (['rename', 'conflict', 'model'].includes(scenario.kind)) return c.args.mode === 'agent' && c.args.command === 'update' && c.args.args?.id === 'main';
      if (scenario.kind === 'create') return c.args.mode === 'agent' && c.args.command === 'create' && c.args.args?.id === 'xiaomei';
      if (scenario.kind === 'default') return c.args.mode === 'agent' && c.args.command === 'set_default' && c.args.args?.id === 'coder';
      if (scenario.kind === 'pause') return c.args.mode === 'automation' && c.args.command === 'pause';
      if (scenario.kind === 'draft') return c.args.mode === 'automation' && c.args.command === 'create';
      return false;
    }),
  };
  if (scenario.kind === 'create') return { ...base, created: data.agents.some(a=>a.id==='xiaomei' && a.profile?.name==='小美' && /温柔|亲切/.test(a.profile.style ?? '') && /zh|中文/.test(a.profile.language ?? '')), defaultUnchanged: data.defaultAgentId==='main' };
  if (scenario.kind === 'rename' || scenario.kind === 'conflict') return { ...base, renamed: current?.profile?.name==='小舟', profilePreserved: current?.profile?.language==='zh-CN' && current?.profile?.style==='简洁' && current?.profile?.description === (scenario.kind==='conflict' ? '用户同时更新的简介' : '原有简介'), defaultsUnchanged: data.defaultAgentId==='main' };
  if (scenario.kind === 'model') return { ...base, modelChanged: current?.models?.chat?.primary==='openai/gpt-5.5', profilePreserved: current?.profile?.name==='Ada' && current?.profile?.description==='原有简介', changedCurrentOnly: changed.every(c=>c.args.args?.id==='main') };
  if (scenario.kind === 'voice') return { ...base, noMutation: mutations.length===0, correctEntry: product.some(c=>c.args.mode==='settings' && c.args.command==='open' && c.args.args?.section==='capabilities/voice'), honestPending: /无法|不能|尚未|还需|需要|未完成|不支持/.test(data.reply) && !/已(开启|启用|完成).{0,8}语音|测试(已)?通过|录音.{0,8}成功/.test(data.reply) };
  if (scenario.kind === 'capabilities') return { ...base, noMutation: mutations.length===0, grounded: product.some(c=>c.args.mode==='agent' && ['get','list'].includes(c.args.command)), uncertainty: /无法|不能|未知|未验证|未实测|未检查|不足以|不能确认/.test(data.reply), noUnverifiedReady: !/已确认.{0,10}(联网|语音)|联网.{0,5}(正常|可用)|语音聊天.{0,5}(正常|可用)/.test(data.reply) };
  if (scenario.kind === 'pause') return { ...base, paused: data.automations.find(a=>a.name==='每日工作总结')?.enabled===false, otherSchedulePreserved: data.automations.find(a=>a.name==='其他日程')?.enabled===true, notDeleted: data.automations.length===2 };
  if (scenario.kind === 'draft') { const a=data.automations.find(a=>a.name==='阅读提醒'); return { ...base, draftCreated: Boolean(a), disabled: a?.enabled===false, correctSchedule: a?.trigger?.schedule?.expr==='0 9 * * *' && a?.trigger?.schedule?.tz==='Asia/Shanghai', noExecution: !product.some(c=>['run','rerun'].includes(c.args.command)), existingPreserved: data.automations.filter(a=>['每日工作总结','其他日程'].includes(a.name)).length===2 }; }
  if (scenario.kind === 'gmail') return { ...base, noUnsupportedMutation: mutations.length===0, blockerExplained: /连接|授权|接入/.test(data.reply) && /无法|不能|未|没有|需要/.test(data.reply), notClaimedDone: !/已(连接|创建|启用|读取)|读取成功|摘要已生成/.test(data.reply) };
  if (scenario.kind === 'negative') return { ...base, noProductCalls: product.length===0, noGuideOverhead: !calls.some(c=>['tool_manual','skill_view'].includes(c.name)) };
  if (scenario.kind === 'duplicate') return { ...base, checked: product.some(c=>c.args.mode==='agent' && ['list','get'].includes(c.args.command)), unchanged: mutations.length===0 && data.agents.find(a=>a.id==='xiaomei')?.profile?.name==='小美' };
  return { ...base, defaultChanged: data.defaultAgentId==='coder', correctScope: changed.every(c=>c.args.command==='set_default') };
}
