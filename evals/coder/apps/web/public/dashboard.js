import { t, locale, setLocale, formatDate } from './i18n.js';

const view = document.querySelector('#view');
const error = document.querySelector('#error');
const esc = value => String(value ?? t('unknown')).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tx = (key, values) => esc(t(key, values));
const icons = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  runs: '<path d="m8 5 11 7-11 7z"/>', evidence: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  compare: '<path d="M3 7h18m-4-4 4 4-4 4M21 17H3m4-4-4 4 4 4"/>', improvements: '<path d="m3 17 6-6 4 4 8-10M15 5h6v6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/>', monitor: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] ?? icons.evidence}</svg>`;
const badge = value => `<span class="badge ${/^[a-z_]+$/.test(String(value)) ? value : ''}" title="${esc(value)}">${tx(value ?? 'unknown')}</span>`;
const pretty = value => `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`;
const tr = cells => `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
const table = (head, rows) => `<div class="table-wrap" tabindex="0"><table><thead><tr>${head.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const empty = text => `<div class="empty">${esc(text)}</div>`;
const link = e => `<a href="#evidence/${encodeURIComponent(e.id)}">${esc(e.benchmark)}</a>`;
const choose = e => {
  const left = new URLSearchParams(location.search).get('left');
  return `<a href="?left=${encodeURIComponent(e.id)}#compare">${tx('baseline')}</a> · <a href="?${left ? 'left=' + encodeURIComponent(left) + '&amp;' : ''}right=${encodeURIComponent(e.id)}#compare">${tx('candidate')}</a>`;
};
const auditTable = rows => table(['task', 'httpLedgerResponses', 'auxiliaryUnknown', 'tokens', 'delta', 'identity', 'settled'].map(k => t(k)), rows.map(a => tr([
  esc(a.id), `${esc(a.physicalRequests)} / ${esc(a.runtimeRequests)} / ${esc(a.taskResponses)}`, `${esc(a.auxiliaryRequests)} / ${esc(a.unknownRequests)}`,
  `${esc(a.wireTokens)} (${tx('observed', { value: a.observedWireTokens ?? t('unknown') })}) / ${esc(a.runtimeTokens)}`, esc(a.providerMinusRuntimeTokens), badge(a.usageMatched ? 'matched' : a.knownPerRequestUsageMatched ? 'partial_unknown' : 'mismatch') + badge(a.perRequestMatched ? 'identity_matched' : 'identity_unverified'), esc(a.settledChargeCreditMicro),
]))).replace('class="table-wrap"', 'class="table-wrap audit-table"');
const acceptancePanel = value => !value ? '' : `<div class="card"><h3>${tx('personalAcceptance')}</h3><p>${tx('deliveredIn', { value: value.deliveredInMs })} · ${tx('independentChecks', { count: value.qualityChecks })} ${badge(value.qualityPassed ? 'passed' : 'failed')} · ${tx('overall')} ${badge(value.overallAccepted ? 'passed' : 'failed')}</p><p class="muted">${tx('originalGradeNote')}</p>${table(['latencyFailure', 'measured', 'threshold'].map(k => t(k)), (value.latencyFailures ?? []).map(item => tr([esc(item.key), esc(item.actual), esc(item.limit)])))}</div>`;
function tally(e) {
  const counts = {};
  for (const trial of e.trials) counts[trial.assessment] = (counts[trial.assessment] ?? 0) + 1;
  return Object.entries(counts).map(([key, count]) => `${badge(key)} ${count}`).join(' · ') || tx('summaryOnly');
}
async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? t('requestFailed'));
  return data;
}
function benchmarkCard(b) {
  return `<article class="card benchmark-card"><div class="benchmark-heading"><div><h3>${tx(b.id)}</h3><div class="benchmark-id">${esc(b.id)}</div></div>${badge(b.level)}</div><p class="capabilities">${b.capabilities.map(key => tx(key === 'evidence' ? 'evidenceCapability' : key)).join(' · ')}</p><div>${badge(b.lifecycle)}${b.latestAttempt ? badge(b.latestAttempt.evidenceClass) : ''}</div><div class="benchmark-state"><div><span class="label">${tx('latestEvidence')}</span>${b.latestAttempt ? badge(b.latestAttempt.validity) : `<span>${tx('noEvidence')}</span>`}</div><div><span class="label">${tx('liveEvidence')}</span><span>${b.latestLiveCompleteValid ? `<a href="#evidence/${encodeURIComponent(b.latestLiveCompleteValid.id)}">${tx('yes')}</a>` : tx('unknown')}</span></div><div><span class="label">${tx('promotedEvidence')}</span><span>${b.latestPromoted ? `<a href="#evidence/${encodeURIComponent(b.latestPromoted.id)}">${tx('yes')}</a>` : tx('no')}</span></div></div>${b.latestAttempt ? `<a class="card-link" href="#evidence/${encodeURIComponent(b.latestAttempt.id)}">${tx('viewEvidence')}${icon('arrow')}</a>` : `<span class="card-link">${tx('noEvidence')}</span>`}</article>`;
}
let connection = 'connecting';
let updatedAt;
let rendering = 0;
let renderedRoute;
function updateChrome() {
  document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-label]').forEach(node => {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
    if (node.tagName === 'BUTTON') node.title = t(node.dataset.i18nLabel);
  });
  document.querySelectorAll('[data-locale]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.locale === locale)));
  document.querySelectorAll('button[data-theme]').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.theme === document.documentElement.dataset.theme)));
  document.querySelector('#connection').textContent = t(connection);
  document.querySelector('#connection-dot').classList.toggle('connected', connection === 'connected');
  if (updatedAt) document.querySelector('#updated').textContent = t('updated', { time: updatedAt.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
}
const storePreference = (key, value) => { try { localStorage.setItem('xopc.evals.' + key, value); } catch { /* Appearance still works when storage is unavailable. */ } };
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
function applyTheme(value) {
  document.documentElement.dataset.theme = value;
  document.documentElement.classList.toggle('dark', value === 'dark' || value === 'system' && systemTheme.matches);
  updateChrome();
}
document.querySelectorAll('[data-icon]').forEach(node => node.insertAdjacentHTML('afterbegin', icon(node.dataset.icon)));
document.querySelectorAll('button[data-theme]').forEach(node => node.addEventListener('click', () => { storePreference('theme', node.dataset.theme); applyTheme(node.dataset.theme); }));
document.querySelectorAll('[data-locale]').forEach(node => node.addEventListener('click', () => { storePreference('locale', node.dataset.locale); setLocale(node.dataset.locale); updateChrome(); render(); }));
systemTheme.addEventListener('change', () => { if (document.documentElement.dataset.theme === 'system') applyTheme('system'); });
window.addEventListener('storage', event => {
  if (event.key === 'xopc.evals.theme') applyTheme(['light', 'dark', 'system'].includes(event.newValue) ? event.newValue : 'system');
  if (event.key === 'xopc.evals.locale') { setLocale(event.newValue); updateChrome(); render(); }
});
async function render() {
  const version = ++rendering;
  error.hidden = true;
  const [route, id, trial] = location.hash.slice(1).split('/');
  const current = ['overview', 'runs', 'evidence', 'compare', 'improvements'].includes(route) ? route : 'overview';
  document.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current', a.hash === `#${current}` ? 'page' : 'false'));
  document.querySelector('#title').textContent = t(current);
  document.querySelector('#page-description').textContent = t(current + 'Description');
  document.title = `${t(current)} · xopc Evals`;
  updateChrome();
  const routeKey = `${current}/${id ?? ''}/${trial ?? ''}`;
  if (renderedRoute !== routeKey) { view.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>'; renderedRoute = routeKey; }
  view.setAttribute('aria-busy', 'true');
  try {
    let html;
    if (current === 'overview') {
      const data = await api('/api/overview');
      const metrics = [['evidenceCount', data.evidenceCount], ['benchmarkCount', data.benchmarks.length], ['liveValidCount', data.benchmarks.filter(b => b.latestLiveCompleteValid).length], ['reviewCount', data.benchmarks.filter(b => b.latestAttempt && b.latestAttempt.validity !== 'valid').length]];
      html = `<div class="metrics">${metrics.map(([key, value]) => `<div class="metric"><span class="metric-label">${tx(key)}</span><strong class="metric-number">${esc(value)}</strong></div>`).join('')}</div><p class="scope-note">${icon('info')}<span>${tx('scopeNote')}</span></p><div class="section-heading"><h2>${tx('capabilityCoverage')}</h2><span>${tx('registeredFamilies', { count: data.benchmarks.length })}</span></div><div class="grid">${data.benchmarks.map(benchmarkCard).join('')}</div><h2>${tx('sourceHealth')}</h2>${table(['source', 'checked', 'state'].map(k => t(k)), data.sources.map(s => tr([`<code>${esc(s.path)}</code>`, esc(formatDate(s.checked_at)), s.error ? esc(s.error) : tx('readable')])))}`;
    } else if (current === 'runs') {
      const [campaigns, activity] = await Promise.all([api('/api/campaigns'), api('/api/activity')]);
      html = campaigns.length ? campaigns.map(c => `<article class="card"><h2>${esc(c.id)}</h2>${badge(c.status)}${badge(c.validity)}${badge(c.promotion)}${c.candidateDecision ? `<p>${tx('candidateDecision')} ${badge(c.candidateDecision)}</p>` : ''}<p class="muted">${tx('sourceCode')}: <code>${esc(c.sourceHash)}</code></p><p>${tx('plannedStarted', { planned: c.expectedJobs ?? c.plan?.length ?? t('unknown'), started: Object.keys(c.jobs ?? {}).length })} · ${esc(formatDate(c.updatedAt))}</p><div class="metrics">${[['queuedLabel', c.scheduler?.queued], ['activeLabel', c.scheduler?.active], ['finishedLabel', (c.scheduler?.completed ?? 0) + (c.scheduler?.failed ?? 0)], ['canceledLabel', c.scheduler?.cancelled]].map(([label, value]) => `<div class="metric"><span class="metric-label">${tx(label)}</span><span class="stat">${esc(value)}</span></div>`).join('')}</div><p class="muted">${(c.plan ?? []).map(j => `${esc(j.id)}${j.dependsOn?.length ? ' ← ' + j.dependsOn.map(esc).join(', ') : ''}`).join(' · ')}</p><h3>${tx('sharedPool')}</h3><p>${tx('generation')} ${esc(c.pool?.byRole?.generation)} / ${esc(c.pool?.targets?.generation)} · ${tx('judge')} ${esc(c.pool?.byRole?.judge)} / ${esc(c.pool?.targets?.judge)} · ${tx('totalRequests')} ${esc(c.pool?.active)} / ${esc(c.pool?.parent)} · ${tx('queued')} ${esc(c.pool?.queued)}</p><p class="muted">${tx('budget', { value: c.budget?.maxWallMs ?? t('unknown') })}</p>${table(['task', 'state', 'duration', 'reason'].map(k => t(k)), Object.entries(c.jobs ?? {}).map(([key, j]) => tr([esc(key), badge(j.status), `${esc(j.durationMs)} ms`, esc(j.stopReason ?? j.reason ?? '—')])))}${c.reconciliation ? `<h3>${tx('reconciliation')}</h3>${auditTable(c.reconciliation)}<p class="muted">${tx('chargeNote')}</p>` : ''}<details><summary>${tx('coverage')}</summary>${pretty({ output: c.output, coverage: c.requestCoverage })}</details></article>`).join('') : empty(t('noRuns'));
      html += `<h2>${tx('recentEvents')}</h2>${table(['sequence', 'event', 'time'].map(k => t(k)), activity.map(e => tr([esc(e.seq), esc(e.type), esc(formatDate(e.at))])))}`;
    } else if (current === 'evidence' && id) {
      const e = await api(`/api/evidence/${encodeURIComponent(id)}`);
      if (trial) html = `<a href="#evidence/${encodeURIComponent(id)}">${tx('backEvidence')}</a>${pretty(await api(`/api/evidence/${encodeURIComponent(id)}/runs/${encodeURIComponent(trial)}`))}`;
      else html = `<div class="card"><h2>${esc(e.benchmark)}</h2>${e.currentReview?.blocked ? `<p class="muted">${tx('protocolBlocked')}</p>` : ''}${badge(e.evidenceClass)}${badge(e.validity)}${badge(e.complete ? 'complete' : 'incomplete')}<p>${tally(e)}</p><p>${tx('denominator', { expected: e.expected ?? t('unknown'), count: e.trials.length })}</p><code>${esc(e.id)}</code><p>${choose(e)}</p><p class="muted">${e.reasons.map(esc).join(' · ')}</p></div>${table(['task', 'variant', 'execution', 'grade', 'duration'].map(k => t(k)), e.trials.map(trial => tr([`<a href="#evidence/${encodeURIComponent(e.id)}/${encodeURIComponent(trial.id)}">${esc(trial.caseId)}</a>`, `${esc(trial.variant)} / ${esc(trial.repetition)}`, badge(trial.execution), badge(trial.assessment), `${esc(trial.durationMs)} ms`])))}<div class="grid"><div class="card"><h2>${tx('matching')}</h2>${pretty(e.identity)}</div><div class="card"><h2>${tx('nativeMetrics')}</h2>${pretty(e.metrics)}</div></div><details><summary>${tx('sourceVersions')}</summary>${pretty({ source: e.source, hash: e.sourceHash, lineage: e.lineage, importedAt: e.importedAt })}</details>`;
    } else if (current === 'compare') {
      const params = new URLSearchParams(location.search);
      const left = params.get('left') ?? '', right = params.get('right') ?? '';
      html = `<form id="compare-form" class="filters"><label>${tx('baselineId')}<input name="left" required value="${esc(left)}"></label><label>${tx('candidateId')}<input name="right" required value="${esc(right)}"></label><button>${tx('compareEvidence')}</button></form>`;
      if (left && right) {
        const data = await api(`/api/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
        html += `<div class="card">${pretty(data.summary)}${badge(data.comparable ? 'comparable' : 'incomparable')}${badge(data.decision)}<p>${data.mismatches.map(esc).join(' · ')}</p></div>${table(['pair', 'baselineLabel', 'candidateLabel'].map(k => t(k)), data.pairs.map(p => tr([esc(p.key), badge(p.baseline?.assessment ?? 'unknown'), badge(p.candidate?.assessment ?? 'unknown')])) )}`;
      }
      const choices = await api('/api/evidence');
      html += `<h2>${tx('selectEvidence')}</h2>${table(['benchmark', 'type', 'selection'].map(k => t(k)), choices.items.map(e => tr([link(e), badge(e.evidenceClass), choose(e)])))}`;
    } else if (current === 'improvements') {
      const data = await api('/api/improvements');
      html = data.length ? data.map(i => {
        const decision = i.decision;
        const audit = i.supplements?.findLast(s => Array.isArray(s.data?.audit))?.data.audit ?? decision?.audit;
        return `<article class="card"><h2>${esc(i.problem)}</h2><p>${esc(i.hypothesis)}</p>${badge(i.promotion)}${acceptancePanel(decision?.personalAcceptance)}${i.supplements?.length ? `<details><summary>${tx('supplements', { count: i.supplements.length })}</summary>${i.supplements.map(s => pretty(s.data)).join('')}</details>` : ''}${decision && Array.isArray(decision.audit) ? `${decision.tokens !== undefined ? `<p>${tx('physicalUsage', { count: decision.physicalRequests, tokens: decision.tokens ?? t('unknown') })}</p><p class="muted">${esc(decision.scope)}</p>` : `<p>${tx('baselineTokens')} ${esc(decision.baselineTokens)} · ${tx('candidateTokens')} ${esc(decision.candidateTokens)} · ${tx('reduction')} ${decision.tokenReduction === null ? tx('unknown') : (decision.tokenReduction * 100).toFixed(1) + '%'}</p>`}<p>${decision.reasons.length ? decision.reasons.map(esc).join(' · ') : tx('gatesPassed')}</p>${table(['phase', 'passedPlanned'].map(k => t(k)), decision.reports.map(r => tr([esc(r.id), `${esc(r.passed)} / ${esc(r.expected)}`])))}${auditTable(audit)}<p class="muted">${esc(decision.independentValidation)}<br>${tx('defaultsChanged')}: ${tx(decision.productionDefaultsChanged ? 'yesChanged' : 'noChanged')}</p>${decision.protocolReview ? `<div class="card"><h3>${tx('protocolReview')}</h3><p>${esc(decision.protocolReview.finding)}</p><p class="muted">${esc(decision.protocolReview.disposition)}</p></div>` : ''}${decision.queueTiming ? `<details><summary>${tx('timings')}</summary>${pretty({ queue: decision.queueTiming, timing: decision.timing })}</details>` : ''}<p>${(decision.evidenceIds ?? []).map(id => `<a href="#evidence/${encodeURIComponent(id)}">${tx('evidence')} ${esc(id.slice(0, 8))}</a>`).join(' · ')}</p><details><summary>${tx('decisionFingerprint')}</summary>${pretty(i)}</details>` : pretty(i)}</article>`;
      }).join('') : empty(t('noImprovements'));
    } else {
      const params = new URLSearchParams(location.search), q = params.get('q') ?? '', offset = Number(params.get('offset')) || 0;
      const data = await api(`/api/evidence?q=${encodeURIComponent(q)}&offset=${offset}`);
      html = `<form id="search-form" class="filters"><label>${tx('searchLabel')}<input name="q" value="${esc(q)}"></label><button>${tx('filter')}</button></form><p class="muted">${tx('evidenceListCount', { count: data.total })}</p>${table(['benchmark', 'typeCompleteness', 'results', 'validity', 'model', 'compare'].map(k => t(k)), data.items.map(e => tr([link(e), `${badge(e.evidenceClass)}${badge(e.complete ? 'complete' : 'incomplete')}`, tally(e), badge(e.validity), esc(e.identity.model), choose(e)])))}<div class="filters"><button id="prev" ${offset ? '' : 'disabled'}>${tx('previous')}</button><button id="next" ${offset + 30 < data.total ? '' : 'disabled'}>${tx('next')}</button></div>`;
    }
    if (version !== rendering) return;
    view.innerHTML = html;
    updatedAt = new Date(); updateChrome();
    const navigate = (data, hash) => { history.pushState(null, '', `?${new URLSearchParams(data)}#${hash}`); render(); };
    document.querySelector('#search-form')?.addEventListener('submit', e => { e.preventDefault(); navigate(new FormData(e.target), 'evidence'); });
    document.querySelector('#compare-form')?.addEventListener('submit', e => { e.preventDefault(); navigate(new FormData(e.target), 'compare'); });
    for (const [key, delta] of [['prev', -30], ['next', 30]]) document.querySelector(`#${key}`)?.addEventListener('click', () => { const p = new URLSearchParams(location.search); p.set('offset', String(Math.max(0, (Number(p.get('offset')) || 0) + delta))); navigate(p, 'evidence'); });
  } catch (e) { if (version === rendering) { error.textContent = e.message; error.hidden = false; } }
  finally { if (version === rendering) view.setAttribute('aria-busy', 'false'); }
}
window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
let pending;
const events = new EventSource('/api/events');
events.onopen = () => { connection = 'connected'; updateChrome(); };
events.onerror = () => { connection = 'reconnecting'; updateChrome(); };
events.onmessage = () => {
  if (!pending) pending = setTimeout(() => {
    pending = null;
    // Keep focused controls and open evidence disclosures stable during live refresh.
    if (!view.querySelector('input:focus, button:focus, summary:focus, details[open]')) render();
  }, 700);
};
updateChrome();
render();
