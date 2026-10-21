"""Build an evidence-linked comparison without rewriting any captured result."""
import argparse
import collections
import hashlib
import json
from pathlib import Path

from protocol import aggregate_p0_pair, follow_summary

parser = argparse.ArgumentParser()
parser.add_argument('--root', default=str(Path(__file__).resolve().parents[3]))
parser.add_argument('--comparison', required=True)
parser.add_argument('--baseline', required=True)
parser.add_argument('--patched', required=True)
parser.add_argument('--control-scripted', required=True)
parser.add_argument('--patched-scripted', required=True)
parser.add_argument('--recovery')
parser.add_argument('--eq-recovery')
parser.add_argument('--out', required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
read = lambda path: json.loads(Path(path).read_text())
comparison = Path(args.comparison).resolve()
baseline, patched = Path(args.baseline).resolve(), Path(args.patched).resolve()
fixtures = read(comparison / 'p0-dialogues.json')['cases']
dimensions = ['overinterpretation', 'unnecessary_question', 'repeated_closing', 'premature_resolution', 'required_content_or_boundary']


def require_capture(path):
    completion = read(path / 'completion.json')
    assert not completion['sourceChanged'], path
    return completion


def judged_pairs(kind, ids):
    folder = comparison / ('judgments-' + kind)
    completion = read(folder / 'completion.json')
    assert completion['complete'], (folder, completion)
    results = []
    for case_id, category in ids:
        forward = read(folder / (case_id + '.forward.json'))
        reverse = read(folder / (case_id + '.reverse.json'))
        item = {'caseId': case_id, 'category': category, **aggregate_p0_pair(forward, reverse),
                'judgmentSources': [str(folder / (case_id + '.' + order + '.json')) for order in ['forward', 'reverse']]}
        results.append(item)
    return results


def metrics(rows, dimension):
    result = {'conversations': len(rows), 'conditions': {}}
    for condition in ['control', 'patched']:
        stats = {}
        for key in ['bothOrders', 'eitherOrder', 'majorBothOrders', 'majorEitherOrder']:
            affected = [r['caseId'] for r in rows if r['conditions'][condition][dimension][key]]
            stats[key] = {'affectedConversations': len(affected), 'affectedReplyCount': sum(len(r['conditions'][condition][dimension][key]) for r in rows), 'caseIds': affected}
        result['conditions'][condition] = stats
    return result


baseline_completion = require_capture(baseline)
patched_completion = require_capture(patched)
for path in [Path(args.control_scripted).resolve(), Path(args.patched_scripted).resolve()]:
    assert require_capture(path)['exitCode'] == 0
    assert read(path / 'summary.json')['complete']
scripted = judged_pairs('scripted', [(r['id'], r['category']) for r in fixtures])
eq_ids = [(r['caseId'], r['relationship']) for r in read(baseline / 'selection.json')['eq']]
eq = judged_pairs('eq', eq_ids)
follow_pair = judged_pairs('follow', [('FB-ZH-S11-L5', 'unnecessary_question')])

focused = [r for r in scripted if r['category'] in dimensions[:3]]
outcomes = collections.Counter(r['outcome'] for r in focused)
weighted = (outcomes['patched'] + .5 * (outcomes['tie'] + outcomes['discordant'])) / len(focused)
focused_metrics = {d: metrics([r for r in scripted if r['category'] == d], d) for d in dimensions[:3]}
decreases = {d: m['conditions']['patched']['bothOrders']['affectedConversations'] < m['conditions']['control']['bothOrders']['affectedConversations'] for d, m in focused_metrics.items()}
nonincreases = {d: m['conditions']['patched']['bothOrders']['affectedConversations'] <= m['conditions']['control']['bothOrders']['affectedConversations'] for d, m in focused_metrics.items()}
plan = read(comparison / 'p0-comparison-plan.json')
refined = plan.get('version') == 'p0-refinement-v2'
behavior_targets = {d: decreases[d] if m['conditions']['control']['bothOrders']['affectedConversations'] else nonincreases[d] for d, m in focused_metrics.items()}
known_clarification_fixed = not follow_pair[0]['conditions']['patched']['unnecessary_question']['eitherOrder'] and not follow_pair[0]['conditions']['patched']['required_content_or_boundary']['majorEitherOrder']
controls = [r for r in scripted if r['category'].startswith('control_')]
new_major_controls = [r['caseId'] for r in controls if r['conditions']['patched']['required_content_or_boundary']['majorBothOrders'] and not r['conditions']['control']['required_content_or_boundary']['majorBothOrders']]
possible_new_major_controls = [r['caseId'] for r in controls if r['conditions']['patched']['required_content_or_boundary']['majorEitherOrder'] and not r['conditions']['control']['required_content_or_boundary']['majorEitherOrder']]

baseline_follow = [read(p) for p in sorted((baseline / 'cases').glob('FB-*.json'))]
patched_follow = [read(p) for p in sorted((patched / 'cases').glob('FB-*.json'))]
assert len(baseline_follow) == len(patched_follow) == 150
supplemented = [dict(r) for r in patched_follow]
recoveries = []
if args.recovery:
    recovery = Path(args.recovery).resolve()
    assert read(recovery / 'completion.json')['complete']
    for path in sorted(recovery.glob('FB-*.json')):
        grade = read(path)
        assert not grade.get('error') and grade['candidateRegenerated'] is False
        row = next(r for r in supplemented if r['caseId'] == grade['caseId'])
        assert row.get('error') and row['judgePrompt'] == grade['judgePrompt']
        row.pop('error')
        row.update({k: grade[k] for k in ['verdicts', 'hardSatisfied', 'softScore']})
        recoveries.append({'caseId': row['caseId'], 'source': str(path), 'originalError': grade['originalError']})
base_by_id = {r['caseId']: r for r in baseline_follow}
gains = [r['caseId'] for r in supplemented if not base_by_id[r['caseId']]['hardSatisfied'] and r['hardSatisfied']]
losses = [r['caseId'] for r in supplemented if base_by_id[r['caseId']]['hardSatisfied'] and not r['hardSatisfied'] and not r.get('error')]
audit = read(root / 'docs/design/technical/personal-dialogue-style-failure-audit-2026-10-21.json')
audit_categories = {r['caseId']: r['primaryCategory'] for r in audit['followCases']}
gain_categories = dict(collections.Counter(audit_categories[i] for i in gains))

eq_rows = []
eq_capture_recoveries = []
if args.eq_recovery:
    assert require_capture(Path(args.eq_recovery).resolve())['exitCode'] == 0
for case_id, relationship in eq_ids:
    a = read(baseline / 'cases' / (case_id + '.json'))
    b = read(patched / 'cases' / (case_id + '.json'))
    source = patched / 'cases' / (case_id + '.json')
    if b.get('error') and args.eq_recovery:
        source = Path(args.eq_recovery).resolve() / 'cases' / (case_id + '.json')
        eq_capture_recoveries.append({'caseId': case_id, 'originalError': b['error'], 'source': str(source), 'candidateRegeneratedFromFreshScene': True})
        b = read(source)
    assert not a.get('error') and not b.get('error')
    eq_rows.append({'caseId': case_id, 'relationship': relationship, 'controlTraits': a['traits'], 'patchedTraits': b['traits'],
                    'controlTurns': a['assistantTurns'], 'patchedTurns': b['assistantTurns'], 'patchedCaptureSource': str(source)})
profile_a = read(baseline / 'runtime.json')['profile']
profile_b = read(patched / 'runtime.json')['profile']
profile_changes = [k for k in set(profile_a) | set(profile_b) if profile_a.get(k) != profile_b.get(k)]
fixture_hash = hashlib.sha256((comparison / 'p0-dialogues.json').read_bytes()).hexdigest()
result = {
    'schemaVersion': 1, 'date': '2026-10-21',
    'sourceRuns': {'baseline': str(baseline), 'patched': str(patched), 'controlScripted': str(Path(args.control_scripted).resolve()), 'patchedScripted': str(Path(args.patched_scripted).resolve())},
    'models': {k: read(patched / 'manifest.json')[k] for k in ['model', 'judge', 'persona']},
    'completions': {'baseline': baseline_completion, 'patched': patched_completion},
    'profileChangedFields': profile_changes, 'fixtureSha256': fixture_hash,
    'focused': {'caseCount': len(focused), 'outcomes': dict(outcomes), 'weightedPreference': weighted,
                'metrics': focused_metrics, 'allScriptedDimensionMetrics': {d: metrics(scripted, d) for d in dimensions},
                'controlCaseCount': len(controls), 'newMajorControlRegressionsBothOrders': new_major_controls,
                'possibleNewMajorControlRegressionsEitherOrder': possible_new_major_controls,
                'gate': {'planVersion': plan.get('version'), 'weightedPreferenceAtLeast60Percent': weighted >= .6, 'allThreeAffectedConversationCountsDecrease': all(decreases.values()),
                         'decreasesByDimension': decreases, 'noNewMajorControlRegression': not new_major_controls,
                         'nonincreasesByDimension': nonincreases, 'decreaseOrFloorNonincrease': behavior_targets,
                         'knownClarificationBlockRemoved': known_clarification_fixed,
                         'passed': weighted >= .6 and (behavior_targets['overinterpretation'] and behavior_targets['repeated_closing'] and nonincreases['unnecessary_question'] and known_clarification_fixed if refined else all(decreases.values())) and not new_major_controls}},
    'eq': {'scenarios': eq_rows, 'dimensionMetrics': {d: metrics(eq, d) for d in dimensions},
           'outcomes': dict(collections.Counter(r['outcome'] for r in eq)),
           'controlMeans': read(baseline / 'eq-summary.json')['traits'],
           'patchedMeans': {d: sum(r['patchedTraits'][d] for r in eq_rows) / len(eq_rows) for d in eq_rows[0]['patchedTraits']},
           'patchedOriginalSummary': read(patched / 'eq-summary.json'), 'supplementalCaptures': eq_capture_recoveries,
           'supplementalCompletion': read(Path(args.eq_recovery).resolve() / 'completion.json') if args.eq_recovery else None,
           'supplementalManifest': read(Path(args.eq_recovery).resolve() / 'manifest.json') if args.eq_recovery else None,
           'controlAssistantTurns': sum(r['controlTurns'] for r in eq_rows), 'patchedAssistantTurns': sum(r['patchedTurns'] for r in eq_rows)},
    'followbench': {'baseline': follow_summary(baseline_follow, 150), 'patchedOriginal': follow_summary(patched_follow, 150),
                    'patchedSupplemented': follow_summary(supplemented, 150), 'supplementalGrades': recoveries,
                    'gainedCases': gains, 'lostCases': losses,
                    'gainedCasesByOriginalAuditCategory': gain_categories,
                    'ungradedCases': [r['caseId'] for r in supplemented if r.get('error')]},
    'pairs': {'scripted': scripted, 'eq': eq, 'follow': follow_pair},
    'limitations': ['One capture per condition; no statistical significance or real-user satisfaction claim',
                    'Diagnostic scripts are not an independent holdout; original EQ scenes were used in prior analysis',
                    'Two display orders use the same judge model; neither independent judges nor human ground truth',
                    'EQ whole-dialogue trajectories can diverge; fixed Chinese scripts are not adaptive user simulations',
                    'Neutral EQ trait means are not a scalar quality grade or official leaderboard result',
                    'Original transport errors remain immutable; supplemental grades reuse captured answers',
                    'Cloud aliases do not pin underlying backend weights; billing cost unavailable'],
    'costUsd': None}
development = root / '.xopc-evals/personal-style/p0-comparison-2026-10-21-v1'
if refined and development.exists():
    development_pairs = []
    for row in read(development / 'p0-dialogues.json')['cases']:
        if row['category'] not in dimensions[:3]:
            continue
        folder = development / 'judgments-scripted'
        development_pairs.append({'caseId': row['id'], 'category': row['category'], **aggregate_p0_pair(read(folder / (row['id'] + '.forward.json')), read(folder / (row['id'] + '.reverse.json')))})
    result['firstVariantDevelopmentDiagnostics'] = {'outcomes': dict(collections.Counter(r['outcome'] for r in development_pairs)),
        'metrics': {d: metrics([r for r in development_pairs if r['category'] == d], d) for d in dimensions[:3]},
        'partialFullRun': str(root / '.xopc-evals/personal-style/p0-gpt56-gpt61-2026-10-21-v2'),
        'includedInFinalScores': False, 'protocolChangeDisclosed': plan.get('protocolDeviation')}
out = Path(args.out).resolve()
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

pct = lambda value: f'{100 * value:.2f}%'
names = {'overinterpretation': '过度解读', 'unnecessary_question': '非必要追问', 'repeated_closing': '重复收尾',
         'premature_resolution': '过早宣布解决/信任', 'required_content_or_boundary': '内容或边界问题'}
def count(m, condition, field='bothOrders'):
    return m['conditions'][condition][field]['affectedConversations']

focus_table = '\n'.join(f'| {names[d]} | {count(m,"control")}/{m["conversations"]} | {count(m,"patched")}/{m["conversations"]} | {count(m,"control","eitherOrder")} → {count(m,"patched","eitherOrder")} |' for d,m in focused_metrics.items())
eq_table = '\n'.join(f'| {names[d]} | {count(m,"control")}/12 | {count(m,"patched")}/12 | {m["conditions"]["control"]["bothOrders"]["affectedReplyCount"]} → {m["conditions"]["patched"]["bothOrders"]["affectedReplyCount"]} | {count(m,"control","eitherOrder")} → {count(m,"patched","eitherOrder")} |' for d,m in result['eq']['dimensionMetrics'].items())
follow_table = '\n'.join(f'| {label} | {pct(result["followbench"][key]["HSR"])} | {pct(result["followbench"][key]["SSR"])} | {result["followbench"][key]["CSL"]:.3f} | {result["followbench"][key]["errors"]} |'
                         for label,key in [('原基线','baseline'),('新版原始运行','patchedOriginal')] + ([('新版补评后（原答复不变）','patchedSupplemented')] if recoveries else []))
eq_scene_table = '\n'.join(f'| {r["relationship"]} | {r["controlTraits"]["naturalness_authenticity"]:.0f} → {r["patchedTraits"]["naturalness_authenticity"]:.0f} | {r["controlTurns"]} → {r["patchedTurns"]} |'
                           for r in eq_rows)
eq_recovery_text = '原 EQ 运行完整，无场景补跑。' if not eq_capture_recoveries else f'原 EQ 运行 {result["eq"]["patchedOriginalSummary"]["scored"]}/12 场得到评分、{result["eq"]["patchedOriginalSummary"]["errors"]} 场调用失败。失败发生在候选第3轮、没有完整分数；保留原部分轨迹，只对该场景作一次同参数从头补跑。以下比较采用补跑后的12场完整轨迹；原错误与原11场均值仍保存在JSON，不替换已评分场景，不挑选更高分。场景：{", ".join(r["caseId"] for r in eq_capture_recoveries)}。该次场景重启是额外披露的传输恢复，未修改生产提示词或按验证成绩调参。'
gate = result['focused']['gate']
gate_text = '达到本轮预先注册的诊断门槛' if gate['passed'] else '未达到全部预先注册的诊断门槛，不能宣称三类问题已全面解决'
controls_text = '无两种顺序共同判定的新增重大退化' if not new_major_controls else '出现两种顺序共同判定的新增重大退化：' + '、'.join(new_major_controls)
recovery_text = '最终运行无需补评分。' if not recoveries else f'最终运行有 {len(recoveries)} 题在候选答复生成后缺少有效裁判结果，补评只复用已保存的原答复和官方提示词；未重生成候选。原运行与原错误仍完整保留。'
development_text = '''第一版在原 30 个中文诊断脚本上未达到门槛：重点 24 对中，新版稳定胜 3、旧版稳定胜 3、平 13、展示顺序不一致 5；过度解读的共同标注从 1/8 增至 3/8，重复收尾从 3/8 降至 2/8，非必要追问为 0/8 → 0/8。其完整基准运行在完成前停止，保留全部部分结果，不拼入最终成绩。

这促使第二版增加“不要安慰未表达的担忧”“情绪词不是隐藏动机的证据”，并删除收口示例中再次复述计划的暗示。**第一版的诊断题已成为开发数据。** 第二版使用新冻结的 30 个中文场景；冻结之后未再依据验证成绩改提示词。此调整偏离第一版计划中不再调参的约定，已在 `p0-refinement-plan.json` 明确披露；不是把同一版本按得分重跑并择优。''' if refined else '本报告对应首次诊断条件。'
evidence_lines = []
for dimension in dimensions[:3]:
    relevant = [r for r in scripted if r['category'] == dimension]
    improved = [r for r in relevant if r['conditions']['control'][dimension]['bothOrders'] and not r['conditions']['patched'][dimension]['bothOrders']]
    residual = [r for r in relevant if r['conditions']['patched'][dimension]['bothOrders']]
    for row, condition, label in [(r, 'control', '改善例：原版') for r in improved[:1]] + [(r, 'patched', '仍有残留：新版') for r in residual]:
        forward = read(row['judgmentSources'][0])
        side = 'left' if condition == 'control' else 'right'
        turns = row['conditions'][condition][dimension]['bothOrders']
        violation = next(v for v in forward['judgment'][side][dimension] if v['turn'] in turns)
        quote = violation['quote'].replace('\n', ' ')
        reason = violation['reason'].replace('\n', ' ')
        quote_stop = '' if quote.endswith(('。', '.', '！', '!', '？', '?')) else '。'
        reason_stop = '' if reason.endswith(('。', '.', '！', '!', '？', '?')) else '。'
        evidence_lines.append(f'- **{row["caseId"]}，{label}，{names[dimension]}**：第 {violation["turn"]} 条回复“{quote}”{quote_stop} 裁判依据：{reason}{reason_stop} 完整对照见 [forward]({row["judgmentSources"][0]}) / [reverse]({row["judgmentSources"][1]})。')
evidence_text = '\n'.join(evidence_lines) or '本轮未得到两种展示顺序一致的相关证据；不补造案例。'
md = f'''# Personal AI P0 修复与原基线对比

2026-10-21。被测模型固定 GPT-5.6 Sol，裁判与 EQ 模拟用户固定 GPT-6.1 Sol。候选 thinking off，裁判/模拟用户 low；单次采集，原始模型别名不等于锁定底层权重版本。

**结论：{gate_text}。** 中文重点验证的加权偏好为 **{pct(weighted)}**；这是同一个裁判交换展示顺序后的描述性结果，不是人类满意度或统计显著性结论。

本轮收益主要体现在重复收尾和局部澄清行为；中文过度解读的减少尚未稳定迁移到 EQ，整体自然度也没有提高。

## 1. 实际改动与验证边界

- 对缺失信息先判断是否实质改变答案、动作或授权；低风险创作可合理默认后直接完成，收件人/账号/破坏性操作仍须澄清。
- 不从一个情绪词推导隐藏动机或关系问题，不安慰用户未表达的担忧；被纠正后放下该推断，按当前具体需求回答。
- 用户接受已谈妥的计划、没有新问题时，简短回应并结束，不再提醒下一步、复述益处或追加追问；有新内容仍正常处理。
- 区分约定、执行和验证后的改善，不以一次同意宣布关系建立信任或事情已经解决。
- 旧画像只迁移完整匹配的生成规则，保留用户改写和引用；新增幂等迁移回归测试。

生产实现只改 [`prompts.ts`]({root}/src/personal-agent/prompts.ts) 和共享 [`reply-style.ts`]({root}/src/personal-agent/reply-style.ts)。A/B 其余生产源码、锁文件一致；测试文件另有一处改动。两轮使用全新默认画像和干净隔离会话；原基线与最终版画像发生变化的字段为 `{', '.join(sorted(profile_changes))}`。上游题库、原始评分提示和原 12 个 EQ 场景保持一致。

## 2. 中文固定对话验证：三类 P0

新增 30 个固定脚本，其中 24 个重点行为场景（各 8 个），另有 6 个必要澄清、详细交付、事实反驳控制场景。两边收到相同用户脚本，各自生成助手历史；隐藏期望没有交给候选。它不模拟真实用户的自适应回应，也不代表真实使用分布。

每对由 GPT-6.1 Sol 评两次，交换新旧的左右顺序，隐藏版本身份。每条问题必须附助手轮次和原文连续引文。主统计取两种顺序标出同一助手轮次的交集，同时保留并集作敏感性参考；这些仍是模型标注，不能称为独立人工确认。

| 行为 | 原版：受影响对话 | 新版：受影响对话 | 任一种顺序标出（原 → 新） |
|---|---:|---:|---:|
{focus_table}

重点 24 对：新版稳定胜 **{outcomes['patched']}**、旧版稳定胜 **{outcomes['control']}**、稳定平 **{outcomes['tie']}**、顺序不一致 **{outcomes['discordant']}**。加权偏好按胜 1、负 0、平及不一致各 0.5 计算；不一致保留，不追加择优裁判。两次调用来自同一模型，不是两名独立裁判。

控制场景：**{controls_text}**。任一种顺序疑似新增重大问题的场景：{'、'.join(possible_new_major_controls) or '无'}。零错误到零错误仅说明本轮未观察到退化，不能说已经证明该维度改善。已知 FollowBench `S11-L5` 的阻塞澄清是否移除：**{'是' if known_clarification_fixed else '尚未通过本轮判定'}**。

预先注册门槛逐项：加权偏好至少 60%：`{gate['weightedPreferenceAtLeast60Percent']}`；过度解读及收尾在原有问题时减少、原为零时不增加：`{behavior_targets}`；非必要追问不增加：`{nonincreases['unnecessary_question']}`；无新增重大控制退化：`{not new_major_controls}`。不因结果不理想而事后降低门槛。

### 改善与残留的具体证据

以下每类最多选一个改善例，同时列出所有两种顺序共同标注的新版残留，避免只展示正例。所有原文和相反/不一致判断均在逐例记录中。

{evidence_text}

控制用例中的轻微问题也保留：比如拒绝无依据的动机指控后，仍可能把“迟到造成影响”写成未经确认的事实；不能把“无新增重大退化”说成控制回答完全正确。纯提示词约束并没有保证每次生成都符合规则。

## 3. EQ：原 12 段对话的行为与倾向

{eq_recovery_text}

| 行为 | 原版受影响对话 | 新版受影响对话 | 两种顺序共同标出的回复数（原 → 新） | 任一种顺序标出的对话数（原 → 新） |
|---|---:|---:|---:|---:|
{eq_table}

整段轨迹盲评：新版稳定胜 **{result['eq']['outcomes'].get('patched',0)}**、旧版稳定胜 **{result['eq']['outcomes'].get('control',0)}**、稳定平 **{result['eq']['outcomes'].get('tie',0)}**、顺序不一致 **{result['eq']['outcomes'].get('discordant',0)}**。这是本地 P0 口径的比较，不是官方能力排名，也不能与中文 24 对混在一起以绕过其 60% 门槛。

具体看，parent 中原先的“convincing yourself”与“unbearable”等带预设的解读消失，裁判更偏好新版；chatbot 不再追问“丢掉权威还是被管理层审视”，但仍过于确定地推测同事沉默的原因。care home 的改进主要是减少无新增内容的尾部复述，原始自然度分仍为6。

也有反例：freelancer 从8轮变成5轮，盲评却稳定偏好旧版。新版将团队如何理解玩笑说成事实，并在已有可行约定后追问开玩笑的动机；这说明轮次更短不等于更好。**EQ 的过度解读受影响场景数没有下降；非必要追问在更宽的单顺序口径下也没有下降。重复收尾的减少更一致。** 因此不能宣布三类问题都已在多轮 EQ 中解决。

原版有 {result['eq']['controlAssistantTurns']} 条助手回复，新版有 {result['eq']['patchedAssistantTurns']} 条；对话回合数受上游 persona 结束规则影响，少说几轮本身不等于更好。EQ 两边的模拟用户续话可能不同，以上是整段轨迹的描述性比较，不能当作同一历史前缀上的因果实验。

完整12场的上游 pointwise 自然真实感均值 **{result['eq']['controlMeans']['naturalness_authenticity']:.3f} → {result['eq']['patchedMeans']['naturalness_authenticity']:.3f}**；临床/辅导式语体 **{result['eq']['controlMeans']['clinical_register_propensity']:.3f} → {result['eq']['patchedMeans']['clinical_register_propensity']:.3f}**；贴合用户框架 **{result['eq']['controlMeans']['native_frame_adaptation']:.3f} → {result['eq']['patchedMeans']['native_frame_adaptation']:.3f}**。这些是倾向画像，不能合成官方能力分；分析、建议、反驳和边界倾向不是一律越低或越高越好。

| 场景 | 原始自然度（原 → 新） | 助手轮数（原 → 新） |
|---|---:|---:|
{eq_scene_table}

官方 pointwise 评分与本地 P0 行为标注分开保留，不改写上游结果。英文角色扮演、公开角色上下文作为每轮用户前缀、固定回合预算以及裁判和模拟用户同模型，均限制外推。没有官方配对排名或真实用户验证。

## 4. FollowBench：全量回归与评分错误

| 版本 | HSR | SSR | CSL / 5 | 调用/评分错误 |
|---|---:|---:|---:|---:|
{follow_table}

{recovery_text} 原始失败与补评结果分开列示；不把 API 错误归为风格缺陷，也不把有评分错误的原运行说成全部成功。

原基线失败 → 新版通过：{len(gains)} 题；原通过 → 新版失败：{len(losses)} 题；最终仍未评分：{len(result['followbench']['ungradedCases'])} 题。逐题 ID 均保存在 JSON。一次文学风格判分的波动不能全部归因于 P0 改动；旧题面的隐藏累计约束、年代冲突和文体主观阈值仍存在，不据此重算“真实通过率”。

通过项按原审计主因分布为 `{gain_categories}`。这意味着 HSR 收益中也包含评分争议及拒绝/替代行为的波动，不能全部计作真实对话风格提升。

新增失分也不能一概推给 benchmark：例如 `S06-L5` 更偏列举文风特质和承诺，实际叙事较弱；`S17-L4` 仍把达西作为外部比较对象；`S23-L5` 对明确场景细节覆盖不足；`S01-L3` 出现缺乏线索支撑的海边解释。这些是值得保留的执行/证据问题，和文学文体阈值、时代冲突、模仿拒绝等失分一起逐例保留，不以总分上涨掩盖。

## 5. 第一版反例、停止与方法调整

{development_text}

另外，一次初始运行因发现复制了现存个人画像、与原基线的全新默认画像不一致而提前停止。该运行也单独保留，不纳入最终对比。所有中断、错误、顺序不一致及负向结果均未删除。没有从失败用例中挑选最好的回答拼接成绩。

## 6. 测试与可复现材料

- Personal 相关 12 个测试文件、156 项测试通过；项目类型检查通过；风格 adapter 类型检查和 7 项 Python 协议/聚合测试通过。
- [机器可读完整对比]({out.name})：含逐例结果、各维度交集与并集、原始/补充评分及未通过门槛。
- [原始基线报告](personal-dialogue-style-baseline-2026-10-21.md)；[失败审计与原优化方案](personal-dialogue-style-failure-audit-2026-10-21.md)。
- 最终生产快照：`{read(patched / 'manifest.json')['commit']}`；源码哈希 `{read(patched / 'manifest.json')['sourceHash']}`；运行结束源码变化：`{patched_completion['sourceChanged']}`。
- 最终原始运行：`{patched}`；原基线：`{baseline}`。
- 中文新验证、冻结计划、源差异与全部盲评：`{comparison}`。
- 新中文固定脚本 SHA-256：`{fixture_hash}`。

费用回执不可用，费用记为 unknown/null，不依据模型目录零价格声称免费。本轮只有单次采集和单一裁判模型；达到诊断门槛也不等于三类问题从此不再出现。真实中文日常使用与独立人工校准仍需后续验证。
'''
out.with_suffix('.md').write_text(md)
print(json.dumps({'out': str(out), 'focusedOutcomes': dict(outcomes), 'focusedPreference': weighted, 'gate': result['focused']['gate'],
                  'followHSR': [result['followbench'][key]['HSR'] for key in ['baseline', 'patchedOriginal', 'patchedSupplemented']],
                  'eqNaturalness': [result['eq'][key]['naturalness_authenticity'] for key in ['controlMeans', 'patchedMeans']]}, ensure_ascii=False))
