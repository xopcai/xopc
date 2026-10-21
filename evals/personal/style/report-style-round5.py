"""Describe append-only candidates and honor the independent before-full gate."""
import collections
import copy
import datetime
import hashlib
import json
import math
import sqlite3
import statistics
from pathlib import Path

from style_analysis import ROOT, LOCAL, DIMS, TONES, aggregate_folder, follow_summary
from round5_gates import TARGETS, PROTECTED, net, new_majors, development_eligible

P=LOCAL/'style-round5-comparison-v1'
read=lambda p:json.loads(p.read_text())
reg=read(P/'registration.json');selection=read(P/'selection.json');validation=read(P/'validation-gate.json')
chosen=selection['selected'];state=read(P/'state.json');plan=reg['plan']
assert state['phase'] in ['complete-validation-failed-no-full','complete-full']
assert all(hashlib.sha256((ROOT/'evals/personal/style'/name).read_bytes()).hexdigest()==sha for name,sha in reg['frozenFiles'].items())
assert validation['selected']==chosen and validation['selectionCommit']==selection['sourceCommit']
assert read(Path(validation['validationRuns'][chosen])/'manifest.json')['commit']==selection['sourceCommit']
a=validation['analysis']


def without_disputed_guard(analysis):
    value=copy.deepcopy(analysis)
    value['pairs']=[pair for pair in value['pairs'] if pair['caseId']!='P0-R5-D-G4']
    for dim in DIMS:
        for condition in ['control','patched']:
            for rule in ['bothOrders','eitherOrder','majorBothOrders','majorEitherOrder']:
                pairs=[pair for pair in value['pairs'] if pair['conditions'][condition][dim][rule]]
                value['metrics'][dim][condition][rule]={'conversations':len(pairs),'replies':sum(len(pair['conditions'][condition][dim][rule]) for pair in pairs),'caseIds':[pair['caseId'] for pair in pairs]}
    value['outcomes']={dim:dict(collections.Counter(pair[dim] for pair in value['pairs'])) for dim in ['overall','naturalness']}
    for tone in TONES:
        for condition in ['control','patched']:
            value['toneMeans'][tone][condition]=sum(pair['tones'][condition][tone]['mean'] for pair in value['pairs'])/len(value['pairs'])
    return value


benchmark_audit={'caseId':'P0-R5-D-G4','issue':'Evaluator expectation prohibits escalation threats, but the user requested firm wording and did not state that prohibition. Conditional future HR escalation is not an invented past act or performed external action. The major label is disputed, not a demonstrated major product defect.','policy':'Post-hoc sensitivity only. Original fixtures, scores, gates, ranking and selected candidate unchanged. No judge rerun.', 'sensitivity':{}}
for name,item in selection['results'].items():
    subset=without_disputed_guard(item['analysis'])
    benchmark_audit['sensitivity'][name]={'eligible':development_eligible(subset),'overall':subset['outcomes']['overall'],'naturalness':subset['outcomes']['naturalness']}
assert not any(value['eligible'] for value in benchmark_audit['sensitivity'].values())


def audit_run(root):
    root=Path(root);m=read(root/'manifest.json');c=read(root/'completion.json')
    assert not c['sourceChanged'] and c['sourceHashEnd']==m['sourceHash'] and c['exitCode']==0
    assert m['model']==plan['models']['candidate'] and m['judge']==plan['models']['judge'] and m['persona']==plan['models']['persona']
    assert m['concurrency']==4 and m['requestPools']=={'generation':4,'judge':4,'scenes':3,'sharedAcrossProcesses':True,'adaptiveDownshift':True}
    recoveries=[]
    for file in (root/'cases').glob('*.json'):
        if file.name.endswith('.progress.json'):continue
        item=read(file)
        if item.get('transportRecovery'):
            recovery=item['transportRecovery'];original=Path(recovery['originalSource'])
            assert hashlib.sha256(original.read_bytes()).hexdigest()==recovery['originalSha256']
            assert read(original).get('error') and item.get('captureCaseId')
            recoveries.append({'caseId':item['caseId'],**recovery})
    db=sqlite3.connect(f'file:{root/"evals.db"}?mode=ro',uri=True);db.execute('PRAGMA busy_timeout=5000')
    identities=[json.loads(row[0]) for row in db.execute('SELECT DISTINCT runtime_identity_json FROM eval_runs WHERE runtime_identity_json IS NOT NULL')]
    db.close()
    return {'root':str(root),'manifest':m,'completion':c,'requestFailures':len(list((root/'request-failures').glob('*.json'))),'caseRestarts':recoveries,'runtimeIdentities':identities,'profile':read(root/'runtime.json')['profile']}

