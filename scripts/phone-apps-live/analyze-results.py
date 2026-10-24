#!/usr/bin/env python3
"""Offline, descriptive four-arm analysis. Reads evidence JSON only."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import statistics

ARMS = ('baseline', 'semantic', 'planning', 'combined')


def rate(successes, total):
    return round(100 * successes / total, 2) if total else None


def summarize(rows):
    attempted = [r for r in rows if not r.get('setupMismatch')]
    diagnostics = [r.get('diagnostics') or {} for r in attempted]
    duration = [r.get('durationMs', 0) for r in attempted]
    completed = sum(bool(r.get('independentlyCompleted')) for r in rows)
    return {
        'completed': completed, 'recordedTrials': len(rows), 'completionRatePercent': rate(completed, len(rows)),
        'runnableTrials': len(attempted), 'runnableCompletionRatePercent': rate(completed, len(attempted)),
        'actualModelRequests': sum(r.get('actualModelRequests', 0) for r in rows),
        'runtimeModelRequests': sum(r.get('modelRequests', 0) for r in rows),
        'actions': sum(r.get('actions', 0) for r in rows),
        'durationMsSum': sum(duration), 'durationMsMedian': statistics.median(duration) if duration else None,
        'durationMsMean': statistics.mean(duration) if duration else None,
        'semanticGroundedDispatches': sum(d.get('semanticActions', 0) for d in diagnostics),
        'trialsWithGroundedDispatch': sum(d.get('semanticActions', 0) > 0 for d in diagnostics),
        'semanticRejections': sum(d.get('semanticRejections', 0) for d in diagnostics),
        'hostPlanAssignedTrials': sum(d.get('plannedSubgoals', 0) > 0 for d in diagnostics),
        'hostPhasesAssigned': sum(d.get('plannedSubgoals', 0) for d in diagnostics),
        'hostPhasesNativeVerified': sum(d.get('completedSubgoals', 0) for d in diagnostics),
        'runtimeVerified': sum(bool(r.get('runtimeVerified')) for r in rows),
        'falseVerified': sum(bool(r.get('falseVerified')) for r in rows),
        'scopeViolations': sum(bool(r.get('scopeViolation')) for r in rows),
        'setupMismatches': sum(bool(r.get('setupMismatch')) for r in rows),
        'settingsChanged': sum(r.get('settingsUnchanged') is False for r in rows),
        'filesChanged': sum(r.get('filesUnchanged') is False for r in rows),
        'errors': dict(sorted(Counter(r['errorCode'] for r in rows if r.get('errorCode')).items())),
        'stopReasons': dict(sorted(Counter(r['stopReason'] for r in rows if r.get('stopReason')).items())),
    }


def grouping(rows):
    groups = defaultdict(list)
    for row in rows:
        groups[(row['_split'], row['task'], row['repeat'])].append(row)
    return groups


def common_four(rows):
    matched, exclusions = [], []
    for key, group in grouping(rows).items():
        arm_counts = Counter(r['arm'] for r in group)
        reason = None
        if arm_counts != Counter(ARMS):
            reason = 'missing_or_duplicate_arm'
        elif any(r.get('setupMismatch') for r in group):
            reason = 'setup_mismatch'
        elif len({r.get('initialFingerprint') for r in group}) != 1 or not group[0].get('initialFingerprint'):
            reason = 'different_or_missing_native_fingerprint'
        if reason:
            exclusions.append({'split': key[0], 'task': key[1], 'repeat': key[2], 'reason': reason, 'arms': dict(arm_counts)})
        else:
            matched.extend(group)
    return matched, exclusions


def comparisons(rows):
    result = []
    groups = grouping(rows)
    for arm in ARMS[1:]:
        pairs = []
        for key, group in groups.items():
            before = [r for r in group if r['arm'] == 'baseline' and not r.get('setupMismatch')]
            after = [r for r in group if r['arm'] == arm and not r.get('setupMismatch')]
            if len(before) == len(after) == 1 and before[0].get('initialFingerprint') and before[0]['initialFingerprint'] == after[0].get('initialFingerprint'):
                pairs.append((key, before[0], after[0]))
        before_n = sum(bool(b.get('independentlyCompleted')) for _, b, _ in pairs)
        after_n = sum(bool(a.get('independentlyCompleted')) for _, _, a in pairs)
        discordant = [{'split': k[0], 'task': k[1], 'repeat': k[2], 'baselineCompleted': bool(b.get('independentlyCompleted')),
                       'candidateCompleted': bool(a.get('independentlyCompleted'))} for k, b, a in pairs
                      if bool(b.get('independentlyCompleted')) != bool(a.get('independentlyCompleted'))]
        result.append({'arm': arm, 'matchedPairs': len(pairs), 'baselineCompleted': before_n, 'candidateCompleted': after_n,
                       'baselineRatePercent': rate(before_n, len(pairs)), 'candidateRatePercent': rate(after_n, len(pairs)),
                       'deltaPercentagePoints': round(100 * (after_n - before_n) / len(pairs), 2) if pairs else None,
                       'improvedPairs': sum(not b.get('independentlyCompleted') and bool(a.get('independentlyCompleted')) for _, b, a in pairs),
                       'regressedPairs': sum(bool(b.get('independentlyCompleted')) and not a.get('independentlyCompleted') for _, b, a in pairs),
                       'discordantPairs': discordant})
    return result


def arm_table(rows):
    return {arm: summarize([r for r in rows if r['arm'] == arm]) for arm in ARMS}


def panel(rows):
    matched, exclusions = common_four(rows)
    return {'raw': arm_table(rows), 'commonFourMatched': arm_table(matched), 'excludedQuartets': exclusions,
            'pairwiseMatchedComparisons': comparisons(rows), 'commonFourComparisons': comparisons(matched),
            'tasks': {task: {'raw': arm_table([r for r in rows if r['task'] == task]),
                             'commonFourMatched': arm_table([r for r in matched if r['task'] == task])}
                      for task in sorted({r['task'] for r in rows})}}


def analyze(paths):
    sources, rows, loaded = [], [], []
    for requested_split, path in paths:
        blob = Path(path).read_bytes()
        data = json.loads(blob)
        assert not data.get('setupOnly'), 'Oracle calibration cannot be analyzed as model trials'
        tasks = {t['id']: t.get('split', requested_split) for t in data['selectedTasks']}
        assert all(r['arm'] in ARMS for r in data['results']), 'Only final four-arm result files are supported'
        annotated = [dict(r, _split=tasks[r['task']]) for r in data['results']]
        assert all(r['_split'] == requested_split for r in annotated), 'Use separate development and heldout result files'
        rows.extend(annotated)
        loaded.append(data)
        sources.append({'split': requested_split, 'path': str(Path(path).resolve()), 'sha256': hashlib.sha256(blob).hexdigest(),
                        'plannedTrials': data.get('plannedTrials'), 'finishedTrials': data.get('finishedTrials'),
                        'suiteError': data.get('suiteError'), 'stoppedByRequest': data.get('stoppedByRequest'),
                        'actualModelRequests': data['actualModelRequests'], 'sumTrialActualModelRequests': sum(r.get('actualModelRequests', 0) for r in data['results']),
                        'allPlannedTrialsRecorded': data.get('plannedTrials') == len(data['results']),
                        'modelRequestAccountingMatches': data['actualModelRequests'] == sum(r.get('actualModelRequests', 0) for r in data['results']),
                        'candidateSourceSha256': data['optimized']['sourceSha256'], 'baselineSourceSha256': data['baseline']['sourceSha256'],
                        'harnessSourceSha256': data['harnessSourceSha256'], 'budget': data['budget'], 'model': data['model']})
    same = lambda getter: all(getter(d) == getter(loaded[0]) for d in loaded)
    shared_packages = set.intersection(*(set(d['packageVersions']) for d in loaded))
    integrity = {'sameCandidateSources': same(lambda d: d['optimized']['sourceSha256']),
                 'sameBaselineSources': same(lambda d: d['baseline']['sourceSha256']),
                 'sameHarnessSources': same(lambda d: d['harnessSourceSha256']),
                 'sameModel': same(lambda d: d['model']),
                 'sameSharedPackageVersions': all(same(lambda d: d['packageVersions'][package]) for package in shared_packages),
                 'samePerTrialBudget': same(lambda d: {k: d['budget'][k] for k in ['actionsPerTrial', 'requestsPerTrial', 'trialMs']}),
                 'sameFeatureFlags': same(lambda d: d['featureFlags'])}
    return {'analysis': 'descriptive-four-arm-native-ui-completion', 'sources': sources, 'crossSplitIntegrity': integrity,
            'packageVersionsBySplit': {split: data['packageVersions'] for (split, _), data in zip(paths, loaded)},
            'poolingCompatible': all(integrity.values()),
            'splits': {split: panel([r for r in rows if r['_split'] == split]) for split in sorted({r['_split'] for r in rows})},
            'overallDescriptive': panel(rows),
            'interpretation': [
                'Percentages are descriptive. Repeats on one task are clustered observations; no significance, confidence interval or generalization claim is computed.',
                'Raw recorded denominators include setup mismatches; runnable denominators exclude them. Common-four matched denominators require all four arms and identical initial native fingerprints.',
                'Pairwise denominators may exceed common-four denominators; do not mix them.',
                'semanticGroundedDispatches uses successful runtime semanticActions, including host grounding of standard Tap; enabled flags alone do not prove use.',
                'hostPlanAssignedTrials counts completion-derived host plans, not model-generated planning adoption; native-verified phases do not replace final completion verification.',
                'Durations include runtime open/shutdown, independent final observations and invariant checks; setup before timing is excluded.',
                'Overall values pool development and heldout only descriptively; if poolingCompatible is false, inspect source/budget differences before using overall numbers.',
                'Only supplied final-candidate result files are included. Exploratory V1/V2 results must remain separate.',
            ]}


def fraction(value):
    percent = value['completionRatePercent']
    return f"{value['completed']}/{value['recordedTrials']} ({percent:.1f}%)" if percent is not None else '0/0 (N/A)'


def markdown(data):
    lines = ['# Four-arm phone use descriptive analysis', '', f"Cross-split pooling compatible: {data['poolingCompatible']}", '']
    for split, result in list(data['splits'].items()) + [('overall descriptive', data['overallDescriptive'])]:
        lines += [f'## {split}', '', '| Set | Baseline | Semantic | Planning | Combined |', '|---|---:|---:|---:|---:|']
        for label, field in [('Raw recorded', 'raw'), ('Common-four matched', 'commonFourMatched')]:
            lines.append('| ' + label + ' | ' + ' | '.join(fraction(result[field][arm]) for arm in ARMS) + ' |')
        lines += ['', '| Task (common-four matched) | Baseline | Semantic | Planning | Combined |', '|---|---:|---:|---:|---:|']
        for task, table in result['tasks'].items():
            lines.append('| ' + task + ' | ' + ' | '.join(fraction(table['commonFourMatched'][arm]) for arm in ARMS) + ' |')
        lines += ['', '| Pairwise candidate | Pairs | Baseline | Candidate | Delta pp | Improved | Regressed |', '|---|---:|---:|---:|---:|---:|---:|']
        for c in result['pairwiseMatchedComparisons']:
            lines.append(f"| {c['arm']} | {c['matchedPairs']} | {c['baselineCompleted']} | {c['candidateCompleted']} | {c['deltaPercentagePoints']} | {c['improvedPairs']} | {c['regressedPairs']} |")
        lines += ['', '| Arm (common-four matched) | API calls | Duration seconds | Grounded taps | Host phases verified / assigned | False verified | Scope violations |', '|---|---:|---:|---:|---:|---:|---:|']
        for arm in ARMS:
            s = result['commonFourMatched'][arm]
            lines.append(f"| {arm} | {s['actualModelRequests']} | {s['durationMsSum'] / 1000:.3f} | {s['semanticGroundedDispatches']} | {s['hostPhasesNativeVerified']}/{s['hostPhasesAssigned']} | {s['falseVerified']} | {s['scopeViolations']} |")
        lines += ['', f"Excluded quartets: {len(result['excludedQuartets'])}", '']
    lines += ['## Interpretation', ''] + ['- ' + caveat for caveat in data['interpretation']]
    return '\n'.join(lines) + '\n'


def self_test():
    rows = [dict(_split='development', task='x', repeat=1, arm=arm, initialFingerprint='same', independentlyCompleted=arm == 'semantic',
                 setupMismatch=False, actualModelRequests=2, modelRequests=2, durationMs=10, diagnostics={'semanticActions': int(arm == 'semantic')}) for arm in ARMS]
    assert len(common_four(rows)[0]) == 4
    assert panel(rows)['pairwiseMatchedComparisons'][0]['improvedPairs'] == 1
    assert panel(rows)['commonFourMatched']['semantic']['semanticGroundedDispatches'] == 1
    rows[-1]['setupMismatch'] = True
    assert len(common_four(rows)[0]) == 0
    assert panel(rows)['pairwiseMatchedComparisons'][0]['matchedPairs'] == 1
    assert summarize(rows)['setupMismatches'] == 1
    print('Offline analysis self-test passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--development')
    parser.add_argument('--heldout')
    parser.add_argument('--output', help='Write analysis JSON; stdout otherwise')
    parser.add_argument('--markdown', help='Write readable Markdown tables')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        parser.error('--development and --heldout are required') if not (args.development and args.heldout) else None
        result = analyze([('development', args.development), ('heldout', args.heldout)])
        serialized = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
        if args.output:
            Path(args.output).write_text(serialized)
        else:
            print(serialized, end='')
        if args.markdown:
            Path(args.markdown).write_text(markdown(result))
