"""Combine disjoint native grading cohorts; never replace grades or candidate answers."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    parser.add_argument('--native', nargs='+', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--require-complete', action='store_true')
    parser.add_argument('--diagnostic-summary')
    args = parser.parse_args()
    run, out = Path(args.run), Path(args.out)
    manifest = json.loads((run / 'manifest.json').read_text())
    targets = {c['id']: c for c in manifest['cases'] if c['suite'].startswith('longmemeval')}
    rows, protocols = {}, []
    for name in args.native:
        root = Path(name)
        meta = json.loads((root / 'manifest.json').read_text())
        if meta['capturedManifestHash'] != digest(run / 'manifest.json'):
            raise ValueError('Native grades belong to another capture')
        protocols.append({'directory': str(root.resolve()), 'manifestHash': digest(root / 'manifest.json'),
                          'model': meta['model'], 'officialEvaluator': meta['officialEvaluator']})
        for row in json.loads((root / 'summary.json').read_text())['results']:
            if row['id'] in rows or row['id'] not in targets:
                raise ValueError('Duplicate or unscheduled native grade')
            if row['category'] != targets[row['id']]['category']:
                raise ValueError('Native grade category differs from captured fixture')
            if row.get('captureHash'):
                capture = run / 'cases' / row['id'] / 'capture' / 'result.json'
                if row['captureHash'] != digest(capture):
                    raise ValueError('Captured answer artifact changed')
                answer = json.loads(capture.read_text())['answer']
                if row['answerHash'] != hashlib.sha256(answer.encode()).hexdigest():
                    raise ValueError('Candidate answer changed')
            rows[row['id']] = row
    missing = sorted(set(targets) - rows.keys())
    if args.require_complete and missing:
        raise ValueError(f'Missing {len(missing)} native judgments')
    types = {}
    for row in rows.values():
        category = types.setdefault(row['category'], {'total': 0, 'correct': 0, 'errors': 0})
        category['total'] += 1
        category['correct'] += bool(row.get('correct'))
        category['errors'] += bool(row.get('error'))
    diagnostic = {r['id']: r.get('judgment', {}).get('correct') for r in json.loads((Path(args.diagnostic_summary) if args.diagnostic_summary else run / 'summary.json').read_text())['results']}
    disagreements = [{'id': row['id'], 'nativeCorrect': row['correct'], 'diagnosticCorrect': diagnostic[row['id']]}
                     for row in rows.values() if not row.get('error') and diagnostic.get(row['id']) is not None
                     and row['correct'] != diagnostic[row['id']]]
    out.mkdir(parents=True, exist_ok=False)
    (out / 'summary.json').write_text(json.dumps({'scheduled': len(targets), 'completed': len(rows), 'missing': missing,
        'types': types, 'correct': sum(bool(r.get('correct')) for r in rows.values()),
        'errors': sum(bool(r.get('error')) for r in rows.values()), 'protocols': protocols,
        'disagreements': disagreements, 'results': list(rows.values())}, indent=2)+'\n')
    print(out / 'summary.json')


if __name__ == '__main__':
    main()
