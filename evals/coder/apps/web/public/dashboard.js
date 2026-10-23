const view = document.querySelector('#view');
const error = document.querySelector('#error');
const esc = value => String(value ?? 'unknown').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const badge = value => `<span class="badge ${/^[a-z_]+$/.test(String(value)) ? value : ''}">${esc(value)}</span>`;
const choose = e => { const p = new URLSearchParams(location.search); const left = p.get('left'); return `<a href="?left=${encodeURIComponent(e.id)}#compare">设为基线</a> · <a href="?${left ? 'left=' + encodeURIComponent(left) + '&amp;' : ''}right=${encodeURIComponent(e.id)}#compare">设为候选</a>`; };
const pretty = value => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
const table = (head, rows) => `<div class="table-wrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

const auditTable = rows => table(['任务', 'HTTP / 账本 / 任务响应', '非 agent 调用 / 未知尾部', 'HTTP tokens / 账本 tokens', '差额', '总量 / 逐请求身份', '已结算 Credit micro'], rows.map(a => tr([
  esc(a.id), `${esc(a.physicalRequests)} / ${esc(a.runtimeRequests)} / ${esc(a.taskResponses)}`, `${esc(a.auxiliaryRequests)} / ${esc(a.unknownRequests)}`,
  `${esc(a.wireTokens)}（已观测 ${esc(a.observedWireTokens)}） / ${esc(a.runtimeTokens)}`, esc(a.providerMinusRuntimeTokens), badge(a.usageMatched ? 'matched' : a.knownPerRequestUsageMatched ? 'partial_unknown' : 'mismatch') + badge(a.perRequestMatched ? 'identity_matched' : 'identity_unverified'), esc(a.settledChargeCreditMicro),
]))).replace('class="table-wrap"', 'class="table-wrap audit-table"');

const tr = cells => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const empty = text => `<div class="empty">${text}</div>`;
async function api(path) { const res = await fetch(path); const data = await res.json(); if (!res.ok) throw Error(data.error ?? '请求失败'); return data; }
function tally(e) { const counts = {}; for (const t of e.trials) counts[t.assessment] = (counts[t.assessment] ?? 0) + 1; return Object.entries(counts).map(([k, n]) => `${badge(k)} ${n}`).join(' · ') || '仅有摘要，无逐题轨迹'; }
function link(e) { return `<a href="#evidence/${e.id}">${esc(e.benchmark)}</a>`; }
const acceptancePanel = value => !value ? '' : `<div class="card"><h3>Personal 分项验收</h3><p>实际交付 ${esc(value.deliveredInMs)} ms · 独立内容检查 ${esc(value.qualityChecks)} 项 ${badge(value.qualityPassed ? 'passed' : 'failed')} · 整体验收 ${badge(value.overallAccepted ? 'passed' : 'failed')}</p><p class="muted">原始失败评分保留。内容核验通过与延迟门槛分别展示，历史缺失 token 不补零。</p>${table(['未通过的延迟项', '实测 ms', '门槛 ms'], (value.latencyFailures ?? []).map(item => tr([esc(item.key), esc(item.actual), esc(item.limit)])))}</div>`;
let rendering = 0;
async function render() {
  const version = ++rendering;
  error.hidden = true;
  const [route, id, trial] = location.hash.slice(1).split('/');
  const current = route || 'overview';
  document.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current', a.hash === `#${current}` ? 'page' : 'false'));
  const titles = { overview: '能力概览', runs: '运行中心', evidence: '评测证据', compare: '实验比较', improvements: '改进记录' };
  document.querySelector('#title').textContent = titles[current] ?? '评测证据';
  try {
    let html;
    if (current === 'overview') {
      const data = await api('/api/overview');
      html = `<div class="card"><h2>每项能力都有自己的证据范围</h2><p class="muted">${data.evidenceCount} 份当前证据。模型、协议、校准和未完成运行分别呈现；没有跨套件总能力分。</p></div><div class="grid">${data.benchmarks.map(b => `<article class="card"><h3>${esc(b.id)}</h3>${badge(b.level)}${badge(b.lifecycle)}<p class="muted">${b.capabilities.map(esc).join(' · ')}</p><p>${b.latestAttempt ? `${link(b.latestAttempt)} ${badge(b.latestAttempt.evidenceClass)} ${badge(b.latestAttempt.validity)}` : '尚无已导入证据'}</p><small>最新模型有效：${b.latestLiveCompleteValid ? link(b.latestLiveCompleteValid) : 'unknown'}<br>已晋级：${b.latestPromoted ? link(b.latestPromoted) : '无'}</small></article>`).join('')}</div><h2>来源健康状态</h2>${table(['来源', '最近检查', '状态'], data.sources.map(s => tr([`<code>${esc(s.path)}</code>`, esc(s.checked_at), s.error ? esc(s.error) : '可读取'])))}`;
    } else if (current === 'runs') {
      const [campaigns, activity] = await Promise.all([api('/api/campaigns'), api('/api/activity')]);
      html = campaigns.length ? campaigns.map(c => `<article class="card"><h2>${esc(c.id)}</h2>${badge(c.status)}${badge(c.validity)}${badge(c.promotion)}${c.candidateDecision ? `<p>候选判定 ${badge(c.candidateDecision)}</p>` : ''}<p>源码：<code>${esc(c.sourceHash)}</code></p><p>计划：${esc(c.expectedJobs ?? c.plan?.length ?? null)} 项 · 已开始 ${Object.keys(c.jobs ?? {}).length} 项 · ${esc(c.updatedAt)}</p><div class="grid">${[['等待', c.scheduler?.queued], ['运行', c.scheduler?.active], ['已结束', (c.scheduler?.completed ?? 0) + (c.scheduler?.failed ?? 0)], ['取消', c.scheduler?.cancelled]].map(([label, value]) => `<div class="card"><small>${label}</small><div class="stat">${esc(value)}</div></div>`).join('')}</div><p class="muted">${(c.plan ?? []).map(j => `${esc(j.id)}${j.dependsOn?.length ? ' ← ' + j.dependsOn.map(esc).join(', ') : ''}`).join(' · ')}</p><h3>共享模型请求池</h3><p>Generation ${esc(c.pool?.byRole?.generation)} / ${esc(c.pool?.targets?.generation)}　Judge ${esc(c.pool?.byRole?.judge)} / ${esc(c.pool?.targets?.judge)}　总请求 ${esc(c.pool?.active)} / ${esc(c.pool?.parent)}　排队 ${esc(c.pool?.queued)}</p><p class="muted">整轮时间预算 ${esc(c.budget?.maxWallMs)} ms · 实际账单 unknown</p>${table(['任务', '状态', '耗时', '原因'], Object.entries(c.jobs ?? {}).map(([key, j]) => tr([esc(key), badge(j.status), `${esc(j.durationMs)} ms`, esc(j.stopReason ?? j.reason ?? '—')]))) }${c.reconciliation ? '<h3>模型调用与用量对账</h3>' + auditTable(c.reconciliation) + '<p class="muted">HTTP 包含辅助调用。差额保留；无权威账单回执时实际金额 unknown。</p>' : ''}<details><summary>请求覆盖与运行位置</summary>${pretty({ output: c.output, coverage: c.requestCoverage })}</details></article>`).join('') : empty('尚无运行。使用 eval:control run 启动计划；页面每秒同步队列和预算状态。');
      html += '<h2>最近事件</h2>' + table(['序号', '事件', '时间'], activity.map(e => tr([esc(e.seq), esc(e.type), esc(e.at)])));
    } else if (current === 'evidence' && id) {
      const e = await api(`/api/evidence/${id}`);
      if (trial) html = `<a href="#evidence/${id}">返回证据</a>${pretty(await api(`/api/evidence/${id}/runs/${trial}`))}`;
      else html = `<div class="card"><h2>${esc(e.benchmark)}</h2>${e.currentReview?.blocked ? `<p class="muted">当前评分协议有阻断复核；原始评分保留，历史快照也不能绕过门禁。</p>` : ''}${badge(e.evidenceClass)}${badge(e.validity)}${badge(e.complete ? 'complete' : 'incomplete')}<p>${tally(e)}</p><p>计划分母 ${esc(e.expected)} · 可见逐题记录 ${e.trials.length}</p><code>${esc(e.id)}</code><p>${choose(e)}</p><p class="muted">${e.reasons.map(esc).join(' · ')}</p></div>${table(['任务', '变体 / 重复', '执行', '评分', '耗时'], e.trials.map(t => tr([`<a href="#evidence/${e.id}/${t.id}">${esc(t.caseId)}</a>`, `${esc(t.variant)} / ${t.repetition}`, badge(t.execution), badge(t.assessment), `${esc(t.durationMs)} ms`])))}<div class="grid"><div class="card"><h2>身份与匹配条件</h2>${pretty(e.identity)}</div><div class="card"><h2>原生摘要指标</h2>${pretty(e.metrics)}</div></div><details><summary>来源与版本</summary>${pretty({ source: e.source, hash: e.sourceHash, lineage: e.lineage, importedAt: e.importedAt })}</details>`;
    } else if (current === 'compare') {
      const params = new URLSearchParams(location.search);
      const left = params.get('left') ?? ''; const right = params.get('right') ?? '';
      html = `<form id="compare-form" class="filters"><label>Baseline evidence ID<input name="left" required value="${esc(left)}"></label><label>Candidate evidence ID<input name="right" required value="${esc(right)}"></label><button>比较证据</button></form>`;
      if (left && right) {
        const data = await api(`/api/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
        html += `<div class="card">${pretty(data.summary)}${badge(data.comparable ? 'comparable' : 'incomparable')}${badge(data.decision)}<p>${data.mismatches.map(esc).join(' · ')}</p></div>${table(['配对', 'Baseline', 'Candidate'], data.pairs.map(p => tr([esc(p.key), badge(p.baseline?.assessment ?? 'missing'), badge(p.candidate?.assessment ?? 'missing')])) )}`;
      }
      const choices = await api('/api/evidence');
      html += '<h2>选择评测证据</h2>' + table(['评测', '类型', '选择'], choices.items.map(e => tr([link(e), badge(e.evidenceClass), choose(e)])));
    } else if (current === 'improvements') {
      const data = await api('/api/improvements');
      html = data.length ? data.map(i => `<article class="card"><h2>${esc(i.problem)}</h2><p>${esc(i.hypothesis)}</p>${badge(i.promotion)}${acceptancePanel(i.decision?.personalAcceptance)}${i.supplements?.length ? `<details><summary>追加证据 ${i.supplements.length}（原决策不变）</summary>${i.supplements.map(s => pretty(s.data)).join('')}</details>` : ''}${i.decision && Array.isArray(i.decision.audit) ? `${i.decision.tokens !== undefined ? `<p>真实模型请求 ${esc(i.decision.physicalRequests)} · HTTP / 账本对齐 tokens ${esc(i.decision.tokens)}</p><p class="muted">${esc(i.decision.scope)}</p>` : `<p>Baseline HTTP tokens ${esc(i.decision.baselineTokens)} · Candidate ${esc(i.decision.candidateTokens)} · 降幅 ${i.decision.tokenReduction === null ? 'unknown' : (i.decision.tokenReduction * 100).toFixed(1) + '%'}</p>`}<p>${i.decision.reasons.length ? i.decision.reasons.map(esc).join('；') : '预登记的质量、请求身份、总用量和尾部采集门禁全部通过'}</p>${table(['阶段 / 变体', '通过 / 计划'], i.decision.reports.map(r => tr([esc(r.id), `${esc(r.passed)} / ${esc(r.expected)}`])))}${auditTable(i.supplements?.findLast(s => Array.isArray(s.data?.audit))?.data.audit ?? i.decision.audit)}<p class="muted">${esc(i.decision.independentValidation)}<br>生产默认配置变更：${i.decision.productionDefaultsChanged ? '是' : '否'}</p>${i.decision.protocolReview ? `<div class="card"><h3>评分协议复核</h3><p>${esc(i.decision.protocolReview.finding)}</p><p class="muted">${esc(i.decision.protocolReview.disposition)}</p></div>` : ''}${i.decision.queueTiming ? `<details><summary>队列与阶段耗时</summary>${pretty({queue:i.decision.queueTiming,timing:i.decision.timing})}</details>` : ''}<p>${(i.decision.evidenceIds ?? []).map(id => `<a href="#evidence/${encodeURIComponent(id)}">证据 ${esc(id.slice(0, 8))}</a>`).join(' · ')}</p><details><summary>完整决策与证据指纹</summary>${pretty(i)}</details>` : pretty(i)}</article>`).join('') : empty('暂无改进记录。通过 eval:control improvement --file 登记问题、假设、保护项和预算。');
    } else {
      const params = new URLSearchParams(location.search);
      const q = params.get('q') ?? ''; const offset = Number(params.get('offset')) || 0;
      const data = await api(`/api/evidence?q=${encodeURIComponent(q)}&offset=${offset}`);
      html = `<form id="search-form" class="filters"><label>搜索场景、模型或来源<input name="q" value="${esc(q)}"></label><button>筛选</button></form><p class="muted">${data.total} 份证据 · 按导入顺序；原始来源时间在详情中保留</p>${table(['评测', '类型 / 完整性', '评分结果', '有效性', '模型', '比较'], data.items.map(e => tr([link(e), `${badge(e.evidenceClass)}${badge(e.complete ? 'complete' : 'incomplete')}`, tally(e), badge(e.validity), esc(e.identity.model), choose(e)])))}<div class="filters"><button id="prev" ${offset ? '' : 'disabled'}>上一页</button><button id="next" ${offset + 30 < data.total ? '' : 'disabled'}>下一页</button></div>`;
    }
    if (version !== rendering) return;
    view.innerHTML = html;
    document.querySelector('#updated').textContent = `更新于 ${new Date().toLocaleTimeString()}`;
    const navigate = (data, hash) => { history.pushState(null, '', `?${new URLSearchParams(data)}#${hash}`); render(); };
    document.querySelector('#search-form')?.addEventListener('submit', e => { e.preventDefault(); navigate(new FormData(e.target), 'evidence'); });
    document.querySelector('#compare-form')?.addEventListener('submit', e => { e.preventDefault(); navigate(new FormData(e.target), 'compare'); });
    for (const [key, delta] of [['prev', -30], ['next', 30]]) document.querySelector(`#${key}`)?.addEventListener('click', () => { const p = new URLSearchParams(location.search); p.set('offset', String(Math.max(0, (Number(p.get('offset')) || 0) + delta))); navigate(p, 'evidence'); });
  } catch (e) { if (version === rendering) { error.textContent = e.message; error.hidden = false; } }
}
window.addEventListener('hashchange', render); window.addEventListener('popstate', render);
let pending;
const events = new EventSource('/api/events');
events.onopen = () => document.querySelector('#connection').textContent = '已连接 · 实时更新';
events.onerror = () => document.querySelector('#connection').textContent = '连接中断 · 自动恢复';
events.onmessage = () => { if (!pending) pending = setTimeout(() => { pending = null; if (!document.querySelector('input:focus')) render(); }, 700); };
render();
