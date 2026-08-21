/**
 * Synapse 看板面板 — xopc extension-ui-sdk 接入
 * 构建: esbuild → panel.bundle.js (IIFE)
 */
import { createExtensionClient } from '@xopcai/extension-ui-sdk';

/* ═══════════════════════════════════
   Security: HTML escape to prevent XSS
   ═══════════════════════════════════ */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ═══════════════════════════════════
   Types
   ═══════════════════════════════════ */
interface Agent {
  id: string; icon: string; label: string; name: string;
  role: string; trust: number; status: 'active' | 'idle' | 'alert';
  narrative: string; progress: number | null;
}

interface Card {
  i: number; c: number; t: string; l: 'p0' | 'p1' | 'p2';
  d: string; ag: { ic: string; n: string; s: string; p: number }[];
  tg: string[]; al?: string; pr: number;
}

interface DItem {
  i: number; l: 'p0' | 'p1'; t: string; x: string;
  b: { l: string; c: string; m: string }[];
}

interface AItem {
  t: string; x: string; nb?: boolean;
}

interface BoardState {
  cards: Card[];
  decisions: DItem[];
  activity: AItem[];
  agents: Agent[];
  tick: number;
}

/* ═══════════════════════════════════
   Default Agents
   ═══════════════════════════════════ */
const DEF_AGENTS: Agent[] = [
  {id:'tl',icon:'💡',label:'TL',name:'tech-lead',role:'协调',trust:5,status:'active',narrative:'协调意图中',progress:null},
  {id:'be',icon:'🖥',label:'BE',name:'dev-backend',role:'后端',trust:4,status:'active',narrative:'写 API 中...',progress:80},
  {id:'re',icon:'🔍',label:'RE',name:'reviewer',role:'审查',trust:4,status:'active',narrative:'审查密码重置设计',progress:45},
  {id:'qa',icon:'🧪',label:'QA',name:'tester',role:'测试',trust:3,status:'idle',narrative:'等 API 中 ☕',progress:null},
  {id:'do',icon:'📝',label:'DO',name:'docs',role:'文档',trust:4,status:'idle',narrative:'空闲',progress:null},
  {id:'dep',icon:'🚀',label:'DEP',name:'deployer',role:'部署',trust:4,status:'idle',narrative:'等部署任务',progress:null},
];

/* ═══════════════════════════════════
   Default Data
   ═══════════════════════════════════ */
function defaultState(): BoardState {
  const nid = (() => { let i = 100; return () => ++i; })();
  return {
    cards: [
      {i:nid(),c:1,t:'密码重置 API 开发',l:'p0',d:'实现 POST /api/auth/reset 接口',ag:[{ic:'🖥',n:'dev-backend',s:'active',p:80},{ic:'🔍',n:'reviewer',s:'active',p:45}],tg:['后端','API'],al:'等你决策',pr:65},
      {i:nid(),c:2,t:'API 设计审查',l:'p1',d:'审查密码重置接口安全性，Token 策略、频率限制',ag:[{ic:'🔍',n:'reviewer',s:'active',p:45}],tg:['审查','安全'],pr:45},
      {i:nid(),c:0,t:'测试用例编写',l:'p1',d:'覆盖正常/异常流程，Token 过期、频率限制',ag:[{ic:'🧪',n:'tester',s:'idle',p:0}],tg:['测试'],pr:0},
      {i:nid(),c:1,t:'登录超时 Bug 修复',l:'p2',d:'session 超时时间配置错误',ag:[{ic:'🖥',n:'dev-backend',s:'active',p:100}],tg:['后端','Bug'],pr:100},
      {i:nid(),c:3,t:'用户反馈页面重构 - 设计',l:'p2',d:'整理用户反馈数据，确定重构范围',ag:[{ic:'📝',n:'docs',s:'idle',p:30},{ic:'💡',n:'tech-lead',s:'active',p:60}],tg:['前端','设计'],pr:100},
      {i:nid(),c:0,t:'密码重置前端页面',l:'p0',d:'忘记密码 → 输入邮箱 → 设置新密码的完整流程',ag:[{ic:'🎨',n:'frontend',s:'idle',p:0}],tg:['前端','UI'],pr:0},
      {i:nid(),c:3,t:'登录超时 Bug 验证',l:'p2',d:'测试通过，等待部署',ag:[{ic:'🧪',n:'tester',s:'idle',p:100},{ic:'🖥',n:'dev-backend',s:'idle',p:100}],tg:['测试'],pr:100},
    ],
    decisions: [
      {i:nid(),l:'p0',t:'email 字段无唯一索引',x:'@dev-backend: 用户表有 2 条相同邮箱的记录',b:[{l:'清理 + 加索引',c:'rc',m:'✅ 清理脏数据'},{l:'代码取最近',c:'',m:'✅ 代码层处理'}]},
      {i:nid(),l:'p1',t:'连续重置 Token 策略',x:'@tester: 第一个 Token 是否立即失效？',b:[{l:'立即失效 ✓',c:'rc',m:'✅ 第一个失效'},{l:'同时有效',c:'',m:'✅ 同时有效'}]},
    ],
    activity: [
      {t:'10:52',x:'<span class="hl">@tester</span> 完成测试用例编写'},
      {t:'10:48',x:'<span class="dn">✅</span> 修登录 Bug 完成'},
      {t:'10:45',x:'<span class="hl">@michael</span> 创建「密码重置」',nb:true},
      {t:'10:42',x:'<span class="hl">@tech-lead</span> 拆分为 4 个子任务'},
      {t:'10:30',x:'<span class="hl">@reviewer</span> 提交 API 审查意见'},
    ],
    agents: JSON.parse(JSON.stringify(DEF_AGENTS)),
    tick: 0,
  };
}