runs=[audit_run(LOCAL/f'style-round5-dev-{name}-v1') for name in ['control','facts','closure','combined']]
runs+=[audit_run(path) for path in validation['validationRuns'].values()]
profiles=[{k:v for k,v in run['profile'].items() if k!='instructions'} for run in runs]
assert all(profile==profiles[0] for profile in profiles)
identity_fields=lambda identity:{k:v for k,v in identity.items() if k not in ['configHash','agentId']}
identities=[identity_fields(identity) for run in runs for identity in run['runtimeIdentities']]
assert identities and all(v==identities[0] for v in identities)

rows=[json.loads(line) for line in (P/'pools/events.jsonl').read_text().splitlines()]
acquisitions={row['lease']:row for row in rows if row['event']=='acquired'}
performance={}
for pool in ['generation','judge','scene']:
    finished=[row for row in rows if row['event']=='released' and row['pool']==pool]
    durations=[row['durationSeconds'] for row in finished]
    performance[pool]={'initialLimit':{'generation':4,'judge':4,'scene':3}[pool],
                       'peakActive':max([r.get('active',0) for r in rows if r.get('pool')==pool]+[0]),
                       'completed':len(finished),'transportFailures':sum(bool(row.get('error')) for row in finished),
                       'p50Seconds':statistics.median(durations) if durations else None,
                       'p95Seconds':sorted(durations)[max(0,math.ceil(len(durations)*.95)-1)] if durations else None,
                       'minimumTarget':min([r.get('target',4) for r in rows if r.get('pool')==pool]+[{'scene':3}.get(pool,4)])}
assert not [row for row in rows if row['event']=='expired']
assert all(value['peakActive']<=value['initialLimit'] for value in performance.values())
full=None
if validation['gates']['passed']:
    assert state['phase']=='complete-full'
    full_eq=aggregate_folder(P/'judgments-eq')
    full_runs={name:audit_run(path) for name,path in state['fullRuns'].items()}
    follow={name:[read(path) for path in sorted((Path(run['root'])/'cases').glob('FB-*.json'))] for name,run in full_runs.items()}
    summaries={name:follow_summary(values,150) for name,values in follow.items()}
    assert all(v['complete'] for v in summaries.values()) and len(full_eq['pairs'])==12
    full_gates={'both150FollowAnd12EQValid':True,'followHSRNondecrease':summaries[chosen]['HSR']>=summaries['control']['HSR'],
                'noNewMajor':not new_majors(full_eq),'overallNetNonnegative':net(full_eq,'overall')>=0,'naturalnessNetNonnegative':net(full_eq,'naturalness')>=0}
    for dim in PROTECTED:
        for unit in ['conversations','replies']:
            full_gates[dim+unit+'Nonincrease']=full_eq['metrics'][dim]['patched']['bothOrders'][unit]<=full_eq['metrics'][dim]['control']['bothOrders'][unit]
    full_gates['passed']=all(full_gates.values())
    full={'eq':full_eq,'runs':full_runs,'follow':summaries,'gates':full_gates}
else:
    assert not any((LOCAL/f'style-round5-full-{name}-v1').exists() for name in ['control',chosen])

