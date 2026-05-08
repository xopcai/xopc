/**
 * Synapse 看板状态管理（内存）
 * Tool 调用修改状态，UI 通过 get_board 读取。
 */
import type {
  BoardState, Card, Decision, Activity,
  CreateCardParams, MoveCardParams, UpdateProgressParams,
  AddDecisionParams, ResolveDecisionParams,
} from './types.js';

/* ═══════════ Internal state ═══════════ */
let nextId = 100;
function id(): number { return ++nextId; }

const board: BoardState = {
  cards: [],
  decisions: [],
  activity: [],
  agents: [
    { id: 'tl', icon: '💡', label: 'TL', name: 'tech-lead', role: '策略协调', trust: 5, status: 'active', narrative: '等待任务中', progress: null },
    { id: 'be', icon: '🖥', label: 'BE', name: 'dev-backend', role: '后端开发', trust: 4, status: 'idle', narrative: '空闲', progress: null },
    { id: 're', icon: '🔍', label: 'RE', name: 'reviewer',role: '代码审查', trust: 4, status: 'idle', narrative: '空闲', progress: null },
    { id: 'qa', icon: '🧪', label: 'QA', name: 'tester', role: '测试', trust: 3, status: 'idle', narrative: '空闲', progress: null },
    { id: 'do', icon: '📝', label: 'DO', name: 'docs', role: '文档', trust: 4, status: 'idle', narrative: '空闲', progress: null },
    { id: 'dep', icon: '🚀', label: 'DEP', name: 'deployer', role: '部署', trust: 4, status: 'idle', narrative: '等待部署任务', progress: null },
  ],
  tick: 0,
};

/* ═══════════ Helpers ═══════════ */
function now(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function log(msg: string, ref?: number) {
  const entry: Activity = { t: now(), x: msg };
  board.activity.unshift(entry);
  if (board.activity.length > 20) board.activity.pop();
}

/* ═══════════ Card CRUD ═══════════ */
export function createCard(p: CreateCardParams): Card {
  const card: Card = {
    i: id(),
    c: p.column ?? 0,
    t: p.title,
    l: p.priority,
    d: p.description,
    ag: (p.agents ?? []).map(a => ({ icon: a.icon, name: a.name, status: 'idle' as const, progress: 0 })),
    tg: p.tags ?? [],
    pr: 0,
  };
  board.cards.push(card);
  log(`📋 新任务「${card.t}」已创建`);
  return card;
}

export function moveCard(p: MoveCardParams): Card | null {
  const card = board.cards.find(c => c.i === p.cardId);
  if (!card) return null;
  const from = card.c;
  card.c = p.toColumn;
  const agent = board.agents.find(a => a.name === card.ag[0]?.name);
  if (agent) {
    if (p.toColumn === 1) { agent.status = 'active'; agent.narrative = `正在处理「${card.t}」`; }
    else if (p.toColumn === 3) { agent.status = 'idle'; agent.narrative = `完成「${card.t}」`; }
  }
  log(`🔄 @${card.ag[0]?.name ?? 'system'} 将「${card.t}」移至 ${['待办','进行中','审查中','已完成'][p.toColumn]}`);
  return card;
}

export function updateProgress(p: UpdateProgressParams): Card | null {
  const card = board.cards.find(c => c.i === p.cardId);
  if (!card) return null;
  card.pr = Math.max(0, Math.min(100, p.progress));
  card.ag.forEach(a => { a.progress = card.pr; });
  if (card.pr >= 100) {
    card.ag.forEach(a => { a.status = 'done'; });
    log(`✅ 「${card.t}」已完成`);
  } else if (card.pr > 0) {
    const agent = board.agents.find(a => a.name === card.ag[0]?.name);
    if (agent) { agent.status = 'active'; agent.progress = card.pr; }
  }
  return card;
}

/* ═══════════ Decision CRUD ═══════════ */
export function addDecision(p: AddDecisionParams): Decision {
  const dec: Decision = {
    i: id(),
    l: p.level,
    t: p.title,
    x: p.context,
    b: p.options.map((o, i) => ({
      l: o.label,
      c: o.recommended ? 'rc' : '',
      m: o.confirmMessage,
    })),
  };
  board.decisions.push(dec);
  log(`⚠️ 新决策项：${dec.t}`);
  return dec;
}

export function resolveDecision(p: ResolveDecisionParams): Decision | null {
  const idx = board.decisions.findIndex(d => d.i === p.decisionId);
  if (idx === -1) return null;
  const dec = board.decisions[idx];
  board.decisions.splice(idx, 1);
  const option = dec.b[p.optionIndex];
  log(`✅ 决策：${option?.m ?? dec.t}`);
  return dec;
}

/* ═══════════ Queries ═══════════ */
export function getBoard(): BoardState {
  return board;
}

export function getCards(): Card[] {
  return [...board.cards];
}

export function getDecisions(): Decision[] {
  return [...board.decisions];
}

export function getActivity(): Activity[] {
  return [...board.activity];
}