/* ═══════════════════════════════════
   CSS (injected)
   ═══════════════════════════════════ */
function injectCSS() {
  const s = document.createElement('style');
  s.textContent = `
    * { box-sizing:border-box;margin:0;padding:0 }
    body {
      font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
      background:var(--s-bg);color:var(--s-fg);
      overflow:hidden;height:100vh;
      transition:background .3s,color .3s;
    }
    .app { display:flex;flex-direction:column;height:100vh;max-width:100%; }
    .tb { display:flex;align-items:center;justify-content:space-between;padding:8px 16px;border-bottom:1px solid var(--s-bs);flex-shrink:0; }
    .tb-l { display:flex;align-items:center;gap:10px; }
    .logo { font-size:16px;font-weight:700;color:var(--s-ac);letter-spacing:-.02em; }
    .badge { font-size:10px;color:var(--s-s);background:var(--s-bh);padding:1px 8px;border-radius:99px;border:1px solid var(--s-bs); }
    .tb-r { display:flex;align-items:center;gap:8px; }
    .tb-r button {
      padding:5px 12px;border-radius:99px;font-size:11px;font-weight:600;
      border:1px solid var(--s-bd);background:var(--s-pn);color:var(--s-fg);
      cursor:pointer;transition:all .15s;
    }
    .tb-r button:hover { background:var(--s-bh); }
    .tb-r button.pri { background:var(--s-ac);color:#fff;border-color:var(--s-ac); }
    .tb-r button.pri:hover { background:var(--s-ac2); }
    .bw { flex:1;min-height:0;padding:12px 16px 8px;overflow-x:auto;overflow-y:hidden; }
    .board { display:flex;gap:12px;height:100%;min-width:min-content; }
    .col { flex:0 0 260px;display:flex;flex-direction:column;border:1px solid var(--s-bs);border-radius:10px;max-height:100%; }
    .ch { display:flex;align-items:center;justify-content:space-between;padding:10px 12px 6px;flex-shrink:0; }
    .ch .ct { font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px; }
    .ch .cc { font-size:11px;color:var(--s-t);background:var(--s-bh);padding:0 6px;border-radius:99px;line-height:18px; }
    .ch .co { font-size:15px;color:var(--s-t);cursor:pointer;line-height:1; }
    .ch .co:hover { color:var(--s-fg); }
    .cb { flex:1;overflow-y:auto;padding:4px 8px 8px;display:flex;flex-direction:column;gap:8px; }
    .card { background:var(--s-pn);border:1px solid var(--s-bs);border-radius:8px;padding:10px 12px;cursor:pointer;transition:all .15s;flex-shrink:0; }
    .card:hover { border-color:var(--s-bd);box-shadow:0 1px 3px rgba(0,0,0,.06); }
    .card .pl { font-size:10px;font-weight:700;letter-spacing:.04em;margin-bottom:4px; }
    .card .pl.p0 { color:var(--s-r); }
    .card .pl.p1 { color:var(--s-y); }
    .card .pl.p2 { color:var(--s-b); }
    .card .ctt { font-size:13px;font-weight:600;margin-bottom:6px;line-height:1.4; }
    .card .cd { font-size:11px;color:var(--s-s);margin-bottom:8px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
    .card .pm { height:3px;border-radius:2px;background:var(--s-bs);overflow:hidden;margin-bottom:6px; }
    .card .pm .f { height:100%;border-radius:2px;background:var(--s-ac);transition:width .6s; }
    .card .cag { display:flex;align-items:center;gap:4px;margin-bottom:6px;flex-wrap:wrap; }
    .card .cag .ca { display:flex;align-items:center;gap:3px;font-size:10px;background:var(--s-bh);padding:2px 5px;border-radius:4px; }
    .card .cag .ca .dot { width:5px;height:5px;border-radius:50%; }
    .card .cag .ca .dot.gr { background:var(--s-g); }
    .card .cag .ca .dot.ac { background:var(--s-ac);animation:bp2 1.5s ease-in-out infinite; }
    .card .cf { display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--s-t); }
    .card .cf .tgs { display:flex;gap:4px; }
    .card .cf .tag { font-size:9px;padding:1px 5px;border-radius:3px;background:var(--s-bh); }
    .card .cf .tag.al { color:var(--s-r);background:var(--s-r2);font-weight:600; }
    @keyframes bp2 { 0%,100%{box-shadow:0 0 3px rgba(217,119,78,.3)} 50%{box-shadow:0 0 8px rgba(217,119,78,.6)} }
    .rp { flex:0 0 280px;display:flex;flex-direction:column;gap:10px;max-height:100%; }
    .rp-l { border-right:1px solid var(--s-bs);padding:0 12px 0 0; }
    .rp-r { border-left:1px solid var(--s-bs);padding:0 0 0 12px; }
    .ps { display:flex;flex-direction:column; }
    .ph { display:flex;align-items:center;justify-content:space-between;padding:0 4px 6px;flex-shrink:0; }
    .ph .pt { font-size:11px;font-weight:600;color:var(--s-s);letter-spacing:.03em;text-transform:uppercase; }
    .ph .pa { font-size:10px;color:var(--s-ac);cursor:pointer; }
    .pb { flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:5px; }
    .di { background:var(--s-pn);border:1px solid var(--s-bs);border-radius:8px;padding:10px 12px;transition:all .3s;flex-shrink:0; }
    .di.rs { opacity:.4;transform:translateX(20px);pointer-events:none; }
    .di .dl { font-size:9px;font-weight:700;letter-spacing:.05em; }
    .di .dl.l0 { color:var(--s-r); }
    .di .dl.l1 { color:var(--s-y); }
    .di .dt { font-size:12px;font-weight:600;margin:2px 0 4px; }
    .di .dx { font-size:11px;color:var(--s-s);line-height:1.5;margin-bottom:6px; }
    .di .db { display:flex;gap:4px;flex-wrap:wrap; }
    .di .db button {
      font-size:10px;padding:3px 8px;border-radius:5px;
      border:1px solid var(--s-bd);background:var(--s-pn);color:var(--s-fg);
      cursor:pointer;font-weight:500;transition:all .12s;
    }
    .di .db button:hover { background:var(--s-bh); }
    .di .db button.rc { border:1.5px solid var(--s-ac);background:var(--s-a2);color:var(--s-ac); }
    .di .db button.rc:hover { background:var(--s-ac);color:#fff; }
    .ai { display:flex;align-items:flex-start;gap:6px;padding:3px 6px;border-radius:4px;font-size:11px;line-height:1.5;transition:background .15s;animation:si .3s ease-out;flex-shrink:0; }
    .ai:hover { background:var(--s-bh); }
    .ai .t { color:var(--s-t);font-size:9px;min-width:28px;font-family:monospace;flex-shrink:0; }
    .ai .c { flex:1; }
    .ai .c .hl { color:var(--s-ac);font-weight:500; }
    .ai .c .dn { color:var(--s-g);font-weight:500; }
    .ai .c .nb { display:inline-block;background:var(--s-ac);color:#fff;font-size:7px;font-weight:700;padding:1px 3px;border-radius:3px;margin-left:3px;vertical-align:middle; }
    @keyframes si { from { opacity:0;transform:translateY(-4px) } to { opacity:1;transform:translateY(0) } }
    .dw { flex-shrink:0;padding:6px 16px 12px; }
    .dk { display:flex;align-items:flex-end;justify-content:center;gap:6px;padding:8px 16px;background:var(--s-pn);border-radius:10px;border:1px solid var(--s-bs); }
    .d2 { display:flex;flex-direction:column;align-items:center;cursor:pointer;position:relative;padding:2px 5px;border-radius:8px;transition:all .2s; }
    .d2:hover { transform:translateY(-4px) scale(1.06); }
    .d2 .bx { width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;background:var(--s-pn);border:1px solid var(--s-bs);position:relative; }
    .d2 .rg { position:absolute;bottom:-2px;right:-2px;width:9px;height:9px;border-radius:50%;border:2px solid var(--s-pn); }
    .d2 .rg.on { background:var(--s-ac);animation:bp2 1.5s ease-in-out infinite; }
    .d2 .rg.off { background:var(--s-bd); }
    .d2 .lb { font-size:9px;font-weight:500;color:var(--s-t);margin-top:2px;white-space:nowrap; }
    .dd { width:1px;height:26px;background:var(--s-bs);align-self:center; }
    .dc { position:fixed;bottom:52px;right:16px;z-index:50;display:flex;gap:4px; }
    .dc button {
      background:var(--s-pn);border:1px solid var(--s-bd);border-radius:99px;padding:4px 10px;
      font-size:10px;color:var(--s-t);cursor:pointer;transition:all .2s;backdrop-filter:blur(8px);
    }
    .dc button:hover { border-color:var(--s-ac);color:var(--s-ac);background:var(--s-a2); }
    .dc button.run { border-color:var(--s-ac);color:var(--s-ac);background:var(--s-a2); }
    .mo { position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:300;backdrop-filter:blur(2px); }
    .mo-c { background:var(--s-pn);border:1px solid var(--s-bd);border-radius:10px;padding:20px;min-width:360px;max-width:480px;box-shadow:0 8px 30px rgba(0,0,0,.15); }
    .mo-c h3 { font-size:15px;font-weight:700;margin-bottom:14px; }
    .mo-c input,.mo-c textarea,.mo-c select { width:100%;padding:8px 10px;margin-bottom:10px;border:1px solid var(--s-bd);border-radius:6px;font-size:13px;font-family:inherit;background:var(--s-bg);color:var(--s-fg);outline:none; }
    .mo-c textarea { height:80px;resize:vertical; }
    .mo-c input:focus,.mo-c textarea:focus { border-color:var(--s-ac);box-shadow:0 0 0 2px var(--s-a2); }
    .mo-c .mo-btns { display:flex;gap:8px;justify-content:flex-end;margin-top:4px; }
    .mo-c .mo-btns button { padding:8px 16px;border-radius:6px;font-size:13px;font-weight:600;border:1px solid var(--s-bd);background:var(--s-pn);color:var(--s-fg);cursor:pointer; }
    .mo-c .mo-btns button.pri { background:var(--s-ac);color:#fff;border-color:var(--s-ac); }
    .mo-c .mo-error { margin:-2px 0 10px;color:#DC2626;font-size:12px;line-height:1.5; }
    .empty { display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px;gap:16px;height:100%; }
    .empty .bi { font-size:48px; }
    .empty h1 { font-size:22px;font-weight:700; }
    .empty p { font-size:13px;color:var(--s-s);max-width:400px;line-height:1.7; }
    .empty .demo-box { background:var(--s-pn);border:1px solid var(--s-bs);border-radius:10px;padding:20px;width:100%;max-width:480px;text-align:left; }
    .empty .demo-box .dlbl { font-size:11px;font-weight:600;color:var(--s-t);margin-bottom:12px;text-transform:uppercase;letter-spacing:.04em; }
    .empty .steps { display:flex;flex-direction:column;gap:10px; }
    .empty .step { display:flex;align-items:flex-start;gap:10px; }
    .empty .step .sn { width:24px;height:24px;border-radius:50%;background:var(--s-a2);color:var(--s-ac);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;border:1px solid var(--s-ac); }
    .empty .step .sc .st { font-size:13px;font-weight:600;margin-bottom:2px; }
    .empty .step .sc .sd { font-size:11px;color:var(--s-s);line-height:1.6; }
    .empty .inp { width:100%;margin-top:12px;padding:9px 12px;border:1px solid var(--s-bd);border-radius:8px;font-size:13px;background:var(--s-bg);color:var(--s-fg);outline:none;transition:border-color .2s; }
    .empty .inp:focus { border-color:var(--s-ac);box-shadow:0 0 0 3px var(--s-a2); }
    .empty .links { display:flex;gap:12px;font-size:12px; }
    .empty .links a { color:var(--s-ac);text-decoration:none;cursor:pointer; }
    .empty .links a:hover { text-decoration:underline; }
    ::-webkit-scrollbar { width:3px;height:3px; }
    ::-webkit-scrollbar-track { background:transparent; }
    ::-webkit-scrollbar-thumb { background:var(--s-bs);border-radius:2px; }
  `;
  document.head.appendChild(s);
}

