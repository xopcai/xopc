"""Read-only evidence/usage aggregation for completed synthetic baseline captures."""
import argparse
import json
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--fixtures', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--native', nargs='*', default=[])
    parser.add_argument('--summary')
    parser.add_argument('--judge-retries')
    args = parser.parse_args()
    run = Path(args.run)
    summary = json.loads((Path(args.summary) if args.summary else run/'summary.json').read_text())
    records, totals, usage = [], Counter(), defaultdict(Counter)
    for result in summary['results']:
        case_id = result['id']
        case = run/'cases'/case_id
        capture = case/'capture'
        if not (capture/'result.json').exists():
            continue
        answer = json.loads((capture/'result.json').read_text())
        learn = json.loads((capture/'learning.json').read_text())
        fixture = json.loads((Path(args.fixtures)/(case_id+'.json')).read_text())
        reverse = {v: k for k,v in learn['entryRefs'].items()}
        db = sqlite3.connect((capture/'state.sqlite').resolve().as_uri()+'?mode=ro&immutable=1', uri=True)
        gold_rows = []
        for ref in fixture['gold']['evidenceRefs']:
            row = db.execute('SELECT transcript_id,seq FROM transcript_entries WHERE entry_id=?', (reverse[ref],)).fetchone()
            if row:
                gold_rows.append(row)
        jobs = {j['job_id']: j for j in learn['jobs']}
        failed_gold_batches = []
        for extraction in learn['extraction']:
            if extraction['status'] != 'failed':
                continue
            parts = extraction['source_ref'].split(':')
            if len(parts) != 5 or parts[0] != 'learning' or parts[1] not in jobs:
                continue
            job = jobs[parts[1]]
            if any(t == job['transcript_id'] and int(parts[2]) < seq <= int(parts[3]) for t,seq in gold_rows):
                failed_gold_batches.append({'jobId': job['job_id'], 'errorCode': extraction['error_code']})
        outputs = Counter(x['outcome'] for x in learn['outputs'])
        errors = answer.get('learningErrors', [])
        record = {'id':case_id,'category':result['category'],'learningJobs':len(learn['jobs']),
                  'learningErrors':len(errors),'learningErrorMessages':[e['error'] for e in errors],
                  'failedGoldBatches':failed_gold_batches,'outputs':dict(outputs),
                  'durationMs':answer['durationMs'],'historySessions':answer['historySessions'],
                  'correct':result.get('judgment',{}).get('correct'),'abstention':fixture['gold']['abstention'],
                  'unsupportedClaim':result.get('judgment',{}).get('unsupportedClaim')}
        if fixture['category'] == 'correction-forgetting' and len(fixture['sessions']) == 3:
            active_dates = []
            for item in [*learn['knowledge'], *learn['assertions']]:
                text = item.get('content', item.get('statement', ''))
                if item.get('status') == 'active' and re.search(r'10月(?:25|27)日|2026-10-(?:25|27)|(?:Oct(?:ober)?\.?)[ ,]+(?:25|27)|(?:25|27)[ ,]+(?:Oct(?:ober)?\.?)', text, re.I):
                    active_dates.append({'id': item.get('knowledge_id', item.get('assertion_id')), 'content': text, 'status': item['status']})
            record['forgetStateAudit'] = {'activeReleaseDateItems': active_dates, 'suppressionRows': db.execute('SELECT COUNT(*) FROM memory_suppressions').fetchone()[0],
                'note': 'Evaluation-only deterministic read of derived active date claims. QA correctness does not prove deletion; absence alone may also mean original write failed.'}
            totals['postForgetCasesAudited'] += 1
            totals['postForgetCasesWithActiveDateClaims'] += bool(active_dates)
        records.append(record)
        totals.update({'completedCaptures':1,'learningJobs':len(learn['jobs']),'learningErrors':len(errors),
                       'casesWithLearningErrors':bool(errors),'casesWithFailedGoldBatch':bool(failed_gold_batches)})
        for phase in ['capture','judge']:
            path = case/phase/'state.sqlite'
            if not path.exists():
                continue
            connection = db if phase == 'capture' else sqlite3.connect(path.resolve().as_uri()+'?mode=ro&immutable=1', uri=True)
            for row in connection.execute('SELECT provider,model,operation,status,input_tokens,output_tokens,total_tokens,estimated_cost_microusd,cost_source FROM ai_usage_events'):
                key = '/'.join([phase,*row[:4]])
                entry = usage[key]
                entry['calls'] += 1
                for index,name in [(4,'inputTokens'),(5,'outputTokens'),(6,'totalTokens')]:
                    if row[index] is None: entry[name+'Missing'] += 1
                    else: entry[name] += row[index]
                if row[7] is None or row[8] == 'unknown': entry['costUnknownCalls'] += 1
                else: entry['estimatedCostMicrousd'] += row[7]
            if connection != db:
                connection.close()
        db.close()
    extra_usage = [('native', Path(name)/'usage.sqlite') for name in args.native]
    if args.judge_retries:
        retry = json.loads((Path(args.judge_retries)/'summary.json').read_text())
        extra_usage += [('judge_retry', Path(attempt['folder'])/'state.sqlite')
                        for row in retry['results'] for attempt in row['attempts']]
    for phase, path in extra_usage:
        if not path.exists(): continue
        path = path.resolve()
        connection = sqlite3.connect(path.as_uri()+'?mode=ro&immutable=1', uri=True)
        for row in connection.execute('SELECT provider,model,operation,status,input_tokens,output_tokens,total_tokens,estimated_cost_microusd,cost_source FROM ai_usage_events'):
            key = '/'.join([phase,*row[:4]])
            entry = usage[key]
            entry['calls'] += 1
            for index,name in [(4,'inputTokens'),(5,'outputTokens'),(6,'totalTokens')]:
                if row[index] is None: entry[name+'Missing'] += 1
                else: entry[name] += row[index]
            if row[7] is None or row[8] == 'unknown': entry['costUnknownCalls'] += 1
            else: entry['estimatedCostMicrousd'] += row[7]
        connection.close()
    Path(args.output).write_text(json.dumps({'totals':dict(totals),'usage':{k:dict(v) for k,v in usage.items()},
        'cases':records,'limits':['Failed-gold-batch overlap establishes co-location, not counterfactual causality.',
        'Learning error counts include errors on irrelevant historical sessions.',
        'Cold replay per query is not amortized ingestion cost.']},ensure_ascii=False,indent=2)+'\n')
    print(args.output)


if __name__ == '__main__':
    main()