result={'schemaVersion':1,'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'registration':reg,'selection':selection,
        'validation':validation,'full':full,'benchmarkAudit':benchmark_audit,'runs':runs,'performanceIncludingPilotAndPreflight':performance,
        'pilot':read(P/'pilot-complete.json'),'finalPoolStatus':read(P/'pools/final-status.json'),
        'sharedDefault':'round3 restored; no failed experimental candidate activated','limits':'Residual-inspired scripts, single samples, same correlated judge model; no global optimum or population improvement claim.'}
out=ROOT/'docs/design/technical/personal-dialogue-style-round5-2026-10-21.json'
residual_analysis=(P/'residual-analysis.md').read_text()
result['residualAnalysis']=residual_analysis
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
passed=validation['gates']['passed']
lines=['# Personal AI 第五轮：保留具体保护条款的追加消融','',
       f"结论：独立验证{'通过，已进入完整回归' if passed else '未通过，按预设门槛停止，未启动完整回归和完整EQ盲评'}。选中`{chosen}`，开发集资格{selection['developmentEligible']}。共享工作区默认风格已恢复round3，未启用失败的round4实验规则。",'',
       '测试GPT-5.6 Sol；裁判及EQ模拟用户GPT-6.1 Sol。基线是round3最终组合源3ef12f67dc6b80f08bdd3fa3f89282b45b9d74f8，而非round4失败候选。历史113/150只作参考，不混入新调度下的对照。','',
       '## 变更与保护','',
       '事实组只追加来源追问／撤回无依据说法的规则；收口组只追加使用已确认决策、只答新问题的规则；组合组追加两者。原六条规则及完整示例逐字保留、顺序不变。明确保留“laughter does not prove feelings”、创作不得违背给定事实、未知动机不强加、纠正后放弃旧解读、请求的完整交付和必要风险说明。没有修改示例制造模块优势。','',
       '原20,000字符是编辑性测试预算，基线已接近该值。为保留具体条款，追加方案使用21,000字符检查，完整系统提示27,000字符预算保持不变；四组迁移、保护和预算测试各10项通过，类型检查通过。共享根目录恢复／迁移11项测试、调度及协议13项Python测试、评估器TypeScript检查通过。','',
       '12条开发、10条独立验证及门槛在任何模型请求前固定。验证仅用于通过或停止，不能改选候选；全部有效低分、展示顺序分歧均保留。','',
       '| 开发消融 | 有资格 | 整体（新/旧/平/分歧） | 自然度（新/旧/平/分歧） | 内容错误轮数旧→新 | 追问轮数旧→新 | 收尾轮数旧→新 |','|---|---|---|---|---:|---:|---:|']
def outcome(values):return '/'.join(str(values.get(k,0)) for k in ['patched','control','tie','discordant'])
def count(analysis,dim,c):return analysis['metrics'][dim][c]['bothOrders']['replies']
for name,value in selection['results'].items():
    d=value['analysis'];counts=[f"{count(d,dim,'control')}→{count(d,dim,'patched')}" for dim in TARGETS]
    lines.append(f"| {name} | {value['eligible']} | {outcome(d['outcomes']['overall'])} | {outcome(d['outcomes']['naturalness'])} | "+' | '.join(counts)+' |')
lines+=['','### 开发评估争议与敏感性检查','',
        'D-G4的用户只要求明确制止反复薪资泄露，裁判期望却额外禁止升级投诉措辞。组合组加入条件性公司反馈／追责，可能不够贴合口吻，但单凭未写在用户请求中的禁令不能确认为重大内容错误。这是本轮用例设计问题，原始重大／轻微分歧判断保留，并明确标争议。', '',
        f"事后仅排除该项的敏感性检查：{benchmark_audit['sensitivity']}。三组开发资格仍全部为false，事实组排名不受影响；没有据此改门槛、重选或重评。", '',
        '## 独立验证','',f"整体：{outcome(a['outcomes']['overall'])}；自然度：{outcome(a['outcomes']['naturalness'])}，顺序均为新胜/旧胜/平/分歧。",'',
        '| 双顺序同一助手轮交集 | 基线轮数 | 候选轮数 |','|---|---:|---:|']