/* ═══════════════════════════════════
   Theme Tokens
   ═══════════════════════════════════ */
function applyLightTokens() {
  const r = document.documentElement.style;
  r.setProperty('--s-bg', '#F5F3F0');
  r.setProperty('--s-pn', '#FFFFFF');
  r.setProperty('--s-bh', '#EFEBE4');
  r.setProperty('--s-a2', '#FDF0E8');
  r.setProperty('--s-bs', '#EBE5DC');
  r.setProperty('--s-bd', '#D5CDC2');
  r.setProperty('--s-fg', '#2D2A24');
  r.setProperty('--s-s', '#7A7268');
  r.setProperty('--s-t', '#9C9488');
  r.setProperty('--s-ac', '#D9774E');
  r.setProperty('--s-ac2', '#C96A3F');
  r.setProperty('--s-g', '#6B9E8A');
  r.setProperty('--s-y', '#D9A85C');
  r.setProperty('--s-r', '#C9705C');
  r.setProperty('--s-r2', '#F8EDE8');
  r.setProperty('--s-b', '#7AA9C8');
}

function applyDarkTokens() {
  const r = document.documentElement.style;
  r.setProperty('--s-bg', '#1C1A18');
  r.setProperty('--s-pn', '#2B2825');
  r.setProperty('--s-bh', '#3A3632');
  r.setProperty('--s-a2', '#3A2A20');
  r.setProperty('--s-bs', '#3A3632');
  r.setProperty('--s-bd', '#48443E');
  r.setProperty('--s-fg', '#F0EDE8');
  r.setProperty('--s-s', '#A9A296');
  r.setProperty('--s-t', '#8C8579');
  r.setProperty('--s-ac', '#E8926C');
  r.setProperty('--s-ac2', '#D9774E');
  r.setProperty('--s-g', '#7FB8A2');
  r.setProperty('--s-y', '#D4A454');
  r.setProperty('--s-r', '#D98874');
  r.setProperty('--s-r2', '#30201C');
  r.setProperty('--s-b', '#8FBFDE');
}

