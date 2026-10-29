#!/usr/bin/env python3
"""Read existing xopc traces, usage, input receipts and timing logs without writes.

Outputs diagnostic metadata only, never prompts, tool arguments or credentials.
Durations are clipped to each agent.run and partitioned rather than summed across
nested spans. No first-token latency is inferred from generation completion.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import sqlite3


def distribution(values):
    values = sorted(v for v in values if v is not None and math.isfinite(v) and v >= 0)
    def rank(p):
        return values[math.ceil(len(values) * p) - 1] if values else None
    return dict(count=len(values), p50Ms=rank(.5), p95Ms=rank(.95),
                maxMs=values[-1] if values else None, totalMs=sum(values))


def own_spans(root, spans):
    run_id = root['attributes'].get('xopc.runId')
    return [s for s in spans if s['spanId'] != root['spanId']
            and s['attributes'].get('xopc.runId') == run_id
            and s.get('endedAt') is not None]


def partition(root, spans):
    """Exclusive wall time; containing tools/compaction own nested generations."""
    start, end = root['startedAt'], root['endedAt']
    intervals = []
    for s in spans:
        category = ('compaction' if s['name'] in ('context.compaction', 'session.compact')
                    else 'tools' if s['type'] == 'tool'
                    else 'model' if s['type'] == 'generation' else None)
        if category:
            a, b = max(start, s['startedAt']), min(end, s['endedAt'])
            if b > a:
                intervals.append((a, b, category))
    points = sorted({start, end} | {t for a, b, _ in intervals for t in (a, b)})
    result = dict(model=0, tools=0, compaction=0, unattributed=0)
    for a, b in zip(points, points[1:]):
        active = {k for x, y, k in intervals if x < b and y > a}
        category = next((k for k in ('compaction', 'tools', 'model') if k in active), 'unattributed')
        result[category] += b - a
    return result


def read_db(path):
    db = sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    db.execute('BEGIN')
    return db


def analyze(state_dir, since=None):
    traces = read_db(state_dir / 'traces/traces.db')
    database = read_db(state_dir / 'xopc.db')
    try:
        roots_meta = {r['trace_id']: dict(r) for r in traces.execute(
            'SELECT trace_id,partial_reason FROM traces')}
        spans = [json.loads(r[0]) for r in traces.execute('SELECT data FROM spans')]
        inputs = {r['run_id']: dict(r) for r in database.execute(
            'SELECT run_id,created_at_ms,status,origin_json FROM session_inputs WHERE run_id IS NOT NULL')}
        task_runs = {r['run_id']: dict(r) for r in database.execute(
            'SELECT run_id,task_id,started_at,queued_at,completed_at,status FROM task_runs')}
        usage = {r['otel_span_id']: dict(r) for r in database.execute(
            'SELECT otel_span_id,status,input_tokens,cache_read_tokens,output_tokens,reasoning_tokens '
            'FROM ai_usage_events WHERE otel_span_id IS NOT NULL')}
    finally:
        traces.close()
        database.close()
    by_trace = defaultdict(list)
    for span in spans:
        by_trace[span['traceId']].append(span)
    roots = [s for s in spans if s['name'] == 'agent.run'
             and (since is None or s['startedAt'] >= since)]
    log_fields = ('preparationMs', 'modelFirstTextMs', 'firstRequestToTextMs',
                  'modelRequestNumber', 'inputToTextMs', 'queueMs')
    timing_logs = defaultdict(list)
    log_counts = Counter()
    for path in sorted((state_dir / 'logs').glob('app-*.log')):
        for line in path.open():
            try:
                row = json.loads(line)
            except (ValueError, TypeError):
                continue
            if row.get('phase') not in ('first_model_request', 'first_model_text', 'first_response_text'):
                continue
            log_counts[row['phase']] += 1
            if row.get('runId'):
                timing_logs[row['runId']].append({k: row[k] for k in ('phase',) + log_fields if k in row})
    runs = []
    for root in sorted(roots, key=lambda r: r['startedAt']):
        run_id = root['attributes'].get('xopc.runId')
        if not root.get('endedAt') or not run_id:
            continue
        own = own_spans(root, by_trace[root['traceId']])
        generations = [s for s in own if s['name'] in ('agent.answer', 'agent.continue_after_tool')]
        tools = [s for s in own if s['type'] == 'tool']
        receipt = inputs.get(run_id)
        task = task_runs.get(run_id)
        first = min((s['startedAt'] for s in generations), default=None)
        tokens = [usage[s['spanId']] for s in generations if s['spanId'] in usage]
        run = dict(runId=run_id, traceId=root['traceId'],
                   agentId=root['attributes'].get('xopc.agentId'),
                   startedAt=root['startedAt'], status=root['status'],
                   partialReason=roots_meta.get(root['traceId'], {}).get('partial_reason'),
                   source='task' if task and task['task_id'] else 'session_input' if receipt else 'unlinked',
                   totalMs=root['endedAt'] - root['startedAt'],
                   firstGenerationOffsetMs=first - root['startedAt'] if first is not None else None,
                   inputToEmbeddedStartMs=root['startedAt'] - receipt['created_at_ms'] if receipt else None,
                   inputToRunEndMs=root['endedAt'] - receipt['created_at_ms'] if receipt else None,
                   taskQueueMs=task['started_at'] - task['queued_at'] if task and task['started_at'] is not None else None,
                   modelCalls=len(generations), toolCalls=len(tools),
                   toolNames=dict(Counter(s['name'] for s in tools)),
                   models=dict(Counter(s['attributes'].get('gen_ai.system', '') + '/' +
                                       s['attributes'].get('gen_ai.request.model', '') for s in generations)),
                   partitionMs=partition(root, own),
                   timingLogs=timing_logs.get(run_id, []),
                   usageLinkedCalls=len(tokens),
                   inputTokens=sum(s['input_tokens'] or 0 for s in tokens),
                   cacheReadTokens=sum(s['cache_read_tokens'] or 0 for s in tokens),
                   outputTokens=sum(s['output_tokens'] or 0 for s in tokens),
                   reasoningTokens=sum(s['reasoning_tokens'] or 0 for s in tokens))
        run['traceLatency'] = {k.removeprefix('xopc.latency.'): v for k, v in root['attributes'].items()
                               if k.startswith('xopc.latency.') and isinstance(v, (int, float))}
        runs.append(run)
    def summary(rows):
        totals = {k: sum(r['partitionMs'][k] for r in rows) for k in ('model', 'tools', 'compaction', 'unattributed')}
        return dict(count=len(rows), status=dict(Counter(r['status'] for r in rows)),
                    total=distribution([r['totalMs'] for r in rows]), partitionMs=totals,
                    modelCalls={k.removesuffix('Ms'): v for k, v in distribution([r['modelCalls'] for r in rows]).items()},
                    firstGenerationOffset=distribution([r['firstGenerationOffsetMs'] for r in rows]),
                    inputToEmbeddedStart=distribution([r['inputToEmbeddedStartMs'] for r in rows]),
                    inputToRunEnd=distribution([r['inputToRunEndMs'] for r in rows]),
                    taskQueue=distribution([r['taskQueueMs'] for r in rows]))
    successful = [r for r in runs if r['status'] == 'success' and not r['partialReason']]
    # Only generations/tools belonging to an agent root's own run, within its window.
    linked_spans = {}
    for root in roots:
        if not root.get('endedAt'):
            continue
        for s in own_spans(root, by_trace[root['traceId']]):
            if s['startedAt'] >= root['startedAt'] and s['endedAt'] <= root['endedAt']:
                linked_spans[s['spanId']] = s
    operations = defaultdict(list)
    for s in linked_spans.values():
        if s['type'] in ('generation', 'tool') or s['name'] == 'context.compaction':
            operations[s['name']].append(s)
    operation_summary = {name: dict(distribution([s['endedAt'] - s['startedAt'] for s in rows]),
                                    status=dict(Counter(s['status'] for s in rows)))
                         for name, rows in sorted(operations.items())}
    agent_summary = {agent: summary([r for r in successful if r['agentId'] == agent])
                     for agent in sorted({r['agentId'] for r in successful}, key=str)}
    calls = [s for s in linked_spans.values() if s['name'] in ('agent.answer', 'agent.continue_after_tool')]
    models = {}
    for model in sorted({s['attributes'].get('gen_ai.system', '') + '/' + s['attributes'].get('gen_ai.request.model', '') for s in calls}):
        selected = [s for s in calls if s['attributes'].get('gen_ai.system', '') + '/' + s['attributes'].get('gen_ai.request.model', '') == model]
        ledger = [usage[s['spanId']] for s in selected if s['spanId'] in usage]
        models[model] = dict(distribution([s['endedAt'] - s['startedAt'] for s in selected]),
                            status=dict(Counter(s['status'] for s in selected)),
                            usageLinkedCalls=len(ledger),
                            inputTokens=sum(r['input_tokens'] or 0 for r in ledger),
                            cacheReadTokens=sum(r['cache_read_tokens'] or 0 for r in ledger),
                            outputTokens=sum(r['output_tokens'] or 0 for r in ledger),
                            reasoningTokens=sum(r['reasoning_tokens'] or 0 for r in ledger))
    return dict(generatedAt=datetime.now(timezone.utc).isoformat(),
                coverage=dict(traces=len(roots_meta), spans=len(spans), agentRuns=len(roots),
                              firstStartedAt=min((r['startedAt'] for r in runs), default=None),
                              lastStartedAt=max((r['startedAt'] for r in runs), default=None),
                              timingLogRecords=dict(log_counts), timingLinkedRuns=sum(bool(r['timingLogs']) for r in runs),
                              traceFirstTextRuns=sum('firstRequestToTextMs' in r['traceLatency'] for r in runs),
                              inputLinkedRuns=sum(r['inputToEmbeddedStartMs'] is not None for r in runs),
                              taskQueueLinkedRuns=sum(r['taskQueueMs'] is not None for r in runs),
                              partialRuns=sum(bool(r['partialReason']) for r in runs)),
                allRuns=summary(runs), successfulCompleteRuns=summary(successful),
                byAgent=agent_summary,
                byWorkload={name: summary([r for r in successful if predicate(r)]) for name, predicate in {
                    'one_model_no_tools': lambda r: r['modelCalls'] == 1 and r['toolCalls'] == 0,
                    'multiple_models_no_tools': lambda r: r['modelCalls'] > 1 and r['toolCalls'] == 0,
                    'tools_without_phone': lambda r: r['toolCalls'] > 0 and 'tool.phone_use' not in r['toolNames'],
                    'phone': lambda r: 'tool.phone_use' in r['toolNames'],
                }.items()},
                operations=operation_summary, models=models, runs=runs,
                limitations=[
                    'Historical mixed workload, not a controlled benchmark or causal comparison.',
                    'agent.run starts inside the embedded runner; pre-embedded service work is outside this span.',
                    'Input-to-embedded offset includes admission, queue, setup and possibly resume; it is not pure queue time.',
                    'Generation spans measure full provider calls, not time to first token or first visible answer.',
                    'No browser latency snapshots are persisted in these sources.',
                    'Nested tools/compaction own their generation time; model.attempt is a container, never additive.',
                    'Partial traces, cancelled, suspended and failed runs remain visible outside the successful-complete cohort.',
                    'Span success may miss structured tool errors returned as content; tokens may be unreported upstream.',
                ])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.xopc')
    parser.add_argument('--since', help='ISO-8601 timestamp, with timezone')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    since = None
    if args.since:
        timestamp = datetime.fromisoformat(args.since.replace('Z', '+00:00'))
        if timestamp.tzinfo is None:
            parser.error('--since must include a timezone')
        since = timestamp.timestamp() * 1000
    report = analyze(args.state_dir, since)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('coverage', 'successfulCompleteRuns', 'byWorkload')}, indent=2))


if __name__ == '__main__':
    main()
