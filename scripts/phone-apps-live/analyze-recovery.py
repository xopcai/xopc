#!/usr/bin/env python3
"""Offline descriptive analysis for the five-arm Phone Use recovery evaluation."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import statistics

ARMS = ('reference', 'before-planning', 'after-planning', 'before-combined', 'after-combined')
COMPARISONS = (('before-planning', 'after-planning'), ('before-combined', 'after-combined'),
               ('reference', 'after-planning'), ('reference', 'after-combined'))
FLAGS = {'reference': {'semanticControls': False, 'hierarchicalPlanning': False},
         'before-planning': {'semanticControls': False, 'hierarchicalPlanning': True},
         'after-planning': {'semanticControls': False, 'hierarchicalPlanning': True},
         'before-combined': {'semanticControls': True, 'hierarchicalPlanning': True},
         'after-combined': {'semanticControls': True, 'hierarchicalPlanning': True}}
ANIMATION_KEYS = {'window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'}


def percent(n, total):
    return round(n * 100 / total, 2) if total else None


def oracle_completed(row):
    readings = row.get('independentEvidence', [])
    return (not row.get('scopeViolation') and row.get('settingsUnchanged') is not False and row.get('filesUnchanged') is not False and len(readings) == 2
            and all(bool(reading) and all(value is True for value in reading.values()) for reading in readings))


def totals(rows):
    executed = [row for row in rows if not row.get('setupMismatch')]
    completed = sum(row.get('independentlyCompleted') is True for row in executed)
    diagnostics = Counter()
    for row in executed:
        for key, value in (row.get('diagnostics') or {}).items():
            if isinstance(value, (float, int)) and not isinstance(value, bool):
                diagnostics[key] += value
    durations = [row.get('durationMs', 0) for row in executed]
    return {'completed': completed, 'recordedTrials': len(rows), 'executedTrials': len(executed),
            'completionRatePercent': percent(completed, len(executed)),
            'recordedRateIncludingSetupMismatchPercent': percent(completed, len(rows)),
            'setupMismatches': len(rows) - len(executed),
            'actualModelRequests': sum(row.get('actualModelRequests', 0) for row in rows),
            'runtimeModelRequests': sum(row.get('modelRequests', 0) for row in rows),
            'actions': sum(row.get('actions', 0) for row in executed),
            'durationMsSum': sum(durations), 'durationMsMedian': statistics.median(durations) if durations else None,
            'durationMsMean': statistics.mean(durations) if durations else None,
            'diagnosticTotals': dict(sorted(diagnostics.items())),
            'trialsUsingNativeNumericEntry': sum((row.get('diagnostics') or {}).get('numericActions', 0) > 0 for row in executed),
            'trialsUsingFocusRecovery': sum((row.get('diagnostics') or {}).get('focusRecoveries', 0) > 0 for row in executed),
            'trialsUsingBackRecovery': sum((row.get('diagnostics') or {}).get('backReplans', 0) > 0 for row in executed),
            'runtimeVerified': sum(row.get('runtimeVerified') is True for row in executed),
            'falseVerified': sum(row.get('runtimeVerified') is True and not oracle_completed(row) for row in executed),
            'checkedScopeViolations': sum(row.get('scopeViolation') is True for row in executed),
            'sampledSettingsChanged': sum(row.get('settingsUnchanged') is False for row in executed),
            'sampledFilesChanged': sum(row.get('filesUnchanged') is False for row in executed),
            'errors': dict(sorted(Counter(row['errorCode'] for row in executed if row.get('errorCode')).items())),
            'stopReasons': dict(sorted(Counter(row['stopReason'] for row in executed if row.get('stopReason')).items()))}


def groups(rows):
    result = defaultdict(list)
    for row in rows:
        result[(row['task'], row['repeat'])].append(row)
    return result


def common_five(rows):
    matched, exclusions = [], []
    for (task, repeat), group in groups(rows).items():
        reason = None
        if Counter(row['arm'] for row in group) != Counter(ARMS):
            reason = 'missing_or_duplicate_arm'
        elif any(row.get('setupMismatch') for row in group):
            reason = 'setup_mismatch'
        elif len({row.get('initialFingerprint') for row in group}) != 1 or not group[0].get('initialFingerprint'):
            reason = 'different_or_missing_full_native_fingerprint'
        if reason:
            exclusions.append({'task': task, 'repeat': repeat, 'reason': reason})
        else:
            matched.extend(group)
    return matched, exclusions


def pairwise(rows):
    result = []
    grouped = groups(rows)
    for before_arm, after_arm in COMPARISONS:
        pairs = []
        for key, group in grouped.items():
            before = [row for row in group if row['arm'] == before_arm and not row.get('setupMismatch')]
            after = [row for row in group if row['arm'] == after_arm and not row.get('setupMismatch')]
            if len(before) == len(after) == 1 and before[0].get('initialFingerprint') and before[0]['initialFingerprint'] == after[0].get('initialFingerprint'):
                pairs.append((key, before[0], after[0]))
        before_count = sum(before.get('independentlyCompleted') is True for _, before, _ in pairs)
        after_count = sum(after.get('independentlyCompleted') is True for _, _, after in pairs)
        result.append({'beforeArm': before_arm, 'afterArm': after_arm, 'matchedPairs': len(pairs),
                       'beforeCompleted': before_count, 'afterCompleted': after_count,
                       'beforeRatePercent': percent(before_count, len(pairs)), 'afterRatePercent': percent(after_count, len(pairs)),
                       'deltaPercentagePoints': round((after_count - before_count) * 100 / len(pairs), 2) if pairs else None,
                       'improvedPairs': sum(not before.get('independentlyCompleted') and after.get('independentlyCompleted') is True for _, before, after in pairs),
                       'regressedPairs': sum(before.get('independentlyCompleted') is True and not after.get('independentlyCompleted') for _, before, after in pairs),
                       'discordantPairs': [{'task': key[0], 'repeat': key[1], 'beforeCompleted': bool(before.get('independentlyCompleted')),
                                            'afterCompleted': bool(after.get('independentlyCompleted'))}
                                           for key, before, after in pairs if bool(before.get('independentlyCompleted')) != bool(after.get('independentlyCompleted'))]})
    return result


def arm_table(rows):
    return {arm: totals([row for row in rows if row['arm'] == arm]) for arm in ARMS}


def source_directory_check(directory, declared):
    if not directory:
        return {'performed': False}
    directory = Path(directory)
    checks = {name: (directory / name).exists() and hashlib.sha256((directory / name).read_bytes()).hexdigest() == expected
              for name, expected in declared.items()}
    return {'performed': True, 'directory': str(directory.resolve()), 'allMatch': all(checks.values()), 'files': checks}


def validate_panel(data, label):
    rows = data['results']
    save_events = defaultdict(list)
    loads = Counter()
    for event in data.get('checkpointEvents', []):
        if event.get('operation') == 'save':
            save_events[event['key']].append(event)
        elif event.get('operation') == 'load':
            loads[event['key']] += 1
    checkpoint_groups, warm_groups = [], []
    for (task, repeat), group in groups(rows).items():
        key = f'{task}:{repeat}'
        executed = [row for row in group if not row.get('setupMismatch')]
        if data.get('checkpointInitial'):
            saved = save_events[key]
            expected = saved[0].get('fingerprint') if len(saved) == 1 else None
            attempts = sum(len(row.get('initialAttempts', [])) for row in group)
            checkpoint_groups.append({'task': task, 'repeat': repeat, 'saveEvents': len(saved), 'expectedFullNativeFingerprint': expected,
                                      'executedTrials': len(executed), 'fullNativeHashesMatchSavedCheckpoint': bool(expected) and all(row.get('initialFingerprint') == expected for row in executed),
                                      'loadEvents': loads[key], 'recordedInitialAttempts': attempts, 'loadAccountingMatches': loads[key] == attempts})
        if data.get('warmReset'):
            expected = group[0].get('initialFingerprint')
            recorded_pids = [row.get('initialProcessPid') for row in executed]
            warm_groups.append({'task': task, 'repeat': repeat, 'referenceArm': group[0]['arm'],
                                'referenceFullNativeFingerprint': expected, 'executedTrials': len(executed),
                                'fullNativeHashesMatchFirstArm': bool(expected) and all(row.get('initialFingerprint') == expected for row in executed),
                                'referenceArmHashAlsoMatchesReferenceArmLabel': all(row.get('initialFingerprint') == expected for row in executed if row['arm'] == 'reference'),
                                'perTrialPidsRecorded': bool(executed) and all(isinstance(value, str) and bool(value) for value in recorded_pids),
                                'recordedPids': recorded_pids,
                                'perTrialPidsEqualWithinGroup': bool(recorded_pids) and all(recorded_pids) and len(set(recorded_pids)) == 1})
    expected_groups = {(task['id'], repeat) for task in data['selectedTasks'] for repeat in range(1, data['budget']['repeats'] + 1)}
    missing_groups = sorted(expected_groups - set(groups(rows)))
    unexpected_groups = sorted(set(groups(rows)) - expected_groups)
    hashes = [*data['baseline']['sourceSha256'].values(), *data['optimized']['sourceSha256'].values(), *data['harnessSourceSha256'].values()]
    valid_sha = lambda value: isinstance(value, str) and len(value) == 64 and all(char in '0123456789abcdef' for char in value)
    executed = [row for row in rows if not row.get('setupMismatch')]
    checks = {
        'notSetupOrCalibrationRun': not data.get('setupOnly'),
        'allExpectedRecordsPresent': data.get('plannedTrials') == len(rows) == data.get('finishedTrials') and not missing_groups and not unexpected_groups,
        'noSuiteFailureOrRequestedStop': not data.get('suiteError') and not data.get('stoppedByRequest'),
        'allFiveArmsPresentExactlyOncePerGroup': all(Counter(row['arm'] for row in group) == Counter(ARMS) for group in groups(rows).values()),
        'featureFlagsMatchComparisonDesign': all(data.get('featureFlags', {}).get(arm) == flags for arm, flags in FLAGS.items()),
        'declaredSourceHashesWellFormed': bool(hashes) and all(valid_sha(value) for value in hashes),
        'candidateContainsRecoveryModules': {'recovery.ts', 'numeric-entry.ts'} <= set(data['optimized']['sourceSha256']),
        'realRequestAccountingMatchesRows': data.get('actualModelRequests') == sum(row.get('actualModelRequests', 0) for row in rows),
        'modelRequestBudgetRespected': all(row.get('actualModelRequests', 0) <= data['budget']['requestsPerTrial'] for row in rows),
        'actionBudgetRespected': all(row.get('actions', 0) <= data['budget']['actionsPerTrial'] for row in rows),
        'setupMismatchesConsumeNoActionsOrModelCalls': all(not row.get('setupMismatch') or (row.get('actualModelRequests') == 0 and row.get('actions') == 0 and not row.get('independentlyCompleted')) for row in rows),
        'independentTwoReadOracleAccountingMatches': all(bool(row.get('independentlyCompleted')) == oracle_completed(row) for row in executed),
        'sampledInvariantViolationsRecordedAsScopeViolations': all(not (row.get('settingsUnchanged') is False or row.get('filesUnchanged') is False) or row.get('scopeViolation') is True for row in executed),
        'runtimeFalseVerifiedAccountingMatches': all(bool(row.get('falseVerified')) == (row.get('runtimeVerified') is True and not oracle_completed(row)) for row in executed),
        'exactlyOneRecognizedInitializationMethodEnabled': bool(data.get('checkpointInitial')) != bool(data.get('warmReset')),
        'stableInitialModeEnabled': data.get('stableInitial') is True,
        'deterministicUiModeEnabled': data.get('deterministicUi') is True,
        'animationSettingsBeforeRecorded': set(data.get('animationSettingsBefore') or {}) == ANIMATION_KEYS,
        'animationRestorationReportedSuccessful': data.get('animationSettingsRestored') is True,
        'recordedAnimationPostRestoreReadbackMatchesBefore': data.get('animationSettingsAfter') == data.get('animationSettingsBefore'),
        'transferContainsOnlyTransferTasks': label != 'transfer' or all(task.get('split') == 'transfer' for task in data['selectedTasks']),
        'coreExcludesTransferTasks': label != 'core' or all(task.get('split') != 'transfer' for task in data['selectedTasks']),
    }
    lifecycle = [event for event in data.get('lifecycleEvents', []) if event.get('operation') == 'clear-activity-task']
    pid_retention = [event for event in lifecycle if event.get('beforePid')]
    lifecycle_evidence = {'clearActivityTaskEvents': len(lifecycle), 'eventsWithExistingPid': len(pid_retention),
                          'coldLaunchEvents': len(lifecycle) - len(pid_retention),
                          'resetRetainedExistingPid': bool(pid_retention) and all(event.get('beforePid') == event.get('afterPid') for event in pid_retention),
                          'everyRecordedLaunchHasPidAfter': bool(lifecycle) and all(bool(event.get('afterPid')) for event in lifecycle)}
    if data.get('checkpointInitial'):
        checks.update({
            'allExecutedInitialFullHashesMatchSavedCheckpoint': bool(checkpoint_groups) and all(group['saveEvents'] == 1 and group['fullNativeHashesMatchSavedCheckpoint'] for group in checkpoint_groups),
            'checkpointLoadAccountingMatchesAttempts': bool(checkpoint_groups) and all(group['loadAccountingMatches'] for group in checkpoint_groups),
            'checkpointCleanupReportedSuccessful': data.get('checkpointDeleted') is True,
        })
    if data.get('warmReset'):
        all_pids_recorded = bool(warm_groups) and all(group['perTrialPidsRecorded'] for group in warm_groups)
        checks.update({
            'warmModeHasNoVmCheckpointEvents': not data.get('checkpointInitial') and not data.get('checkpointEvents'),
            'allExecutedInitialFullHashesMatchFirstArm': bool(warm_groups) and all(group['fullNativeHashesMatchFirstArm'] for group in warm_groups),
            'allWarmTrialStableReadCountsRecorded': all(row.get('initialStabilityReads') and row['initialStabilityReads'][-1] >= 2 for row in executed),
            'recordedWarmTaskResetRetainedExistingPid': lifecycle_evidence['resetRetainedExistingPid'],
            'recordedWarmTaskLaunchesHavePidAfter': lifecycle_evidence['everyRecordedLaunchHasPidAfter'],
        })
        if all_pids_recorded:
            checks['recordedPerTrialPidsMatchWithinEachTaskRepeat'] = all(group['perTrialPidsEqualWithinGroup'] for group in warm_groups)
    return {'checks': checks, 'allChecksPass': all(checks.values()),
            'initializationMethod': 'warm-activity-reset' if data.get('warmReset') else 'vm-checkpoint' if data.get('checkpointInitial') else 'unrecognized',
            'checkpointGroups': checkpoint_groups, 'warmResetGroups': warm_groups,
            'warmLifecycleEvidence': lifecycle_evidence,
            'perTrialPidEvidenceCoverage': ('recorded_for_all_executed_trials' if warm_groups and all(group['perTrialPidsRecorded'] for group in warm_groups)
                                          else 'not_fully_recorded_no_per_trial_pid_claim'),
            'missingTaskRepeatGroups': missing_groups, 'unexpectedTaskRepeatGroups': unexpected_groups,
            'restorationEvidenceLevel': 'Recorded in-harness post-restore settings query compared with pre-values; independent external verification artifacts, if any, are separate.'}



def panel(data, label):
    rows = data['results']
    assert all(row['arm'] in ARMS for row in rows), 'Only the five recovery arms are supported'
    matched, exclusions = common_five(rows)
    return {'label': label, 'declaredSplit': data.get('split'), 'integrity': validate_panel(data, label),
            'rawRecorded': arm_table(rows), 'commonFiveMatched': arm_table(matched), 'excludedGroups': exclusions,
            'pairwiseMatchedComparisons': pairwise(rows), 'commonFiveMatchedComparisons': pairwise(matched),
            'tasks': {task['id']: {'rawRecorded': arm_table([row for row in rows if row['task'] == task['id']]),
                                  'commonFiveMatched': arm_table([row for row in matched if row['task'] == task['id']])}
                      for task in data['selectedTasks']}}


def analyze(paths, baseline_source=None, candidate_source=None):
    loaded, sources = [], []
    for label, path in paths:
        blob = Path(path).read_bytes()
        data = json.loads(blob)
        loaded.append((label, data))
        sources.append({'panel': label, 'path': str(Path(path).resolve()), 'sha256': hashlib.sha256(blob).hexdigest(),
                        'actualModelRequests': data['actualModelRequests'], 'plannedTrials': data['plannedTrials'], 'finishedTrials': data['finishedTrials'],
                        'baselineSourceSha256': data['baseline']['sourceSha256'], 'candidateSourceSha256': data['optimized']['sourceSha256'],
                        'harnessSourceSha256': data['harnessSourceSha256'], 'featureFlags': {arm: data['featureFlags'][arm] for arm in ARMS},
                        'budget': data['budget'], 'model': data['model'], 'packageVersions': data['packageVersions'],
                        'warmReset': data.get('warmReset'), 'checkpointInitial': data.get('checkpointInitial'), 'graphicsRenderer': data.get('graphicsRenderer')})
    first = loaded[0][1]
    same = lambda getter: all(getter(data) == getter(first) for _, data in loaded)
    common_packages = set.intersection(*(set(data['packageVersions']) for _, data in loaded))
    cross = {'sameBaselineSources': same(lambda data: data['baseline']['sourceSha256']),
             'sameCandidateSources': same(lambda data: data['optimized']['sourceSha256']),
             'sameHarnessSources': same(lambda data: data['harnessSourceSha256']), 'sameModel': same(lambda data: data['model']),
             'sameFlagsForAllFiveArms': same(lambda data: {arm: data['featureFlags'][arm] for arm in ARMS}),
             'samePerTrialBudgets': same(lambda data: {key: data['budget'][key] for key in ('requestsPerTrial', 'actionsPerTrial', 'trialMs')}),
             'sameDeviceIdentity': same(lambda data: (data['avd'], data['androidVersion'], data['localEmulator'])),
             'sameInitializationMethod': same(lambda data: (bool(data.get('warmReset')), bool(data.get('checkpointInitial')))),
             'sameRecordedGraphicsRenderer': same(lambda data: data.get('graphicsRenderer')),
             'sameSharedPackageVersions': all(same(lambda data: data['packageVersions'][package]) for package in common_packages),
             'coreAndTransferTasksDisjoint': not (set(task['id'] for task in loaded[0][1]['selectedTasks']) & set(task['id'] for task in loaded[1][1]['selectedTasks'])) if len(loaded) == 2 else None}
    directories = {'baseline': source_directory_check(baseline_source, first['baseline']['sourceSha256']),
                   'candidate': source_directory_check(candidate_source, first['optimized']['sourceSha256'])}
    panels = {label: panel(data, label) for label, data in loaded}
    all_declared = all(value is True for value in cross.values()) and all(item['integrity']['allChecksPass'] for item in panels.values())
    directories_match = all(not item['performed'] or item['allMatch'] for item in directories.values())
    return {'analysis': 'five-arm-native-recovery-descriptive-analysis', 'analyzerSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'sources': sources, 'crossPanelIntegrity': cross, 'sourceDirectoryVerification': directories,
            'allDeclaredIntegrityChecksPass': all_declared,
            'allIntegrityChecksPass': all_declared and directories_match,
            'providedSourceDirectoriesMatch': directories_match,
            'panels': panels, 'totalRealModelRequests': sum(data['actualModelRequests'] for _, data in loaded),
            'interpretation': [
                'Core and transfer are reported separately; no pooled headline rate is computed.',
                'Common-five matching requires every arm exactly once and identical full initial native hashes. Pairwise denominators may be larger.',
                'Raw recorded denominators include setup failures; executed denominators exclude them. Setup mismatches are not model failures.',
                'Completion comes from two independent native observations and sampled scope checks; a model finish or runtime status alone is insufficient.',
                'Native numeric actions may avoid model calls after model navigation; all actions still count toward the same action/time budgets.',
                'Recovery diagnostic totals prove mechanisms were invoked, not that an intercepted action would necessarily have failed.',
                'Durations include runtime open/shutdown, independent final observations and invariant checks; initial checkpoint restoration/setup is excluded.',
                'Repeated trials on the same task are clustered, transfer has very few samples, and order/provider variability remains; no significance or general success-rate claim is computed.',
                'Environment restoration checks compare recorded in-harness before/after setting queries and completion flags. Independent external device-after evidence, if collected, must be linked separately.',
                'Warm initialization validates exact first-arm native hashes, stable read counts and recorded lifecycle PID retention. Per-trial PID equality is claimed only when every executed row records initialProcessPid; otherwise the evidence gap is explicit.',
            ]}


def fraction(summary):
    n = summary['executedTrials']
    return f"{summary['completed']}/{n} ({summary['completionRatePercent']:.1f}%)" if n else 'N/A (0 executed)'


def markdown(result):
    lines = ['# Five-arm Phone Use recovery analysis', '', f"Declared integrity checks pass: {result['allDeclaredIntegrityChecksPass']}",
             f"Provided source directories match: {result['providedSourceDirectoriesMatch']}", '']
    for label, data in result['panels'].items():
        lines += [f'## {label}', '', '| Common five-arm matched | ' + ' | '.join(ARMS) + ' |', '|---|' + '---:|' * len(ARMS),
                  '| Completed | ' + ' | '.join(fraction(data['commonFiveMatched'][arm]) for arm in ARMS) + ' |', '',
                  '| Task (common-five) | ' + ' | '.join(ARMS) + ' |', '|---|' + '---:|' * len(ARMS)]
        for task, table in data['tasks'].items():
            lines.append('| ' + task + ' | ' + ' | '.join(fraction(table['commonFiveMatched'][arm]) for arm in ARMS) + ' |')
        lines += ['', '| Pairwise matched comparison | Pairs | Before | After | Delta pp | Improved | Regressed |', '|---|---:|---:|---:|---:|---:|---:|']
        for comparison in data['pairwiseMatchedComparisons']:
            lines.append(f"| {comparison['beforeArm']} → {comparison['afterArm']} | {comparison['matchedPairs']} | {comparison['beforeCompleted']} | {comparison['afterCompleted']} | {comparison['deltaPercentagePoints']} | {comparison['improvedPairs']} | {comparison['regressedPairs']} |")
        lines += ['', '| Common-five arm | API calls | Actions | Seconds | Numeric confirmed/actions | Focus recoveries | Back replans | False verified | Checked scope violations |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|']
        for arm in ARMS:
            summary = data['commonFiveMatched'][arm]; diagnostics = summary['diagnosticTotals']
            lines.append(f"| {arm} | {summary['actualModelRequests']} | {summary['actions']} | {summary['durationMsSum'] / 1000:.3f} | {diagnostics.get('numericConfirmedSteps', 0)}/{diagnostics.get('numericActions', 0)} | {diagnostics.get('focusRecoveries', 0)} | {diagnostics.get('backReplans', 0)} | {summary['falseVerified']} | {summary['checkedScopeViolations']} |")
        lines += ['', f"Excluded task/repeat groups: {len(data['excludedGroups'])}", f"Panel integrity checks pass: {data['integrity']['allChecksPass']}", '']
    lines += ['## Interpretation', ''] + ['- ' + item for item in result['interpretation']]
    return '\n'.join(lines) + '\n'


def self_test():
    rows = []
    for repeat in (1, 2):
        for arm in ARMS:
            mismatch = repeat == 2 and arm == 'after-combined'
            success = arm in ('reference', 'after-planning', 'before-combined') and not mismatch
            rows.append({'task': 'task', 'repeat': repeat, 'arm': arm, 'initialFingerprint': 'same' if not mismatch else 'different',
                         'setupMismatch': mismatch, 'independentlyCompleted': success, 'runtimeVerified': success,
                         'independentEvidence': [{'goal': success}, {'goal': success}] if not mismatch else [],
                         'scopeViolation': False, 'actualModelRequests': 0 if mismatch else 1, 'modelRequests': 0 if mismatch else 1,
                         'actions': 0 if mismatch else 1, 'durationMs': 0 if mismatch else 10,
                         'diagnostics': {'numericActions': int(arm == 'after-planning'), 'numericConfirmedSteps': int(arm == 'after-planning')}})
    common, excluded = common_five(rows)
    assert len(common) == 5 and len(excluded) == 1
    comparisons = pairwise(rows)
    assert comparisons[0]['matchedPairs'] == 2 and comparisons[0]['improvedPairs'] == 2
    assert comparisons[1]['matchedPairs'] == 1 and comparisons[1]['regressedPairs'] == 1
    assert totals(rows)['setupMismatches'] == 1
    assert totals(common)['falseVerified'] == 0
    assert arm_table(common)['after-planning']['diagnosticTotals']['numericConfirmedSteps'] == 1
    assert len(common_five(rows + [rows[0]])[0]) == 0
    warm_rows = [dict(row, initialFingerprint='a' * 64, initialProcessPid='42', initialStabilityReads=[2], initialAttempts=['a' * 64])
                 for row in rows[:5]]
    settings = {key: '1.0' for key in ANIMATION_KEYS}
    warm = {'results': warm_rows, 'selectedTasks': [{'id': 'task', 'split': 'development'}],
            'budget': {'repeats': 1, 'requestsPerTrial': 8, 'actionsPerTrial': 12}, 'plannedTrials': 5, 'finishedTrials': 5,
            'baseline': {'sourceSha256': {'runtime.ts': '1' * 64}},
            'optimized': {'sourceSha256': {'runtime.ts': '2' * 64, 'recovery.ts': '2' * 64, 'numeric-entry.ts': '2' * 64}},
            'harnessSourceSha256': {'harness.ts': '3' * 64}, 'featureFlags': FLAGS,
            'actualModelRequests': 5, 'warmReset': True, 'checkpointInitial': False, 'stableInitial': True, 'deterministicUi': True,
            'animationSettingsBefore': settings, 'animationSettingsAfter': dict(settings), 'animationSettingsRestored': True,
            'lifecycleEvents': [{'operation': 'clear-activity-task', 'beforePid': '42', 'afterPid': '42'}]}
    warm_check = validate_panel(warm, 'core')
    assert warm_check['allChecksPass'] and not warm_check['checkpointGroups']
    assert warm_check['perTrialPidEvidenceCoverage'] == 'recorded_for_all_executed_trials'
    warm_rows[0].pop('initialProcessPid')
    limited = validate_panel(warm, 'core')
    assert limited['perTrialPidEvidenceCoverage'] == 'not_fully_recorded_no_per_trial_pid_claim'
    assert 'recordedPerTrialPidsMatchWithinEachTaskRepeat' not in limited['checks']
    warm_rows[0]['initialProcessPid'] = '43'
    assert not validate_panel(warm, 'core')['allChecksPass']
    warm_rows[0]['initialProcessPid'] = '42'
    vm = dict(warm, warmReset=False, checkpointInitial=True, checkpointDeleted=True,
              checkpointEvents=[{'operation': 'save', 'key': 'task:1', 'fingerprint': 'a' * 64}]
              + [{'operation': 'load', 'key': 'task:1'} for _ in warm_rows])
    assert validate_panel(vm, 'core')['allChecksPass']
    vm['animationSettingsAfter'] = {**settings, 'window_animation_scale': '0'}
    assert not validate_panel(vm, 'core')['allChecksPass']
    print('Offline recovery analysis self-test passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--core')
    parser.add_argument('--transfer')
    parser.add_argument('--baseline-source')
    parser.add_argument('--candidate-source')
    parser.add_argument('--output')
    parser.add_argument('--markdown')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
    else:
        if not args.core or not args.transfer:
            parser.error('--core and --transfer are required')
        result = analyze([('core', args.core), ('transfer', args.transfer)], args.baseline_source, args.candidate_source)
        text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
        if args.output:
            Path(args.output).write_text(text)
        else:
            print(text, end='')
        if args.markdown:
            Path(args.markdown).write_text(markdown(result))