function applyTheme(mode: 'light' | 'dark') {
  if (mode === 'dark') applyDarkTokens();
  else applyLightTokens();
}

/* ═══════════════════════════════════
   Board State
   ═══════════════════════════════════ */
let state: BoardState = defaultState();
let nid = 200;
function newId() { return ++nid; }
function nowTime() { const d=new Date();return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); }
let demoRunning = false;
let demoInterval: ReturnType<typeof setInterval> | null = null;

/* ═══════════════════════════════════
   Render Functions
   ═══════════════════════════════════ */
function renderBoard() {
  ['b0','b1','b2','b3'].forEach((id,ci)=>{
    const el = document.getElementById(id);
    if (!el) return;
    const cs = state.cards.filter(c=>c.c===ci);
    if (!cs.length) { el.innerHTML='<div style="padding:16px 8px;text-align:center;color:var(--s-t);font-size:11px;">暂无任务</div>'; return; }
    el.innerHTML = cs.map(c=>{
      const lc = c.l==='p0'?'p0':c.l==='p1'?'p1':'p2';
      const ags = c.ag.map(a=>{const dt=a.s==='active'?'ac':'gr';return`<span class="ca">${escapeHtml(a.ic)}<span class="dot ${dt}"></span></span>`}).join('');
      const pg = c.pr>0&&c.pr<100?`<div class="pm"><div class="f" style="width:${Math.min(100, Math.max(0, c.pr))}%"></div></div>`:'';
      const ah = c.al?`<span class="tag al">⚠️ ${escapeHtml(c.al)}</span>`:'';
      const ts = c.tg.map(t=>`<span class="tag">${escapeHtml(t)}</span>`).join('');
      return `<div class="card"><div class="pl ${lc}">${escapeHtml(c.l.toUpperCase())}</div><div class="ctt">${escapeHtml(c.t)}</div><div class="cd">${escapeHtml(c.d)}</div>${pg}<div class="cag">${ags}</div><div class="cf"><div class="tgs">${ts}${ah}</div><span>#${c.i}</span></div></div>`;
    }).join('');
  });
  // Column counts
  ['0','1','2','3'].forEach(i=>{const e=document.getElementById('c'+i);if(e)e.textContent=String(state.cards.filter(c=>c.c===+i).length);});
}

