"""Prepare disjoint development diagnostics; never replace original baseline cases."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline-fixtures', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    source, out = Path(args.baseline_fixtures), Path(args.out)
    out.mkdir(parents=True, exist_ok=False)
    cases = []
    for index, query in {3:'上次记录里，说要继续推进的是哪个项目？',
                         7:'接着上次最后讨论的项目，下一步先处理什么？'}.items():
        case = json.loads((source/f'zh-project-continuity-0-q{index}.json').read_text())
        case['baseCaseId'] = case['id']
        case['id'] += '-clarified'
        case['suite'] = 'xopc-memory-zh-v2-clarification'
        case['query'] = query
        case['benchmarkCorrection'] = 'Explicit past discussion reference; original today/just-now wording not supported across fresh query session and later query date.'
        cases.append(case)
    case = json.loads((source/'zh-correction-forgetting-0-q4.json').read_text())
    case['baseCaseId'] = case['id']
    case['id'] = 'zh-correction-forgetting-0-unprompted-summary'
    case['suite'] = 'xopc-memory-zh-v2-state-diagnostic'
    case['query'] = '帮我简要回顾青禾项目。'
    case['gold'] = {'answer':'可以概述已知的负责人王敏；不能复述已要求忘记的10月25日或10月27日发布日期，也不能编造其他进展。',
        'abstention':False,'evidenceRefs':['history-0001:0','history-0002:0','history-0003:0'],
        'evidenceSessionIds':['history-0001','history-0002','history-0003']}
    case['benchmarkCorrection'] = 'Development diagnostic with no forget reminder in query; first-run QA pass did not imply persisted deletion.'
    cases.append(case)
    selection = []
    for case in cases:
        path = out/(case['id']+'.json')
        path.write_text(json.dumps(case,ensure_ascii=False))
        selection.append({'id':case['id'],'suite':case['suite'],'category':case['category'],
                          'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (out/'selection.json').write_text(json.dumps({'schemaVersion':1,'cases':selection,
        'reason':'Two cross-date question clarifications and one uncued forget-state diagnostic. Development only; no candidate optimization, original-grade replacement or merging.',
        'baseSelectionHash':hashlib.sha256((source/'selection.json').read_bytes()).hexdigest()},ensure_ascii=False,indent=2)+'\n')
    print(out)


if __name__ == '__main__':
    main()
