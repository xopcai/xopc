"""Freeze one development choice; independent validation cannot replace it."""
import json
from style_analysis import LOCAL, aggregate_folder
from round5_gates import development_eligible, net, TARGETS

p = LOCAL / 'style-round5-comparison-v1'
assert not (p / 'selection.json').exists()
reg = json.loads((p / 'registration.json').read_text())
plan = json.loads((p / 'eq-style-round5-plan.json').read_text())
results = {}
for name in ['facts', 'closure', 'combined']:
    a = aggregate_folder(p / ('judgments-dev-' + name))
    assert a['registration']['runtimeContext'] and a['registration']['evidenceFocus']
    metrics = a['metrics']
    length = sum(len(plan['modules'][n]) for n in (['facts', 'closure'] if name == 'combined' else [name]))
    rank = [metrics['required_content_or_boundary']['patched']['majorEitherOrder']['replies'],
            sum(metrics[d]['patched']['bothOrders']['replies'] for d in TARGETS),
            metrics['overinterpretation']['patched']['bothOrders']['replies'], a['toneMeans']['coaching_register']['patched'],
            -net(a, 'naturalness'), -net(a, 'overall'), length, ['facts', 'closure', 'combined'].index(name)]
    results[name] = {'eligible': development_eligible(a), 'rank': rank, 'analysis': a}
eligible = [name for name, value in results.items() if value['eligible']]
selected = min(eligible or list(results), key=lambda name: results[name]['rank'])
selection = {'selected': selected, 'developmentEligible': bool(eligible), 'sourceCommit': reg['sourceCommits'][selected],
             'results': results, 'rule': plan['selection'], 'policy': 'Diagnostic validation still runs if none eligible, but full gate is false. No reselection, tuning or valid-score retries.'}
(p / 'selection.json').write_text(json.dumps(selection, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'selected': selected, 'eligible': bool(eligible), 'ranks': {k:v['rank'] for k,v in results.items()}}, ensure_ascii=False))
