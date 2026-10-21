"""Compare the complete frozen round against the previous final EQ candidate."""
import collections
import hashlib
import json
from pathlib import Path

from protocol import follow_summary

ROOT = Path(__file__).resolve().parents[3]
LOCAL = ROOT / '.xopc-evals/personal-style'
COMPARISON = LOCAL / 'eq-style-round2-comparison-v1'
CONTROL = LOCAL / 'eq-refinement-isolated-eq-v1'
PATCHED = LOCAL / 'eq-style-round2-full-v1'
HISTORICAL = LOCAL / 'p0-refined-gpt56-gpt61-2026-10-21-v1'
DIMS = ['overinterpretation', 'unnecessary_question', 'repeated_closing',
        'premature_resolution', 'required_content_or_boundary', 'didactic_expression']
TONES = ['motive_menu', 'relationship_generalization', 'coaching_register']
read = lambda path: json.loads(path.read_text())


def stable(first, second):
    a = {'left': 'control', 'right': 'patched', 'tie': 'tie'}[first]
    b = {'left': 'patched', 'right': 'control', 'tie': 'tie'}[second]
    return a if a == b else 'discordant'


def aggregate_folder(folder):
    folder = Path(folder)
    registration, completion = [read(folder / name) for name in ['registration.json', 'completion.json']]
    assert registration['toneScale'] and registration['styleFocus']
    assert completion['expected'] == completion['attempted']
    recoveries, pairs = [], []
    for item in registration['pairs']:
        calls = []
        for order in ['forward', 'reverse']:
            source = folder / f"{item['id']}.{order}.json"
            call = read(source)
            if call.get('error'):
                supplement = folder.with_name(folder.name + f".recovery-{item['id']}-{order}")
                reg = read(supplement / 'registration.json')
                assert read(supplement / 'completion.json')['complete']
                assert reg['recoveryOf'] == str(source)
                assert reg['originalSha256'] == hashlib.sha256(source.read_bytes()).hexdigest()
                replacement = read(supplement / source.name)
                assert replacement['input'] == call['input'] and not replacement.get('error')
                recoveries.append({'source': str(source), 'supplement': str(supplement / source.name), 'originalError': call['error']})
                call = replacement
            calls.append(call)
        a, b = [c['judgment'] for c in calls]
        row = {'caseId': item['id'], 'category': item['category'],
               'overall': stable(a['winner'], b['winner']),
               'naturalness': stable(a['naturalnessWinner'], b['naturalnessWinner']),
               'reasons': [a['reason'], b['reason']],
               'naturalnessReasons': [a['naturalnessReason'], b['naturalnessReason']],
               'conditions': {}, 'tones': {}}
        for condition, first, second in [('control', 'left', 'right'), ('patched', 'right', 'left')]:
            row['conditions'][condition] = {}
            row['tones'][condition] = {}
            for dim in DIMS:
                values = [a[first][dim], b[second][dim]]
                turns = [{v['turn'] for v in order} for order in values]
                majors = [{v['turn'] for v in order if v['severity'] == 'major'} for order in values]
                row['conditions'][condition][dim] = {
                    'bothOrders': sorted(turns[0] & turns[1]), 'eitherOrder': sorted(turns[0] | turns[1]),
                    'majorBothOrders': sorted(majors[0] & majors[1]), 'majorEitherOrder': sorted(majors[0] | majors[1]),
                    'evidenceByOrder': values}
            for tone in TONES:
                scores = [a['toneScores'][first][tone], b['toneScores'][second][tone]]
                row['tones'][condition][tone] = {'mean': sum(v['score'] for v in scores) / 2,
                                                 'orderScores': [v['score'] for v in scores], 'evidence': scores}
        pairs.append(row)
    assert completion['errors'] == len(recoveries)
    metrics = {}
    for dim in DIMS:
        metrics[dim] = {condition: {rule: {
            'conversations': sum(bool(p['conditions'][condition][dim][rule]) for p in pairs),
            'replies': sum(len(p['conditions'][condition][dim][rule]) for p in pairs),
            'caseIds': [p['caseId'] for p in pairs if p['conditions'][condition][dim][rule]]}
            for rule in ['bothOrders', 'eitherOrder', 'majorBothOrders', 'majorEitherOrder']}
            for condition in ['control', 'patched']}
    tone_means = {tone: {condition: sum(p['tones'][condition][tone]['mean'] for p in pairs) / len(pairs)
                         for condition in ['control', 'patched']} for tone in TONES}
    tone_gaps = {tone: {condition: sum(abs(p['tones'][condition][tone]['orderScores'][0] - p['tones'][condition][tone]['orderScores'][1])
                                      for p in pairs) / len(pairs) for condition in ['control', 'patched']} for tone in TONES}
    return {'pairs': pairs, 'metrics': metrics, 'toneMeans': tone_means, 'meanAbsoluteOrderGaps': tone_gaps,
            'outcomes': {key: dict(collections.Counter(p[key] for p in pairs)) for key in ['overall', 'naturalness']},
            'registration': registration, 'originalCompletion': completion, 'judgeRecoveries': recoveries}