function renderDecisions() {
  const el = document.getElementById('dl');
  if (!el) return;
  if (!state.decisions.length) { el.innerHTML='<div style="padding:12px;text-align:center;color:var(--s-t);font-size:11px;">✅ 无待决策</div>'; return; }
  el.innerHTML = state.decisions.map(d=>{
    const bs = d.b.map(b=>`<button class="${escapeHtml(b.c)}" onclick="window.__synapse_resolve(${d.i},'${escapeHtml(b.m)}')">${escapeHtml(b.l)}</button>`).join('');
    return `<div class="di" id="dc_${d.i}"><div class="dl l${d.l==='p0'?0:1}">${escapeHtml(d.l.toUpperCase())}</div><div class="dt">${escapeHtml(d.t)}</div><div class="dx">${escapeHtml(d.x)}</div><div class="db">${bs}</div></div>`;
  }).join('');
}

function renderActivity() {
  const el = document.getElementById('al');
  if (!el) return;
  el.innerHTML = state.activity.slice(0,12).map(a=>`<div class="ai"><span class="t">${escapeHtml(a.t)}</span><span class="c">${escapeHtml(a.x)}${a.nb?'<span class="nb">NEW</span>':''}</span></div>`).join('');
}

function renderDock() {
  const el = document.getElementById('ad');
  if (!el) return;
  el.innerHTML = '';
  state.agents.forEach((ag,i)=>{
    if (i===state.agents.length-1) { const d=document.createElement('div');d.className='dd';el.appendChild(d); }
    const d2 = document.createElement('div'); d2.className='d2';
    const rg = ag.status==='active'?'on':'off';
    d2.innerHTML = `<div class="bx">${escapeHtml(ag.icon)}<div class="rg ${rg}"></div></div><div class="lb">${escapeHtml(ag.label)}</div>`;
    d2.title = `@${ag.name}: ${ag.narrative}`;
    el.appendChild(d2);
  });
}

function renderAll() { renderBoard(); renderDecisions(); renderActivity(); renderDock(); }

/* ═══════════════════════════════════
   Actions
   ═══════════════════════════════════ */
function resolveDecision(id: number, _msg: string) {
  const el = document.getElementById('dc_'+id);
  if (el) el.classList.add('rs');
  setTimeout(()=>{
    state.decisions = state.decisions.filter(d=>d.i!==id);
    renderAll();
  },350);
}

/* ═══════════════════════════════════
   Simulation
   ═══════════════════════════════════ */
