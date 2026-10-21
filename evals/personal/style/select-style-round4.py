"""Choose once on development data, before independent validation or full regression."""
import json
from style_analysis import aggregate_folder, LOCAL

folder = LOCAL / 'style-round4-comparison-v2'
if (folder / 'selection.json').exists():
    raise RuntimeError('Refusing to overwrite the frozen selection')
results = {}
for name in ['facts', 'style', 'combined']:
    analysis = aggregate_folder(folder / ('judgments-dev-' + name))
    assert analysis['registration']['evidenceFocus']
    def score(condition):
        m = analysis['metrics']
        return [m['required_content_or_boundary'][condition]['majorEitherOrder']['replies'],
                m['required_content_or_boundary'][condition]['bothOrders']['replies'],
                m['overinterpretation'][condition]['bothOrders']['replies'],
                sum(analysis['toneMeans'][d][condition] for d in ['motive_menu','relationship_generalization']),
                analysis['toneMeans']['coaching_register'][condition],
                m['repeated_closing'][condition]['bothOrders']['replies'],
                m['unnecessary_question'][condition]['bothOrders']['replies']]
    rank = score('patched')
    for metric in ['naturalness', 'overall']:
        counts = analysis['outcomes'][metric]
        rank.append(counts.get('control',0)-counts.get('patched',0))
    rank.append({'facts':0,'style':1,'combined':2}[name])
    results[name] = {'rank':rank,'control':score('control'),'analysis':analysis}
eligible = [n for n,v in results.items() if v['rank'][0]<=v['control'][0] and v['rank'][2]<=v['control'][2]]
winner = min(eligible,key=lambda n:results[n]['rank']) if eligible else 'control'
registration = json.loads((folder/'registration.json').read_text())
selection = {'selected':winner,'sourceCommit':registration['sourceCommits'][winner],
             'results':results,'rule':json.loads((folder/'eq-style-round4-plan.json').read_text())['selection'],
             'note':'Development choice only. Independent validation and full regression cannot replace the selection.'}
(folder/'selection.json').write_text(json.dumps(selection,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'selected':winner,'ranks':{n:v['rank'] for n,v in results.items()}},ensure_ascii=False))
