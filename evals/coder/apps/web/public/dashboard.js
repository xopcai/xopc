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
const auditTable = rows => table(['task', 'httpLedgerResponses', 'auxiliaryUnknown', 'tokens', 'delta', 'identity', 'settled'].map(k => t(k)), rows.map(a => tr([
  esc(a.id), `${esc(a.physicalRequests)} / ${esc(a.runtimeRequests)} / ${esc(a.taskResponses)}`, `${esc(a.auxiliaryRequests)} / ${esc(a.unknownRequests)}`,
  `${esc(a.wireTokens)} (${tx('observed', { value: a.observedWireTokens ?? t('unknown') })}) / ${esc(a.runtimeTokens)}`, esc(a.providerMinusRuntimeTokens), badge(a.usageMatched ? 'matched' : a.knownPerRequestUsageMatched ? 'partial_unknown' : 'mismatch') + badge(a.perRequestMatched ? 'identity_matched' : 'identity_unverified'), esc(a.settledChargeCreditMicro),
]))).replace('class="table-wrap"', 'class="table-wrap audit-table"');
const acceptancePanel = value => !value ? '' : `<div class="card"><h3>${tx('personalAcceptance')}</h3><p>${tx('deliveredIn', { value: value.deliveredInMs })} · ${tx('independentChecks', { count: value.qualityChecks })} ${badge(value.qualityPassed ? 'passed' : 'failed')} · ${tx('overall')} ${badge(value.overallAccepted ? 'passed' : 'failed')}</p><p class="muted">${tx('originalGradeNote')}</p>${table(['latencyFailure', 'measured', 'threshold'].map(k => t(k)), (value.latencyFailures ?? []).map(item => tr([esc(item.key), esc(item.actual), esc(item.limit)])))}</div>`;
async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw Error(data.error ?? t('requestFailed'));
  return data;
}
const urlFor = (route, values = {}) => {
  const params = new URLSearchParams(Object.entries(values).filter(([, value]) => value !== undefined && value !== ''));
  return `/${params.size ? '?' + params : ''}#${route}`;
};
const action = (route, label, values, primary = false) => `<a class="action ${primary ? 'primary' : ''}" href="${esc(urlFor(route, values))}">${tx(label)}${icon('arrow')}</a>`;
const backLink = (route, label) => `<a class="breadcrumb" href="${esc(urlFor(route))}">${icon('arrow')}${tx(label)}</a>`;
const disclosure = (label, body, open = false) => `<details class="disclosure" ${open ? 'open' : ''}><summary>${tx(label)}</summary><div class="disclosure-body">${body}</div></details>`;
const sceneState = b => {
  const e = b.latestAttempt;
  if (!e && b.lifecycle === 'planned') return 'planned';
  if (e && (e.validity !== 'valid' || !e.complete || e.trials.some(trial => ['failed', 'error'].includes(trial.assessment) || trial.execution === 'error'))) return 'needsAttention';
  if (b.latestLiveCompleteValid) return 'liveCovered';
  return e ? 'calibrationOnly' : 'noResults';
};
const sceneHint = state => ({ needsAttention: 'reviewHint', liveCovered: 'liveHint', calibrationOnly: 'calibrationHint', noResults: 'unrunHint', planned: 'plannedHint' })[state];
const sceneBadge = state => `<span class="status-label ${state}">${tx(state)}</span>`;
const modelName = e => e.identity.model ?? t(e.evidenceClass === 'deterministic' ? 'noModelRequired' : 'modelNotRecorded');
const resultScore = e => {
  const graded = e.trials.filter(trial => ['passed', 'failed'].includes(trial.assessment));
  if (!graded.length) return tx('noBinaryGrade');
  return tx(e.expected === null ? 'scoredOnly' : 'passedOf', { passed: graded.filter(trial => trial.assessment === 'passed').length, total: e.expected });
};