function simTick() {
  state.tick++;
  const t = nowTime();

  // Advance progress
  state.cards.forEach(c=>{if(c.c===1||c.c===2){c.pr=Math.min(100,c.pr+(2+Math.floor(Math.random()*4)));c.ag.forEach(a=>{if(a.p!==undefined)a.p=c.pr;});}});

  // Move cards
  if (state.tick%3===0) {state.cards.filter(c=>c.c===1&&c.pr>=90).forEach(c=>{if(Math.random()>.5){c.c=2;c.ag=[{ic:'🔍',n:'reviewer',s:'active',p:30}];}});}
  if (state.tick%5===0) {state.cards.filter(c=>c.c===2&&c.pr>=80).forEach(c=>{if(Math.random()>.5)c.c=3;});}
  if (state.tick%4===0&&state.cards.filter(c=>c.c===0).length<3) {
    const tp=[{t:'数据库连接池优化',l:'p1',d:'连接池不够，高峰期有等待',tg:['后端','性能']},{t:'错误页面样式统一',l:'p2',d:'404/500 页面样式统一',tg:['前端','UI']},{t:'日志采集接入',l:'p1',d:'接入新的日志采集系统',tg:['运维']}];
    const p=tp[Math.floor(Math.random()*tp.length)];
    state.cards.push({i:newId(),c:0,t:p.t,l:p.l as any,d:p.d,ag:[{ic:'💡',n:'tech-lead',s:'idle',p:0}],tg:p.tg,pr:0});
    state.activity.unshift({t,x:`📋 新任务「${escapeHtml(p.t)}」已创建`,nb:true});
  }

  // Add activity
  if (state.tick%2===0) {
    const ms=[`<span class="hl">@dev-backend</span> 推进 API 进度`,`<span class="hl">@reviewer</span> 提交 2 条审查意见`,`<span class="hl">@tester</span> 更新测试计划`,`<span class="hl">@tech-lead</span> 检查任务依赖`,`📊 密码重置功能进度更新`];
    state.activity.unshift({t,x:ms[Math.floor(Math.random()*ms.length)],nb:true});
    if (state.activity.length>15) state.activity.pop();
  }

  // New decisions
  if (state.tick%6===0&&state.decisions.length<3) {
    const pk=[{l:'p0',t:'Token 过期时长？',x:'@reviewer: 15 分钟是否太短？',b:[{l:'15 分钟',c:'rc',m:'✅ 15 分钟'},{l:'30 分钟',c:'',m:'✅ 30 分钟'}]},{l:'p1',t:'重置后发通知邮件？',x:'@tester: 密码重置后是否发通知？',b:[{l:'需要',c:'rc',m:'✅ 发通知'},{l:'不需要',c:'',m:'✅ 不发'}]}];
    const p=pk[Math.floor(Math.random()*pk.length)];p.i=newId();state.decisions.push(p as any);
  }

  // Clear NEW badges
  if (state.tick%4===0) state.activity.forEach(a=>a.nb=false);

  // Agent updates
  const be = state.agents.find(a=>a.id==='be');
  const dc = state.cards.filter(c=>c.c===1);
  if (dc.length>0&&be) {be.status='active';be.progress=dc[0].pr;be.narrative=be.progress>=90?'API 快完成了':be.progress>50?'编码中，进度过半':'写 API 中...';}

  renderAll();
}

function toggleDemo() {
  const btn = document.getElementById('db');
  if (!btn) return;
  if (demoRunning) {
    clearInterval(demoInterval!);
    demoRunning = false;
    btn.textContent = '▶️ 自动演示';
    btn.classList.remove('run');
  } else {
    demoRunning = true;
    btn.textContent = '⏸ 演示中';
    btn.classList.add('run');
    demoInterval = setInterval(simTick, 3500);
    setTimeout(simTick, 500);
  }
}

/* ═══════ Mock Modals ═══════ */
function showModal(html: string) {
  const mo = document.createElement('div'); mo.className='mo';
  mo.innerHTML = html;
  mo.onclick = (e) => { if ((e.target as HTMLElement).className==='mo') mo.remove(); };
  document.body.appendChild(mo);
  return mo;
}

function showModalError(mo: HTMLElement, message: string) {
  const container = mo.querySelector('.mo-c');
  if (!container) return;
  let error = container.querySelector<HTMLElement>('.mo-error');
  if (!error) {
    error = document.createElement('p');
    error.className = 'mo-error';
    error.setAttribute('role', 'alert');
    container.querySelector('.mo-btns')?.before(error);
  }
  error.textContent = message;
}

function createTask() {
  const mo = showModal(`
    <div class="mo-c">
      <h3>📋 创建任务</h3>
      <input id="mtTitle" placeholder="任务标题，如：优化登录页加载速度">
      <textarea id="mtDesc" placeholder="描述（可选）"></textarea>
      <select id="mtPriority"><option value="p2">P2 常规</option><option value="p1" selected>P1 重要</option><option value="p0">P0 紧急</option></select>
      <div class="mo-btns">
        <button onclick="this.closest('.mo')?.remove()">取消</button>
        <button class="pri" id="mtSubmit">创建</button>
      </div>
    </div>`);
  mo.querySelector('#mtSubmit')!.addEventListener('click', () => {
    const t = (mo.querySelector('#mtTitle') as HTMLInputElement).value.trim();
    if (!t) { showModalError(mo, '请输入标题'); return; }
    const d = (mo.querySelector('#mtDesc') as HTMLTextAreaElement).value.trim();
    const pr = (mo.querySelector('#mtPriority') as HTMLSelectElement).value as 'p0'|'p1'|'p2';
    state.cards.push({ i:newId(), c:0, t, l:pr, d:d||'无描述', ag:[{ic:'💡',n:'tech-lead',s:'idle',p:0}], tg:[], pr:0 });
    state.activity.unshift({ t: nowTime(), x:`📋 手动创建「${escapeHtml(t)}」`, nb:true });
    mo.remove(); renderAll();
  });
}

