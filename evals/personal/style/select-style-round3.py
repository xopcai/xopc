"""Select once from frozen development ablations; never use final validation scores."""
import json
from pathlib import Path
from style_analysis import aggregate_folder, LOCAL

comparison = LOCAL / 'style-round3-comparison-v1'
if (comparison / 'selection.json').exists():
    raise RuntimeError('Selection is immutable; refusing to overwrite')
results = {}
for name in ['facts', 'style', 'combined']:
    result = aggregate_folder(comparison / ('judgments-dev-' + name))
    def score(condition):
        m = result['metrics']
        return [m['required_content_or_boundary'][condition]['majorEitherOrder']['replies'],
                m['required_content_or_boundary'][condition]['bothOrders']['replies'],
                result['toneMeans']['coaching_register'][condition],
                m['repeated_closing'][condition]['bothOrders']['replies']]
    scores = score('patched')
    for dimension in ['naturalness', 'overall']:
        counts = result['outcomes'][dimension]
        scores.append(counts.get('control', 0) - counts.get('patched', 0))
    scores.append({'style': 0, 'facts': 1, 'combined': 2}[name])
    results[name] = {'rank': scores, 'control': score('control'), 'analysis': result}
eligible = [n for n, v in results.items() if v['rank'][0] <= v['control'][0]]
winner = min(eligible, key=lambda n: results[n]['rank']) if eligible else 'control'
registration = json.loads((comparison / 'registration.json').read_text())
selection = {'selected': winner, 'sourceCommit': registration['sourceCommits'].get(winner, '8a72fc7b5acfe8c2d59ef7d1638f3c9ce17fd5f4'),
             'rule': json.loads((comparison / 'eq-style-round3-variants.json').read_text())['selection'],
             'results': results, 'note': 'Development selection only; not proof of generalization. Validation cannot replace this choice.'}
(comparison / 'selection.json').write_text(json.dumps(selection, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'selected': winner, 'ranks': {n: v['rank'] for n, v in results.items()}}, ensure_ascii=False))