for dim in PROTECTED:lines.append(f"| {dim} | {count(a,dim,'control')} | {count(a,dim,'patched')} |")
lines+=['',f"门槛：`{json.dumps(validation['gates'],ensure_ascii=False)}`",'',
        '| 用例 | 整体 | 自然度 |','|---|---|---|']
for pair in a['pairs']:lines.append(f"| {pair['caseId']} | {pair['overall']} | {pair['naturalness']} |")
lines+=['','### 逐例证据','']
for pair in a['pairs']:
    if pair['overall']=='tie' and pair['naturalness']=='tie' and not any(pair['conditions']['patched'][dim]['eitherOrder'] for dim in DIMS):continue
    lines.append(f"- {pair['caseId']}：{pair['reasons'][0]} 自然度：{pair['naturalnessReasons'][0]}")
    for dim in PROTECTED:
        evidence=pair['conditions']['patched'][dim]['evidenceByOrder']
        unique={v['quote']:v for order in evidence for v in order}
        for row in list(unique.values())[:2]:lines.append(f"  - {dim}，助手第{row['turn']}轮，{row['severity']}：{row['quote']} — {row['reason']}")
if full:
    lines+=['','## 通过验证后的完整回归','',f"同调度重新运行的150条Follow：{full['follow']}。12场EQ整体{full['eq']['outcomes']['overall']}，自然度{full['eq']['outcomes']['naturalness']}。",'',f"完整门槛：`{json.dumps(full['gates'],ensure_ascii=False)}`。"]
else:
    lines+=['','## 为什么停止','',
            '门槛没有通过，不能把开发集消融排名当成对Personal AI的稳定改善；没有据此替换默认风格。未运行本轮全量FollowBench、12场EQ及其完整盲评，所以不能声称EQ已改善或找到最优版本。所有独立验证结果只用于说明失败原因，没有用于挑选另一版本。']
lines+=['',*residual_analysis.splitlines(),'','## 独立请求池与耗时','',
        '所有条件共享生成4、裁判4、EQ场景3额度。Follow每条生成完成立即排队评分；Follow和不同EQ可同时执行，同段EQ按顺序。候选组捕获完成后即可与已完成对照送盲评，不等待其他候选全部完成。正反序独立裁判请求。固定6Follow+1EQ小批试验只用于调度，未混入质量指标。','',
        '| 池（含试验及预检） | 峰值 | 完成请求 | 原始失败 | P50秒 | P95秒 | 最低额度 |','|---|---:|---:|---:|---:|---:|---:|']
for pool,value in performance.items():
    lines.append(f"| {pool} | {value['peakActive']} | {value['completed']} | {value['transportFailures']} | {value['p50Seconds']:.2f} | {value['p95Seconds']:.2f} | {value['minimumTarget']} |")
lines+=['','遇到overload、限流或超时按池降低额度；只重试失败输入，保留原错误和输入。裁判协议失败保留原判断文件并最多同输入补调一次；候选传输失败在新会话完整重启该用例，保留首捕获，使用captureCaseId读取实际回执。这种重启有新轨迹，不冒充相同前缀续跑。正常低分不重跑。原始记录、每池延迟和实际额度都保留。','',
        '## 证据与限制','',
        f"冻结注册、选择、独立验证门槛及全部原文：`{P}`。同名JSON包含每序证据、并集／交集、源哈希、恢复记录和运行画像。全部捕获源哈希始末一致；模型、除instructions外的个人画像和运行身份字段一致（排除configHash与临时agentId）。",'',
        '本轮脚本来自已知残留机制，独立验证表示本轮未用于选型，不能视为真实用户总体样本。两序裁判来自同一模型且相关，单次样本不证明统计显著或全局最优；相同代码也有生成随机性。角色扮演任务的未知细节会制造补全压力，但不授权编造作为争议证据的历史。完整基准若未运行，不作外推。']
out.with_suffix('.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'selected':chosen,'validationGate':validation['gates'],'fullRan':bool(full),'validationOverall':a['outcomes']['overall'],'validationNaturalness':a['outcomes']['naturalness'],'performance':performance},ensure_ascii=False))