function createIntent() {
  const mo = showModal(`
    <div class="mo-c">
      <h3>🤖 创建意图</h3>
      <p style="font-size:12px;color:var(--s-s);margin-bottom:12px;">用自然语言描述你的意图，Agent 会自动拆解成任务卡片。</p>
      <textarea id="miText" placeholder="例如：为登录模块增加记住密码功能"></textarea>
      <div class="mo-btns">
        <button onclick="this.closest('.mo')?.remove()">取消</button>
        <button class="pri" id="miSubmit">发送 →</button>
      </div>
    </div>`);
  mo.querySelector('#miSubmit')!.addEventListener('click', () => {
    const txt = (mo.querySelector('#miText') as HTMLTextAreaElement).value.trim();
    if (!txt) { showModalError(mo, '请输入描述'); return; }
    mo.remove();
    const title = txt.length>20 ? txt.slice(0,20)+'...' : txt;
    state.activity.unshift({ t:nowTime(), x:`@michael 创建意图「${escapeHtml(title)}」`, nb:true });
    state.cards.push({ i:newId(), c:0, t:title, l:'p1', d:txt, ag:[{ic:'💡',n:'tech-lead',s:'active',p:10}], tg:['意图'], pr:10 });
    const tl = state.agents.find(a=>a.id==='tl');
    if (tl) { tl.status='active'; tl.narrative=`正在分析「${title}」...`; }
    state.activity.unshift({ t:nowTime(), x:`@tech-lead 开始拆解「${escapeHtml(title)}」`, nb:true });
    renderAll();
    // Simulate: after 3s, add sub-tasks
    setTimeout(()=>{
      state.cards.push({ i:newId(), c:0, t:'后端 API 开发', l:'p1', d:'基于意图拆解的后端任务', ag:[{ic:'🖥',n:'dev-backend',s:'idle',p:0}], tg:['后端'], pr:0 });
      state.cards.push({ i:newId(), c:0, t:'前端 UI 实现', l:'p1', d:'基于意图拆解的前端任务', ag:[{ic:'🎨',n:'frontend',s:'idle',p:0}], tg:['前端'], pr:0 });
      state.activity.unshift({ t:nowTime(), x:`<span class="hl">@tech-lead</span> 拆解完成：2 个子任务`, nb:true });
      const tl = state.agents.find(a=>a.id==='tl');
      if (tl) { tl.status='idle'; tl.narrative='意图拆解完成'; }
      renderAll();
    }, 3000);
  });
}

function showCardDetail(card: Card) {
  const cols = ['待办','进行中','审查中','已完成'];
  const col = cols[card.c] ?? '未知';
  const lvlLabel = { p0:'🔴 紧急', p1:'🟡 重要', p2:'🔵 常规' }[card.l] ?? card.l;
  const ags = card.ag.map(a => {
    const st = a.s === 'active' ? '🟢 工作中' : a.s === 'done' ? '✅ 已完成' : '⚪ 等待';
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:12px;">${escapeHtml(a.ic)} <span style="font-weight:500;">@${escapeHtml(a.n)}</span> <span style="color:var(--s-t);">${st}</span></div>`;
  }).join('') || '<span style="font-size:12px;color:var(--s-t);">暂未分派</span>';
  const tgs = card.tg.length ? card.tg.map(t=>`<span style="font-size:10px;padding:2px 8px;border-radius:4px;background:var(--s-bh);color:var(--s-s);">${escapeHtml(t)}</span>`).join(' ') : '<span style="font-size:12px;color:var(--s-t);">无标签</span>';
  const nextCol = card.c < 3 ? card.c + 1 : null;
  const progBar = card.pr > 0 || card.pr === 0
    ? `<div style="margin-bottom:12px;"><div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px;color:var(--s-t);"><span>进度</span><span style="font-weight:600;">${card.pr}%</span></div><div style="height:6px;border-radius:3px;background:var(--s-bs);overflow:hidden;"><div style="height:100%;border-radius:3px;background:${card.pr>=100?'var(--s-g)':'var(--s-ac)'};width:${card.pr}%;transition:width .6s;"></div></div></div>`
    : '';
  const alertHtml = card.al ? `<div style="margin-top:10px;padding:8px 12px;border-radius:6px;background:var(--s-r2);color:var(--s-r);font-size:12px;font-weight:600;">⚠️ ${escapeHtml(card.al)}</div>` : '';

  showModal(`<div class="mo-c" style="max-width:440px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
      <span style="font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--s-${card.l==='p0'?'r':card.l==='p1'?'y':'b'});">${escapeHtml(lvlLabel)}</span>
      <span style="font-size:11px;color:var(--s-t);">#${card.i} · ${escapeHtml(col)}</span>
    </div>
    <h3 style="margin:0 0 10px;">${escapeHtml(card.t)}</h3>
    <p style="font-size:13px;color:var(--s-s);line-height:1.7;margin-bottom:14px;">${escapeHtml(card.d)}</p>
    ${progBar}
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:600;color:var(--s-t);margin-bottom:6px;">参与 Agent</div>
      ${ags}
    </div>
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:600;color:var(--s-t);margin-bottom:6px;">标签</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;">${tgs}</div>
    </div>
    ${alertHtml}
    <div class="mo-btns" style="margin-top:16px;">
      ${nextCol !== null ? `<button class="pri" onclick="window.__synapse_moveCard(${card.i},${nextCol});this.closest('.mo')?.remove()">→ 移至「${cols[nextCol]}」</button>` : ''}
      <button onclick="this.closest('.mo')?.remove()">关闭</button>
    </div>
  </div>`);
}

