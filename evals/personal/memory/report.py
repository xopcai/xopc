"""Produce a baseline report without changing grades or replacing failed cases."""
import argparse
import json
from collections import Counter
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('run'); parser.add_argument('--output'); parser.add_argument('--summary')
    args = parser.parse_args(); root = Path(args.run)
    summary = json.loads((Path(args.summary) if args.summary else root/'summary.json').read_text()); manifest = json.loads((root/'manifest.json').read_text())
    completion = json.loads((root/'completion.json').read_text()) if (root/'completion.json').exists() else {}
    pool = [json.loads(line) for line in (root/'pools/events.jsonl').read_text().splitlines()]
    peaks = {kind: max([e.get('active', 0) for e in pool if e.get('pool') == kind] or [0]) for kind in ['generation', 'judge']}
    lines = ['# Current XOPC memory baseline', '', f'Source: `{manifest["commit"]}`',
             f'Candidate/extractor: `{manifest["models"]["candidate"]}`; judge: `{manifest["models"]["judge"]}`.',
             f'Scheduled: {summary["scheduled"]}; completed: {summary["completed"]}; source changed: {summary.get("sourceChanged", summary.get("captureSourceChanged"))}.',
             f'Observed request peaks: generation={peaks["generation"]}, judge={peaks["judge"]}.', '',
             'Diagnostic subset; historical timestamps explicitly supplied; future source sessions filtered. Not an official leaderboard score.', '',
             '| Suite/category | Correct / scheduled completed | Errors | Accuracy including errors |', '| --- | --- | --- | --- |']
    for key, row in sorted(summary['categories'].items()):
        lines.append(f'| {key} | {row["correct"]}/{row["total"]} | {row["errors"]} | {row["correct"]/row["total"]:.1%} |')
    lines += ['', '## Failure attribution', '', '| Stage | Cases |', '| --- | --- |']
    for key, n in sorted(summary['stages'].items()): lines.append(f'| {key} | {n} |')
    lines += ['', 'Attribution combines quote-validated model diagnosis with stored state and host audit. Retrieval, budget, policy and tool-selection misses remain grouped unless receipts distinguish them.', '', '## Representative failures', '']
    counts = Counter()
    for row in summary['results']:
        judgment = row.get('judgment', {})
        if judgment.get('correct'): continue
        key = row.get('category', 'error')
        if counts[key] >= 2: continue
        counts[key] += 1
        capture = root/'cases'/row['id']/'capture/result.json'
        data = json.loads(capture.read_text()) if capture.exists() else {}
        lines += [f'### {row["id"]}', '', 'Question: '+data.get('query', '(capture unavailable)'), '',
                  'Answer: '+data.get('answer', '(none)'), '',
                  'Diagnosis: '+str(row.get('error') or judgment.get('reason')), '',
                  'Stage: '+str(judgment.get('attribution', 'infrastructure_or_protocol_error')), '']
    lines += ['## Limits and next actions', '',
              '- No no-memory or oracle run yet: correctness cannot establish net benefit of memory.',
              '- Complete-state flush does not measure natural learning readiness latency.',
              '- Stored-support assessment can include stale/review records; it does not authorize selecting them.',
              '- Chinese development worlds only. Validation and final worlds remain unscheduled.',
              '- A single judge/one run is diagnostic. No result-based retry or substitution was performed.',
              '- Errors stay in denominators; source changes invalidate the cohort.',
              '- Inspect exact source/learning/selection/tool receipts before changing product logic.']
    target = Path(args.output) if args.output else root/'report.md'
    target.write_text('\n'.join(lines)+'\n', encoding='utf8')
    (root/'report-audit.json').write_text(json.dumps({'completion': completion, 'peaks': peaks}, indent=2)+'\n')
    print(target)


if __name__ == '__main__': main()