const chips = (route, options, selected = '', params = {}) => `<div class="filter-chips" aria-label="${tx('filter')}">${options.map(([value, label]) => `<a href="${esc(urlFor(route, { ...params, status: value }))}" ${value === selected ? 'aria-current="true"' : ''}>${tx(label)}</a>`).join('')}</div>`;
function sceneCard(b) {
  const state = sceneState(b);
  return `<article class="card scene-card"><div class="row-between"><h3><a href="#benchmarks/${encodeURIComponent(b.id)}">${tx(b.id)}</a></h3>${sceneBadge(state)}</div><p class="scene-question">${tx(b.id + '.question')}</p><p class="muted small-copy">${tx(sceneHint(state))}</p><div class="scene-result">${b.latestAttempt ? `<strong>${resultScore(b.latestAttempt)}</strong><span>${badge(b.latestAttempt.evidenceClass)}</span>` : `<span>${tx('noResults')}</span>`}</div><div class="card-actions">${action(`benchmarks/${encodeURIComponent(b.id)}`, b.latestAttempt ? 'seeScene' : 'seeMethod')}</div></article>`;
}
const runTitle = c => {
  const id = String(c.id);
  if (/personal/.test(id)) return t('personalRun');
  if (/cancellation/.test(id)) return t('cancellationRun');
  if (/usage-tail|usage-diagnostic/.test(id)) return t('usageRun');
  if (/live-cycle/.test(id)) return t('convergenceRun');
  if (/stage-one-pilot/.test(id)) return t('pilotRun');
  return id;
};
const runDone = c => Object.values(c.jobs ?? {}).filter(job => ['passed', 'failed', 'completed', 'interrupted', 'cancelled', 'canceled', 'timed_out'].includes(job.status)).length;
const runExpected = c => c.expectedJobs ?? c.plan?.length ?? Object.keys(c.jobs ?? {}).length;
const runHint = c => ['running', 'paused'].includes(c.status) ? 'runActive' : c.status === 'completed' ? 'runFinished' : 'runNeedsReview';
function compactRun(c) {
  return `<a class="record-row" href="#runs/${encodeURIComponent(c.id)}"><div><strong>${esc(runTitle(c))}</strong><span class="muted small-copy">${esc(formatDate(c.startedAt ?? c.updatedAt))} · ${tx('jobsSummary', { done: runDone(c), total: runExpected(c) })}</span></div><span>${badge(c.status)}${icon('arrow')}</span></a>`;
}
async function renderOverview() {
  const [data, campaigns, improvements] = await Promise.all([api('/api/overview'), api('/api/campaigns'), api('/api/improvements')]);
  const flagged = data.benchmarks.filter(b => sceneState(b) === 'needsAttention');
  const live = data.benchmarks.filter(b => b.latestLiveCompleteValid).length;
  const noResults = data.benchmarks.filter(b => !b.latestAttempt).length;
  const active = campaigns.filter(c => ['running', 'paused'].includes(c.status));
  const metrics = [['attentionMetric', flagged.length, 'benchmarks', { status: 'needsAttention' }], ['liveMetric', live, 'benchmarks', { status: 'liveCovered' }], ['unrunMetric', noResults, 'benchmarks', { status: 'noResults' }], ['activeMetric', active.length, 'runs', { status: 'active' }]];
  const steps = [['01', 'chooseScene', 'chooseSceneHelp', 'benchmarks'], ['02', 'understandResult', 'understandResultHelp', 'evidence'], ['03', 'verifyChange', 'verifyChangeHelp', 'improvements']];
  return `<div class="metrics action-metrics">${metrics.map(([key, value, route, params]) => `<a class="metric" href="${esc(urlFor(route, params))}"><span class="metric-label">${tx(key)}</span><strong class="metric-number">${esc(value)}</strong><span class="metric-arrow">${icon('arrow')}</span></a>`).join('')}</div><div class="work-columns"><section class="card"><div class="section-heading"><h2>${tx('attentionTitle')}</h2><a href="${esc(urlFor('benchmarks', { status: 'needsAttention' }))}">${tx('viewAttention')}</a></div>${flagged.length ? flagged.map(b => `<a class="record-row" href="#benchmarks/${encodeURIComponent(b.id)}"><div><strong>${tx(b.id)}</strong><span class="muted small-copy">${tx('reviewHint')}</span></div><span>${sceneBadge('needsAttention')}${icon('arrow')}</span></a>`).join('') : empty(t('attentionEmpty'))}</section><section class="card"><div class="section-heading"><h2>${tx('latestChanges')}</h2><a href="/#improvements">${tx('seeChanges')}</a></div>${improvements.length ? improvements.slice(0, 3).map(i => `<a class="record-row" href="#improvements/${encodeURIComponent(i.id)}"><div><strong>${esc(i.problem)}</strong><span class="muted small-copy">${tx(i.promotion === 'promoted' ? 'changeAccepted' : i.promotion === 'rejected' ? 'changeRejected' : 'changePending')}</span></div>${badge(i.promotion)}</a>`).join('') : empty(t('noImprovements'))}</section></div><section class="card"><div class="section-heading"><h2>${tx(active.length ? 'inProgress' : 'recentRuns')}</h2><a href="/#runs">${tx('seeRun')}</a></div>${(active.length ? active : campaigns.slice(0, 3)).map(compactRun).join('') || empty(t('noRuns'))}</section><div class="section-heading"><h2>${tx('firstSteps')}</h2></div><div class="journey">${steps.map(([number, title, help, route]) => `<a href="#${route}" class="journey-step"><span class="step-number">${number}</span><div><h3>${tx(title)}</h3><p>${tx(help)}</p></div>${icon('arrow')}</a>`).join('')}</div><p class="scope-note">${icon('info')}<span>${tx('scopeNote')}</span></p>${disclosure('sourceHealthAdvanced', table(['source', 'checked', 'state'].map(k => t(k)), data.sources.map(s => tr([`<code>${esc(s.path)}</code>`, esc(formatDate(s.checked_at)), s.error ? esc(s.error) : tx('readable')]))))}`;
}
function matchesImprovement(item, records) {
  const ids = new Set([...(item.decision?.evidenceIds ?? []), ...(item.supplements ?? []).flatMap(s => s.data?.evidenceIds ?? [])]);
  const audits = [...(item.decision?.audit ?? []), ...(item.supplements ?? []).flatMap(s => s.data?.audit ?? [])];
  return records.some(record => ids.has(record.id) || audits.some(audit => {
    const ledger = audit.files?.ledger;
    return typeof ledger === 'string' && record.source.startsWith(ledger.slice(0, ledger.lastIndexOf('/') + 1));
  }));
}
function relatedChanges(items) {
  return items.length ? `<section class="card"><h2>${tx('relatedChanges')}</h2>${items.map(item => `<a class="record-row" href="${esc(urlFor(`improvements/${item.id}`))}"><div><strong>${esc(item.problem)}</strong><span class="muted small-copy">${tx('seeDecision')}</span></div>${badge(item.promotion)}</a>`).join('')}</section>` : '';
}
async function renderBenchmarks(id) {
  const data = await api('/api/overview');
  if (id) {
    const b = data.benchmarks.find(b => b.id === id);
    if (!b) throw Error(t('noMatchingScenes'));
    const records = await api(`/api/evidence?benchmark=${encodeURIComponent(id)}&limit=100`);
    const changes = (await api('/api/improvements')).filter(item => matchesImprovement(item, records.items));
    const state = sceneState(b);
    document.querySelector('#title').textContent = t(b.id);
    document.querySelector('#page-description').textContent = t(b.id + '.question');
    return `${backLink('benchmarks', 'viewAllScenes')}<div class="card scene-intro"><div class="row-between"><h2>${tx('currentFinding')}</h2>${sceneBadge(state)}</div><p>${tx(sceneHint(state))}</p><div class="card-actions">${b.latestAttempt ? action(`evidence/${b.latestAttempt.id}`, 'seeResult', undefined, true) : '<a class="action primary" href="#evaluation-method">'+tx('seeMethod')+'</a>'}${records.total > 1 ? action('compare', 'compareThis', { benchmark: id }) : ''}</div></div><div class="work-columns"><section class="card"><h2>${tx('whatEvaluates')}</h2><p>${tx(b.id + '.question')}</p><div class="capability-tags">${b.capabilities.map(key => badge(key === 'evidence' ? 'evidenceCapability' : key)).join('')}</div><p class="muted small-copy">${tx('responsible')}: ${esc(b.owner)}</p></section><section class="card"><h2>${tx('howToRead')}</h2><dl class="reading-guide"><div><dt>${tx('caseOutcome')}</dt><dd>${tx('scoreExplainer')}</dd></div><div><dt>${tx('evidenceConditions')}</dt><dd>${tx('validityExplainer')}</dd></div><div><dt>${tx('modelCoverage')}</dt><dd>${tx('coverageExplainer')}</dd></div></dl></section></div><div class="section-heading"><h2>${tx('resultHistory')}</h2><span>${tx('resultsCount', { count: records.total })}</span></div>${records.items.length ? resultRecords(records.items) : empty(t('noResultHistory'))}${relatedChanges(changes)}<section class="card" id="evaluation-method"><h2>${tx('evaluationMethod')}</h2><p>${tx(b.lifecycle === 'planned' ? 'planNotReady' : 'executionHelp')}</p><ol class="method-steps">${t(b.lifecycle === 'planned' ? 'plannedSteps' : 'executionSteps').split('\n').map(line => `<li>${esc(line.replace(/^\d\. /, ''))}</li>`).join('')}</ol>${b.lifecycle === 'planned' ? '' : action('runs', 'openRunGuide')}${disclosure('technicalDetails', pretty({ benchmark: b.id, level: b.level, scenarios: b.scenarios, owner: b.owner }))}</section>`;
  }
  const params = new URLSearchParams(location.search), status = params.get('status') ?? '', q = params.get('q') ?? '';
  const filtered = data.benchmarks.filter(b => (!status || (status === 'liveCovered' ? Boolean(b.latestLiveCompleteValid) : status === 'noResults' ? !b.latestAttempt : sceneState(b) === status)) && `${t(b.id)} ${b.id} ${b.capabilities.map(key => t(key)).join(' ')}`.toLowerCase().includes(q.toLowerCase()));
  return `<form id="scene-search" class="filters scene-search"><label>${tx('searchScenes')}<input name="q" value="${esc(q)}" placeholder="${tx('searchScenes')}"></label><button>${tx('filter')}</button></form>${chips('benchmarks', [['', 'allScenes'], ['needsAttention', 'needsAttention'], ['liveCovered', 'liveCovered'], ['noResults', 'noResults'], ['calibrationOnly', 'calibrationOnly']], status, { q })}<div class="filter-results"><div class="section-heading"><h2>${tx('capabilityCoverage')}</h2><span>${tx('resultsFound', { count: filtered.length })}</span></div>${filtered.length ? `<div class="grid">${filtered.map(sceneCard).join('')}</div>` : empty(t('noMatchingScenes'))}${status || q ? action('benchmarks', 'clearFilters') : ''}</div>`;
}
function resultRecords(items) {
  return `<div class="result-records">${items.map(e => `<article class="card result-record"><div><h3><a href="#evidence/${e.id}">${tx(e.benchmark)}</a></h3><p class="muted small-copy">${esc(modelName(e))} · ${esc(formatDate(e.createdAt ?? e.importedAt))}</p><div>${badge(e.evidenceClass)}${badge(e.validity)}${badge(e.complete ? 'complete' : 'incomplete')}</div></div><div class="result-record-score"><strong>${resultScore(e)}</strong>${action(`evidence/${e.id}`, 'seeResult')}</div></article>`).join('')}</div>`;
}
async function renderRuns(id) {
  const campaigns = await api('/api/campaigns');
  if (!id) {
    const status = new URLSearchParams(location.search).get('status') ?? '';
    const items = campaigns.filter(c => !status || (status === 'active' ? ['running', 'paused'].includes(c.status) : !['running', 'paused', 'completed'].includes(c.status)));
    return `${chips('runs', [['', 'allRuns'], ['active', 'inProgress'], ['failed', 'failedRuns']], status)}<section class="card">${items.map(compactRun).join('') || empty(t(campaigns.length ? 'noFilteredRuns' : 'noRuns'))}${status && !items.length ? action('runs', 'allRuns') : ''}</section>`;
  }
  const c = campaigns.find(c => c.id === id);
  if (!c) throw Error(t('requestFailed'));
  document.querySelector('#title').textContent = runTitle(c);
  const related = await api('/api/evidence?limit=100');
  const records = related.items.filter(e => c.output && e.source.startsWith(c.output + '/'));
  return `${backLink('runs', 'backRuns')}<section class="card"><div class="row-between"><h2>${tx('runResult')}</h2>${badge(c.status)}</div><p>${tx(runHint(c))}</p><p class="score-large">${tx('jobsSummary', { done: runDone(c), total: runExpected(c) })}</p><p class="muted">${esc(formatDate(c.startedAt ?? c.updatedAt))} · ${esc(c.elapsedMs ?? t('unknown'))} ms</p></section><section class="card"><h2>${tx('runTasks')}</h2>${table(['task', 'state', 'duration', 'reason'].map(k => t(k)), Object.entries(c.jobs ?? {}).map(([name, job]) => tr([esc(name), badge(job.status), `${esc(job.durationMs)} ms`, esc(job.stopReason ?? job.reason ?? '—')])) )}</section><h2>${tx('relatedResults')}</h2>${records.length ? resultRecords(records) : empty(t('noRelatedResults'))}${disclosure('runtimeDetails', `${c.reconciliation ? `<h3>${tx('reconciliation')}</h3>${auditTable(c.reconciliation)}<p class="muted">${tx('chargeNote')}</p>` : ''}${pretty(c)}`)}`;
}
async function renderResult(id, trial) {
  const e = await api(`/api/evidence/${encodeURIComponent(id)}`);
  if (trial) {
    const detail = await api(`/api/evidence/${id}/runs/${encodeURIComponent(trial)}`);
    const row = detail.trial;
    document.querySelector('#title').textContent = t('caseDetail');
    return `${backLink(`evidence/${id}`, 'backEvidence')}<section class="card"><div class="row-between"><h2>${esc(row.caseId)}</h2>${badge(row.assessment)}</div><div class="result-facts"><div><span>${tx('execution')}</span>${badge(row.execution)}</div><div><span>${tx('grade')}</span>${badge(row.assessment)}</div><div><span>${tx('duration')}</span><strong>${esc(row.durationMs)} ms</strong></div><div><span>Tokens</span><strong>${esc(row.tokens)}</strong></div></div>${detail.note ? `<p class="muted">${tx('trialNote')}</p>` : ''}</section>${disclosure('trialTrace', pretty(detail))}`;
  }
  const changes = (await api('/api/improvements')).filter(item => matchesImprovement(item, [e]));
  const failed = e.trials.filter(row => row.assessment !== 'passed');
  const good = e.complete && e.validity === 'valid' && !e.currentReview?.blocked;
  document.querySelector('#title').textContent = `${t(e.benchmark)} · ${t('resultDetail')}`;
  return `${backLink(`benchmarks/${e.benchmark}`, 'backScene')}<div class="card result-intro"><div class="row-between"><h2>${tx('resultSummary')}</h2>${badge(e.validity)}</div><div class="score-large">${resultScore(e)}</div><p>${tx(good ? 'resultAcceptedScope' : 'cannotConclude')}</p>${e.currentReview?.blocked ? `<p class="notice">${tx('protocolBlocked')}</p>` : ''}<div class="result-facts"><div><span>${tx('evidenceConditions')}</span>${badge(e.complete ? 'complete' : 'incomplete')}${badge(e.validity)}</div><div><span>${tx('modelCoverage')}</span>${badge(e.evidenceClass)}</div><div><span>${tx('model')}</span><strong>${esc(modelName(e))}</strong></div><div><span>${tx('resultDate')}</span>${esc(formatDate(e.createdAt ?? e.importedAt))}</div></div><div class="card-actions">${action('compare', 'compareThis', { benchmark: e.benchmark, left: e.id }, true)}${action(`benchmarks/${e.benchmark}`, 'resultHistory')}</div></div><section class="card"><h2>${tx('followUp')}</h2><p>${tx(e.currentReview?.blocked ? 'protocolNextStep' : !e.complete ? 'incompleteNextStep' : failed.length ? 'failureNextStep' : !good ? 'validityNextStep' : 'comparisonNextStep')}</p></section>${relatedChanges(changes)}<section class="card"><h2>${tx('failedCases')}</h2>${failed.length ? trialTable(e, failed) : `<p class="muted">${tx('noFailedCases')}</p>`}</section>${disclosure('allChecks', trialTable(e, e.trials))}${disclosure('provenanceDetails', `${pretty(e.identity)}<h3>${tx('sourceVersions')}</h3>${pretty({ source: e.source, hash: e.sourceHash, lineage: e.lineage, reasons: e.reasons, metrics: e.metrics })}`)}`;
}
const trialTable = (e, rows) => table(['task', 'variant', 'execution', 'grade', 'duration'].map(k => t(k)), rows.map(trial => tr([`<a href="#evidence/${e.id}/${trial.id}">${esc(trial.caseId)}</a>`, `${esc(trial.variant)} / ${esc(trial.repetition)}`, badge(trial.execution), badge(trial.assessment), `${esc(trial.durationMs)} ms`])));
async function renderComparison() {
  const params = new URLSearchParams(location.search), left = params.get('left') ?? '', right = params.get('right') ?? '';
  const selected = left ? await api(`/api/evidence/${encodeURIComponent(left)}`) : null;
  const benchmark = params.get('benchmark') ?? selected?.benchmark ?? '';
  if (!benchmark) {
    const data = await api('/api/overview');
    return `<section class="card"><h2>${tx('chooseSceneFirst')}</h2><p>${tx('compareInstruction')}</p><div class="selection-list">${data.benchmarks.filter(b => b.evidenceCount > 0).map(b => action('compare', b.id, { benchmark: b.id })).join('')}</div></section>`;
  }
  const records = await api(`/api/evidence?benchmark=${encodeURIComponent(benchmark)}&limit=100`);
  let html = `${backLink(`benchmarks/${benchmark}`, 'backScene')}<section class="card"><h2>${tx(benchmark)}</h2><p>${tx('compareInstruction')}</p>${records.total < 2 ? `<p class="notice">${tx('oneResultOnly')}</p>` : ''}<div class="comparison-picker">${[['left', 'chooseBaseline', left], ['right', 'chooseCandidate', right]].map(([side, label, chosen]) => `<fieldset><legend>${tx(label)}</legend><div class="picker-options">${records.items.map(e => `<label class="picker-option ${chosen === e.id ? 'selected' : ''}"><input type="radio" name="${side}" value="${e.id}" data-pick-result="${side}" ${chosen === e.id ? 'checked' : ''} ${e.id === (side === 'left' ? right : left) ? 'disabled' : ''}><span><strong>${esc(modelName(e))}</strong><span class="muted small-copy">${esc(formatDate(e.createdAt ?? e.importedAt))} · ${resultScore(e)}</span><span>${badge(e.evidenceClass)}${badge(e.validity)}</span></span></label>`).join('')}</div></fieldset>`).join('')}</div><p class="muted">${tx(left && right ? 'compareReady' : 'pickOtherResult')}</p></section>`;
  if (left && right) {
    if (left === right) return html + empty(t('compareSameRecord'));
    const data = await api(`/api/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
    html += `<section class="card" id="comparison-result"><div class="row-between"><h2>${tx('comparisonConclusion')}</h2>${badge(data.comparable ? 'comparable' : 'incomparable')}</div><p>${tx(data.comparable ? 'comparisonAllowed' : 'comparisonBlocked')}</p>${data.mismatches.length ? `<ul class="blocker-list">${data.mismatches.map(reason => `<li>${esc(comparisonReason(reason))}</li>`).join('')}</ul>` : ''}${data.comparable ? `<h3>${tx('comparisonSummary')}</h3><div class="metrics">${[['improvedChecks', data.summary.wins], ['regressedChecks', data.summary.losses], ['unchangedChecks', data.summary.ties], ['unresolvedChecks', data.summary.unresolved + data.summary.missing]].map(([key, value]) => `<div class="metric"><span class="metric-label">${tx(key)}</span><strong class="stat">${esc(value)}</strong></div>`).join('')}</div><p class="muted small-copy">${tx('compareNoPromotion')}</p>` : ''}${data.comparable ? table(['pair', 'baselineLabel', 'candidateLabel'].map(k => t(k)), data.pairs.map(pair => tr([esc(pair.key), badge(pair.baseline?.assessment ?? 'unknown'), badge(pair.candidate?.assessment ?? 'unknown')]))) : ''}${disclosure('comparisonScope', `${data.mismatches.length ? `<ul>${data.mismatches.map(reason => `<li>${esc(comparisonReason(reason))}</li>`).join('')}</ul>` : ''}${pretty(data.summary)}`)}</section>`;
  }
  return html;
}
function comparisonReason(reason) {
  const keys = { benchmark: 'benchmark', evidenceClass: 'type', model: 'model', reasoning: 'reasoningCondition', sourceHash: 'sourceCode', suiteHash: 'suiteCondition', selection: 'selectionCondition', fixture: 'fixtureCondition', grader: 'graderCondition', lockfile: 'lockfileCondition', environment: 'environmentCondition', budget:'budgetCondition', validity: 'validity', complete: 'complete' };
  const special = { incomplete:'comparisonIncomplete', validity_unconfirmed:'comparisonInvalid', missing_pairs:'comparisonMissingPairs', current_grading_protocol_review_blocks_historical_snapshot:'comparisonReviewBlocked' };
  if (special[reason]) return t(special[reason]);
  const key = reason.split(':')[0];
  return keys[key] ? t('comparisonMismatch', { condition: t(keys[key]) }) : reason;
}
function decisionIssue(reason) {
  const patterns = [
    [/Original Personal v6|assistant-text executor/, 'issueProtocol'],
    [/latency|acknowledgement|request-to-submit/i, 'issueLatency'],
    [/Initial cancellation|lost final usage/i, 'issueCanceledUsage'],
    [/protocol concern|protocol.*review/i, 'issueProtocol'],
    [/Source.*invalid|infrastructure|source drift|execution validity/i, 'issueSource'],
    [/quality assertions|candidate incomplete|baseline not fully/i, 'issueQuality'],
    [/identity|Physical requests.*reconcile/i, 'issueIdentity'],
    [/token|usage|tail.*reconciliation/i, 'issueUsage'],
  ];
  const matched = patterns.find(([pattern]) => pattern.test(reason));
  return matched ? t(matched[1]) : reason;
}
async function renderImprovements(id) {
  const items = await api('/api/improvements');
  if (!id) {
    const status = new URLSearchParams(location.search).get('status') ?? '';
    const filtered = items.filter(item => !status || item.promotion === status);
    return `${chips('improvements', [['', 'allChanges'], ['not_evaluated', 'pendingDecisions'], ['promoted', 'acceptedChanges'], ['rejected', 'rejectedChanges']], status)}<div class="change-list">${filtered.map(i => `<article class="card"><div class="row-between"><h2><a href="#improvements/${encodeURIComponent(i.id)}">${esc(i.problem)}</a></h2>${badge(i.promotion)}</div><p class="muted">${tx(i.promotion === 'promoted' ? 'changeAccepted' : i.promotion === 'rejected' ? 'changeRejected' : 'changePending')}</p><div class="card-actions">${action(`improvements/${i.id}`, 'seeDecision')}</div></article>`).join('') || empty(t(items.length ? 'noFilteredChanges' : 'noImprovements'))}</div>${status && !filtered.length ? action('improvements', 'allChanges') : ''}`;
  }
  const i = items.find(item => item.id === id);
  if (!i) throw Error(t('requestFailed'));
  const decision = i.decision, audit = i.supplements?.findLast(s => Array.isArray(s.data?.audit))?.data.audit ?? decision?.audit;
  const evidenceIds = [...new Set([...(decision?.evidenceIds ?? []), ...(i.supplements ?? []).flatMap(s => s.data?.evidenceIds ?? [])])];
  const explicit = await Promise.all(evidenceIds.map(id => api(`/api/evidence/${id}`)));
  const available = await api('/api/evidence?limit=100');
  const evidence = [...new Map([...explicit, ...available.items.filter(e => matchesImprovement(i, [e]))].map(e => [e.id, e])).values()];
  return `${backLink('improvements', 'backChanges')}<section class="card"><div class="row-between"><h2>${tx('changeConclusion')}</h2>${badge(i.promotion)}</div><h3 class="change-title">${esc(i.problem)}</h3><p>${tx(i.promotion === 'promoted' ? 'changeAccepted' : i.promotion === 'rejected' ? 'changeRejected' : 'changePending')}</p>${decision?.scope ? `<p class="scope-note">${icon('info')}<span>${tx('decisionScope')}: ${esc(decision.scope)}</span></p>` : ''}</section>${decision?.reasons?.length ? `<section class="card"><h2>${tx('followUp')}</h2><ul class="blocker-list">${decision.reasons.map(reason => `<li>${esc(decisionIssue(reason))}</li>`).join('')}</ul></section>` : ''}${acceptancePanel(decision?.personalAcceptance)}<div class="work-columns"><section class="card"><h2>${tx('changeHypothesis')}</h2><p>${esc(i.hypothesis)}</p></section><section class="card"><h2>${tx('acceptanceChecklist')}</h2>${decision?.reports ? table(['phase', 'passedPlanned'].map(k => t(k)), decision.reports.map(r => tr([esc(r.id), `${esc(r.passed)} / ${esc(r.expected)}`]))) : `<p class="muted">${tx('changePending')}</p>`}</section></div><h2>${tx('relatedEvidence')}</h2>${evidence.length ? resultRecords(evidence) : `<p class="muted">${tx('noLinkedEvidence')}</p>`}${i.supplements?.length ? disclosure('supplementsTitle', `<p>${tx('supplementsNote')}</p>${i.supplements.map(s => `<p class="muted small-copy">${esc(formatDate(s.createdAt))}</p>${pretty(s.data)}`).join('')}`) : ''}${disclosure('technicalDetails', `${audit ? `<h3>${tx('reconciliation')}</h3>${auditTable(audit)}` : ''}${pretty(i)}`)}`;
}
async function renderEvidenceLibrary() {
  const params = new URLSearchParams(location.search), q = params.get('q') ?? '', offset = Number(params.get('offset')) || 0;
  const data = await api(`/api/evidence?q=${encodeURIComponent(q)}&offset=${offset}`);
  return `${backLink('benchmarks', 'viewAllScenes')}<form id="search-form" class="filters"><label>${tx('searchLabel')}<input name="q" value="${esc(q)}"></label><button>${tx('filter')}</button></form><p class="muted">${tx('evidenceListCount', { count: data.total })}</p>${resultRecords(data.items)}<div class="filters"><button id="prev" ${offset ? '' : 'disabled'}>${tx('previous')}</button><button id="next" ${offset + 30 < data.total ? '' : 'disabled'}>${tx('next')}</button></div>`;
}

let connection = 'connecting';
let updatedAt;
let rendering = 0;
let renderedRoute;
let renderedHTML;
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
const navigation = document.querySelector('aside nav');
function syncNavigationIndicator() {
  const selected = navigation.querySelector('a[aria-current="page"]');
  if (!selected) return;
  let indicator = navigation.querySelector('.navigation-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'navigation-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    navigation.prepend(indicator);
  }
  indicator.style.width = `${selected.offsetWidth}px`;
  indicator.style.height = `${selected.offsetHeight}px`;
  indicator.style.transform = `translate3d(${selected.offsetLeft}px, ${selected.offsetTop}px, 0)`;
  navigation.dataset.slidingReady = 'true';
}
const navigationResize = new ResizeObserver(syncNavigationIndicator);
navigationResize.observe(navigation);
for (const link of navigation.querySelectorAll('a')) navigationResize.observe(link);
document.querySelector('aside').addEventListener('click', event => {
  const link = event.target.closest('a[href]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target === '_blank') return;
  const next = new URL(link.href);
  if (next.origin !== location.origin || next.pathname !== location.pathname || !/^#(?:overview|benchmarks|runs|improvements)$/.test(next.hash)) return;
  event.preventDefault();
  if (next.href === location.href) return;
  history.pushState(null, '', next);
  render();
});
// Keep filter controls mounted, matching Web UI's sliding-tab interaction.
function syncFilterSelection() {
  const track = view.querySelector('.filter-chips');
  if (!track) return;
  const status = new URLSearchParams(location.search).get('status') ?? '';
  for (const link of track.querySelectorAll('a')) {
    if ((new URL(link.href).searchParams.get('status') ?? '') === status) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  }
  const selected = track.querySelector('[aria-current="true"]');
  if (!selected) return;
  let indicator = track.querySelector('.filter-indicator');
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'filter-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    track.prepend(indicator);
  }
  indicator.style.width = `${selected.offsetWidth}px`;
  indicator.style.height = `${selected.offsetHeight}px`;
  indicator.style.transform = `translate3d(${selected.offsetLeft}px, ${selected.offsetTop}px, 0)`;
  track.dataset.slidingReady = 'true';
}
const filterResize = new ResizeObserver(syncFilterSelection);
function updateView(html) {
  const next = document.createElement('template');
  next.innerHTML = html;
  const currentResults = view.querySelector('.filter-results');
  const nextResults = next.content.querySelector('.filter-results');
  const currentSearch = view.querySelector('#scene-search');
  const nextSearch = next.content.querySelector('#scene-search');
  if (currentResults && nextResults && currentSearch?.outerHTML === nextSearch?.outerHTML) {
    currentResults.replaceChildren(...nextResults.childNodes);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      currentResults.getAnimations().forEach(animation => animation.cancel());
      currentResults.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
    }
  } else view.replaceChildren(next.content);
  filterResize.disconnect();
  const track = view.querySelector('.filter-chips');
  if (track) { syncFilterSelection(); filterResize.observe(track); }
}
view.addEventListener('click', event => {
  const link = event.target.closest('.filter-chips a');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const next = new URL(link.href);
  if (next.origin !== location.origin || next.pathname !== location.pathname || next.hash !== location.hash) return;
  event.preventDefault();
  if (next.href === location.href) return;
  history.pushState(null, '', next);
  syncFilterSelection();
  render();
});
async function render() {
  const version = ++rendering;
  error.hidden = true;
  const [route, id, trial] = location.hash.slice(1).split('/');
  const current = ['overview', 'benchmarks', 'runs', 'evidence', 'compare', 'improvements'].includes(route) ? route : 'overview';
  document.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current', a.hash === `#${['evidence', 'compare'].includes(current) ? 'benchmarks' : current}` ? 'page' : 'false'));
  syncNavigationIndicator();
  document.querySelector('#title').textContent = t(current);
  document.querySelector('#page-description').textContent = t(current + 'Description');
  document.title = `${t(current)} · xopc Evals`;
  updateChrome();
  const routeKey = `${current}/${id ?? ''}/${trial ?? ''}`;
  const routeChanged = renderedRoute !== routeKey;
  syncFilterSelection();
  view.setAttribute('aria-busy', 'true');
  try {
    let html;
    if (current === 'overview') html = await renderOverview();
    else if (current === 'benchmarks') html = await renderBenchmarks(id);
    else if (current === 'runs') html = await renderRuns(id);
    else if (current === 'evidence' && id) html = await renderResult(id, trial);
    else if (current === 'compare') html = await renderComparison();
    else if (current === 'improvements') html = await renderImprovements(id);
    else html = await renderEvidenceLibrary();
    if (version !== rendering) return;
    if (!routeChanged && html === renderedHTML) { updatedAt = new Date(); updateChrome(); return; }
    renderedHTML = html;
    renderedRoute = routeKey;
    updateView(html);
    if (routeChanged) {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      view.getAnimations().forEach(animation => animation.cancel());
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        view.animate([{ opacity: .65, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 200, easing: 'cubic-bezier(.25,.1,.25,1)' });
      }
    }
    updatedAt = new Date(); updateChrome();
    const navigate = (data, hash) => { history.pushState(null, '', `?${new URLSearchParams(data)}#${hash}`); return render(); };
    document.querySelector('#search-form')?.addEventListener('submit', e => { e.preventDefault(); navigate(new FormData(e.target), 'evidence'); });
    const sceneSearch = document.querySelector('#scene-search');
    if (sceneSearch) sceneSearch.onsubmit = event => { event.preventDefault(); const params = new URLSearchParams(new FormData(event.target)); const state = new URLSearchParams(location.search).get('status'); if (state) params.set('status', state); navigate(params, 'benchmarks'); };
    view.querySelectorAll('[data-pick-result]').forEach(input => input.addEventListener('change', async () => {
      const params = new URLSearchParams(location.search); params.set(input.dataset.pickResult, input.value); await navigate(params, 'compare');
      if (params.get('left') && params.get('right')) document.querySelector('#comparison-result')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
    view.querySelector('a[href="#evaluation-method"]')?.addEventListener('click', event => { event.preventDefault(); document.querySelector('#evaluation-method')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'}); });
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