// Move card by ID (called from detail modal)
window['__synapse_moveCard'] = (cardId: number, toCol: number) => {
  const card = state.cards.find(c => c.i === cardId);
  if (!card) return;
  card.c = toCol as Card['c'];
  if (toCol === 3) { card.pr = 100; card.ag.forEach(a => { a.s = 'done'; a.p = 100; }); }
  state.activity.unshift({ t:nowTime(), x:`🔄 「${escapeHtml(card.t)}」已移至 ${['待办','进行中','审查中','已完成'][toCol]}`, nb:true });
  renderAll();
};

/* ═══════════════════════════════════
   HTML Structure
   ═══════════════════════════════════ */
function buildHTML() {
  const app = document.createElement('div'); app.className='app';

  // Top bar
  app.innerHTML = `
    <div class="tb"><div class="tb-l"><span class="logo">⟐ Synapse</span><span class="badge">MVP</span></div>
    <div class="tb-r"><button onclick="window.__synapse_createIntent()">+ 创建意图</button>
    <button class="pri" onclick="window.__synapse_createTask()">+ 创建任务</button></div></div>
    <div class="bw"><div style="display:flex;height:100%;">
      <div class="rp rp-l">
        <div class="ps" style="flex:1;"><div class="ph"><span class="pt">⚠️ 需要你决策</span><span class="pa">全部 →</span></div><div class="pb" id="dl"></div></div>
        <div class="ps" style="flex:1;"><div class="ph"><span class="pt">📌 活动</span><span class="pa">全部 →</span></div><div class="pb" id="al"></div></div>
      </div>
      <div class="board">
        <div class="col"><div class="ch"><span class="ct">📋 待办 <span class="cc" id="c0">0</span></span><span class="co">⋯</span></div><div class="cb" id="b0"></div></div>
        <div class="col"><div class="ch"><span class="ct">🔄 进行中 <span class="cc" id="c1">0</span></span><span class="co">⋯</span></div><div class="cb" id="b1"></div></div>
        <div class="col"><div class="ch"><span class="ct">🔍 审查中 <span class="cc" id="c2">0</span></span><span class="co">⋯</span></div><div class="cb" id="b2"></div></div>
        <div class="col"><div class="ch"><span class="ct">✅ 已完成 <span class="cc" id="c3">0</span></span><span class="co">⋯</span></div><div class="cb" id="b3"></div></div>
      </div>
    </div></div>
    <div class="dw"><div class="dk" id="ad"></div></div>
    <div class="dc"><button id="db" onclick="window.__synapse_toggleDemo()">▶️ 自动演示</button></div>
  `;
  document.body.appendChild(app);
}

/* ═══════════════════════════════════
   Main
   ═══════════════════════════════════ */
async function main() {
  injectCSS();

  // Init xopc extension client
  const client = createExtensionClient();
  await client.whenReady();

  // Apply theme from host
  const theme = await client.theme.getTheme();
  applyTheme(theme.mode);
  client.theme.onThemeChange((t) => { applyTheme(t.mode); });

  // Load board state from storage, or use default
  try {
    const saved = await client.storage.get<BoardState>('synapse.board');
    if (saved && saved.cards) {
      state = saved;
      nid = Math.max(200, Math.max(...saved.cards.map(c=>c.i), ...saved.decisions.map(d=>d.i), ...saved.activity.map(()=>0))) + 1;
    }
  } catch { /* use default */ }

  // Build UI
  buildHTML();
  renderAll();

  // Expose globals for onclick handlers
  window['__synapse_resolve'] = (id: number, msg: string) => resolveDecision(id, msg);
  window['__synapse_toggleDemo'] = () => toggleDemo();
  window['__synapse_createTask'] = () => createTask();
  window['__synapse_createIntent'] = () => createIntent();

  // Card click → show detail (event delegation on board wrapper)
  document.querySelector('.bw')?.addEventListener('click', function(this: HTMLElement, e: Event) {
    const card = (e.target as HTMLElement).closest('.card');
    if (!card) return;
    // Don't trigger on decision buttons
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    const idText = card.querySelector('.cf span:last-child')?.textContent?.replace('#','');
    const c = state.cards.find(ca => ca.i === Number(idText));
    if (c) showCardDetail(c);
  });

  // Listen for cross-extension events (board state updates)
  client.events.on('synapse.board-updated', (data: any) => {
    if (data) { state = data as BoardState; renderAll(); }
  });

  // Save state periodically to storage
  setInterval(async () => {
    try { await client.storage.set('synapse.board', state); } catch {}
  }, 3000);

  // Notify host container of our height
  client.ui.resize(document.body.scrollHeight + 24);
}

main().catch(e => {
  document.body.innerHTML = `<pre style="padding:16px;color:#c00;">${escapeHtml(String(e))}</pre>`;
});
