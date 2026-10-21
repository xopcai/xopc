"""Report the frozen EQ refinement without modifying capture or judge evidence."""
import argparse
import collections
import hashlib
import json
from pathlib import Path

from protocol import follow_summary

parser = argparse.ArgumentParser()
parser.add_argument('--root', default=str(Path(__file__).resolve().parents[3]))
args = parser.parse_args()
root = Path(args.root).resolve()
local = root / '.xopc-evals/personal-style'
control = local / 'p0-refined-gpt56-gpt61-2026-10-21-v1'
control_recovery = local / 'p0-eq-capture-recovery-2026-10-21-v1'
patched = local / 'eq-refinement-isolated-eq-v1'
follow_patched = local / 'eq-refinement-full-v2'
comparison = local / 'eq-refinement-isolated-comparison-v1'
development = local / 'eq-refinement-comparison-v2'
read = lambda p: json.loads(p.read_text())
dimensions = ['overinterpretation', 'unnecessary_question', 'repeated_closing',
              'premature_resolution', 'required_content_or_boundary', 'didactic_expression']


def outcome(first, second):
    a = {'left': 'control', 'right': 'patched', 'tie': 'tie'}[first]
    b = {'left': 'patched', 'right': 'control', 'tie': 'tie'}[second]
    return a if a == b else 'discordant'


def aggregate(folder):
    completion = read(folder / 'completion.json')
    recovered_calls = []
    registration = read(folder / 'registration.json')
    assert registration['styleFocus']
    pairs = []
    for registered in registration['pairs']:
        case = registered['id']
        calls = []
        for order in ['forward', 'reverse']:
            original_path = folder / f'{case}.{order}.json'
            call = read(original_path)
            if call.get('error'):
                recovery = folder.with_name(folder.name + '.recovery-' + case + '-' + order)
                reg = read(recovery / 'registration.json')
                assert read(recovery / 'completion.json')['complete'] and reg['recoveryOf'] == str(original_path)
                assert reg['originalSha256'] == hashlib.sha256(original_path.read_bytes()).hexdigest()
                replacement = read(recovery / original_path.name)
                assert replacement['input'] == call['input'] and not replacement.get('error')
                recovered_calls.append({'original': str(original_path), 'supplemental': str(recovery / original_path.name), 'error': call['error']})
                call = replacement
            calls.append(call)
        first, second = calls
        assert not first.get('error') and not second.get('error')
        a, b = first['judgment'], second['judgment']
        row = {'caseId': case, 'category': registered['category'],
               'overall': outcome(a['winner'], b['winner']),
               'naturalness': outcome(a['naturalnessWinner'], b['naturalnessWinner']),
               'reasons': [a['reason'], b['reason']],
               'naturalnessReasons': [a['naturalnessReason'], b['naturalnessReason']], 'conditions': {}}
        for condition, one, two in [('control', 'left', 'right'), ('patched', 'right', 'left')]:
            row['conditions'][condition] = {}
            for dimension in dimensions:
                x, y = a[one][dimension], b[two][dimension]
                turns = [{v['turn'] for v in values} for values in [x, y]]
                major = [{v['turn'] for v in values if v['severity'] == 'major'} for values in [x, y]]
                row['conditions'][condition][dimension] = {
                    'bothOrders': sorted(turns[0] & turns[1]), 'eitherOrder': sorted(turns[0] | turns[1]),
                    'majorBothOrders': sorted(major[0] & major[1]), 'majorEitherOrder': sorted(major[0] | major[1]),
                    'evidence': [x, y]}
        pairs.append(row)
    metrics = {}
    for dimension in dimensions:
        metrics[dimension] = {}
        for condition in ['control', 'patched']:
            metrics[dimension][condition] = {}
            for rule in ['bothOrders', 'eitherOrder', 'majorBothOrders', 'majorEitherOrder']:
                affected = [p for p in pairs if p['conditions'][condition][dimension][rule]]
                metrics[dimension][condition][rule] = {
                    'conversations': len(affected), 'replies': sum(len(p['conditions'][condition][dimension][rule]) for p in pairs),
                    'caseIds': [p['caseId'] for p in affected]}
    assert completion['attempted'] == completion['expected'] and completion['errors'] == len(recovered_calls)
    return {'pairs': pairs, 'metrics': metrics, 'originalCompletion': completion, 'recoveredJudgeCalls': recovered_calls,
            'outcomes': {key: dict(collections.Counter(p[key] for p in pairs)) for key in ['overall', 'naturalness']},
            'registration': registration}


def capture(folder, case):
    path = folder / 'cases' / f'{case}.json'
    row = read(path)
    if row.get('error'):
        recovery = control_recovery if folder == control else local / 'eq-refinement-recovery-v1'
        replacement = recovery / 'cases' / f'{case}.json'
        assert replacement.exists(), (path, row['error'])
        assert read(recovery / 'completion.json')['exitCode'] == 0
        row = read(replacement)
        path = replacement
    assert not row.get('error'), path
    return row, str(path)


eq = aggregate(comparison / 'judgments-eq')
scripted, validation = [aggregate(development / f'judgments-{kind}') for kind in ['scripted', 'validation']]
creative = aggregate(comparison / 'judgments-creative')
scenes = []
for item in read(control / 'selection.json')['eq']:
    old, old_path = capture(control, item['caseId'])
    new, new_path = capture(patched, item['caseId'])
    scenes.append({'caseId': item['caseId'], 'relationship': item['relationship'],
                   'controlTraits': old['traits'], 'patchedTraits': new['traits'],
                   'controlTurns': old['assistantTurns'], 'patchedTurns': new['assistantTurns'],
                   'controlSource': old_path, 'patchedSource': new_path})
crisis = next(s for s in scenes if s['relationship'] == 'crisis_line_volunteer')
crisis_capture = read(Path(crisis['patchedSource']))
pointwise_prompt = crisis_capture['conversation']['prompts']['performance_judge_prompt']
visible = '\n'.join(m['content'] for m in crisis_capture['conversation']['transcript'])
visibility = {'caseId': crisis['caseId'], 'source': crisis['patchedSource'],
              'pointwiseSeesHiddenProfile': 'TRUE PERSONA PROFILE' in pointwise_prompt,
              'pointwiseSeesInternalThoughts': '<internal>' in pointwise_prompt,
              'hiddenFeedbackExample': 'The staircase thing sounds rehearsed',
              'feedbackPresentInPointwisePrompt': 'The staircase thing sounds rehearsed' in pointwise_prompt,
              'feedbackPresentInVisibleDialogue': 'The staircase thing sounds rehearsed' in visible,
              'customBlindJudgeUsesVisibleDialogueOnly': True}
means = {condition: {d: sum(s[condition + 'Traits'][d] for s in scenes) / len(scenes)
                    for d in scenes[0]['controlTraits']} for condition in ['control', 'patched']}
reply_denominators = {condition: sum(s[condition + 'Turns'] for s in scenes) for condition in ['control', 'patched']}
for dimension in dimensions:
    for condition in ['control', 'patched']:
        metric = eq['metrics'][dimension][condition]
        metric['bothOrderRepliesPer100AssistantReplies'] = 100 * metric['bothOrders']['replies'] / reply_denominators[condition]
third_party = {'method': 'Post-hoc analyst categorization of absent-third-party mental-state/effect claims among both-order overinterpretation flags; secondary, not a preregistered judge dimension.', 'conditions': {}}
for condition, tags in [('control', [('chatbot', 3), ('family_member', 3), ('freelancer', 2)]), ('patched', [('freelancer', 2)])]:
    evidence = []
    for category, turn in tags:
        item = next(p for p in eq['pairs'] if p['category'] == category)
        value = item['conditions'][condition]['overinterpretation']
        assert turn in value['bothOrders']
        evidence.append({'caseId': item['caseId'], 'category': category, 'turn': turn,
                         'quotesByOrder': [[v['quote'] for v in order if v['turn'] == turn] for order in value['evidence']]})
    third_party['conditions'][condition] = {'conversations': len(evidence), 'replies': len(evidence),
        'per100AssistantReplies': 100 * len(evidence) / reply_denominators[condition], 'evidence': evidence}
follow = {}
follow_rows = {}
for condition, folder in [('control', control), ('patched', follow_patched)]:
    rows = [read(p) for p in sorted((folder / 'cases').glob('FB-*.json'))]
    assert len(rows) == 150
    follow[condition] = follow_summary(rows, 150)
    follow_rows[condition] = {r['caseId']: r for r in rows}
follow['gains'] = [k for k in follow_rows['control'] if not follow_rows['control'][k]['hardSatisfied'] and follow_rows['patched'][k]['hardSatisfied']]
follow['losses'] = [k for k in follow_rows['control'] if follow_rows['control'][k]['hardSatisfied'] and not follow_rows['patched'][k]['hardSatisfied']]
gates = {}
for dimension in ['overinterpretation', 'didactic_expression']:
    metric = eq['metrics'][dimension]
    gates[dimension + 'Decreased'] = metric['patched']['bothOrders']['conversations'] < metric['control']['bothOrders']['conversations']
for metric in ['overall', 'naturalness']:
    counts = eq['outcomes'][metric]
    gates[metric + 'StableWinsExceedLosses'] = counts.get('patched', 0) > counts.get('control', 0)
gates['noNewMajorFailureEitherOrder'] = not any(
    p['conditions']['patched'][d]['majorEitherOrder']
    and not p['conditions']['control'][d]['majorEitherOrder']
    for suite in [eq, creative] for p in suite['pairs'] for d in dimensions)
gates['passed'] = all(gates.values())
known_creative = follow_rows['patched']['FB-ZH-S11-L5']
regression_blockers = {'knownCreativeClarificationReturned': not known_creative['hardSatisfied'],
                       'followHSRDecreased': follow['patched']['HSR'] < follow['control']['HSR']}
creative_fixed = not creative['metrics']['unnecessary_question']['patched']['eitherOrder']['conversations'] and not creative['metrics']['required_content_or_boundary']['patched']['majorEitherOrder']['conversations']
release_ready = gates['passed'] and creative_fixed
result = {'schemaVersion': 1, 'date': '2026-10-21', 'models': {k: read(patched / 'manifest.json')[k] for k in ['model', 'judge', 'persona']},
          'plan': read(comparison / 'eq-refinement-plan.json'), 'eq': eq, 'scripted': scripted, 'validation': validation, 'creative': creative,
          'sourceAudit': read(comparison / 'source-audit.json'), 'concurrentChangeAudit': read(comparison / 'confounding-audit.json'),
          'scope': {'finalEQ': str(patched), 'adjacentV2Follow': str(follow_patched), 'finalFullFollowCompleted': False, 'creativeGuardPassed': creative_fixed},
          'developmentArtifacts': {'v2Comparison': str(development),
                                   'v3CreativeCapture': str(local / 'eq-refinement-creative-patched-v3'),
                                   'v4CreativeCaptureExcluded': str(local / 'eq-refinement-creative-patched-v4'),
                                   'finalIsolatedCreativeCapture': str(local / 'eq-refinement-isolated-creative-v1')},
          'failedDevelopmentVariant': {'root': str(local / 'eq-refinement-comparison-v1'),
                                       'excludedPartialFullRun': read(local / 'eq-refinement-full-v1/excluded-run.json')},
          'scenes': scenes, 'pointwiseVisibility': visibility, 'thirdPartyAudit': third_party,
          'didacticLabelInterpretation': 'Both-order prevalence is zero in both conditions. This floor cannot demonstrate reduction; naturalness judgments still mention managerial coaching and polished summaries. Do not claim no didactic tone or change the rubric after results to force a pass.', 'traitMeans': means, 'assistantReplyDenominators': reply_denominators, 'follow': follow, 'gates': gates, 'observedRegressionBlockers': regression_blockers, 'focusAndCreativeGatePassed': release_ready,
          'adjacentV2Source': {'manifest': read(follow_patched / 'manifest.json'), 'completion': read(follow_patched / 'completion.json') if (follow_patched / 'completion.json').exists() else None, 'followPhaseCompletion': read(follow_patched / 'follow-phase-completion.json') if (follow_patched / 'follow-phase-completion.json').exists() else None},
          'sources': {condition: {'root': str(folder), 'manifest': read(folder / 'manifest.json'),
                                  'completion': read(folder / 'completion.json')}
                      for condition, folder in [('control', control), ('patched', patched)]}}
assert not any(v['completion']['sourceChanged'] for v in result['sources'].values())
report = root / 'docs/design/technical/personal-dialogue-style-eq-refinement-2026-10-21.json'
report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
lines = ['# Personal AI EQ 残留风格优化与复测（2026-10-21）', '',
         '测试 GPT-5.6 Sol；裁判、模拟用户 GPT-6.1 Sol。最终隔离候选与上一轮 P0 对比相同 12 场 EQ，并验证 1 个创作控制。开发版 v2 的 150 条 FollowBench、12 个开发脚本及 4 个新控制另列，不视为最终源码的全量分数。', '',
         '## 原因复核', '',
         '- 过度解读从用户情绪转移到第三方：旧规则没有明确约束缺席同事、妹妹和团队的内心。顾问场景声称团队把分析当凑工时；家庭场景先承认不知道妹妹感受，随后又断言她的自卑、受制处境和家人共同意识。这是具体证据边界问题。',
         '- 说教来自多余的解释与评价：在已经给出可执行用语后附加“这才是高标准与自控”，或者在协议达成后继续盘问动机。单纯缩短或增加礼貌并不能解决。',
         '- 上轮自然度 6.583→6.500 是 12 场合计下降 1 分，不能推断显著退步。applicant、employee、crisis_line_volunteer 各 7→6；direct_report、parent 各 6→7。裁判说明分别指出等待时重复追加要求、每轮整齐地感谢总结加追问、包装过的辅导式重构。动态模拟用户的走向也有变化，不能把全部差异归因于提示词。',
         '- 上游 pointwise 裁判可见被测模型未见的隐藏画像与 <internal> 内心独白。本轮热线场景中“楼梯比喻像排练过的”仅在模拟用户内心出现，随后用于自然度评分理由；不能表述成可见用户已明确说过。这是模拟器与裁判共同塑造的信号，不是现实用户满意度。本轮双顺序盲评只看可见文本，单列这个测量差异。',
         '- 上轮临床/辅导式语体均值从 4.417 降到 4.000，但自然度仍下降，说明减少某一中性语体倾向并不能替代自然度判断；尤其 applicant 的问题是重复的专业流程话语，并非治疗式措辞。',
         '- 默认 profile 的 supportMode=untangle 另要求“命名核心问题，使其可处理”，可能与 EQ 的深层洞察任务一起强化持续辅导；这是尚未单独隔离验证的交互假设，本轮保留该偏好。',
         '- EQ 公共任务反复要求了解深层需求、人格和动机，且设置最多 8 轮；它会诱发继续探查。该语境是 benchmark 的压力因素，具体无依据的断言仍是模型问题。本轮保留相同语境以维持可比性。', '',
         '角色扮演需要补足某些虚构对话细节，不能将所有新增细节都标为生产幻觉；本轮重点仍是缺乏依据的第三方心理断言、加载动机的追问，以及被纠正后继续换词重述。', '',
         '## 本轮修改', '',
         '开发版 v1 在固定脚本中出现虚构已完成补测的严重错误，停止其部分全量运行并保留证据。v2 恢复草稿事实边界和等待规则，但完整 FollowBench 回归发现 S11-L5 再次先澄清。随后尝试收窄事实规则并恢复创作示例；v3/v4 快照夹带并行默认风格改动，其结果全部排除。最终从冻结旧控制重建，只叠加提示词、迁移逻辑和迁移测试三个文件，其他 src 逐字节一致。新候选在结果前冻结，重新捕获 EQ 和创作控制；不混用各版分数。', '',
         '明确观察与推断的边界，覆盖第三方和群体；修正后撤回推断，不以更温和语气重复。直接按当前角色答复；只解释仍有实际疑惑的区别，避免道德总结、评价对方及已经达成协议后的动机追问。加入英文观察与推断示例并恢复中文直接创作示例；保留温暖、合理异议、必要说明和授权澄清。旧配置按完整已知规则块迁移，保留自定义内容。', '',
         '## 与上一轮的盲评', '',
         '同一裁判分别看两个展示顺序，隐藏新旧身份。主指标要求两个顺序均标记同一助手轮次；并集作为敏感性结果。新增说教维度和独立自然度偏好，两版均在同一新量表下重评，不能与上一报告的旧量表次数直接拼接。', '',
         '| EQ 指标（受影响对话/12） | 上轮 P0 | 本轮 |', '|---|---:|---:|']
for dimension in dimensions:
    metric = eq['metrics'][dimension]
    lines.append(f"| {dimension} | {metric['control']['bothOrders']['conversations']} | {metric['patched']['bothOrders']['conversations']} |")
lines += ['', f"人工事后复核上述双序过度解读标记中的“缺席第三方心理/效果断言”：3场→1场（旧：同事、妹妹、团队；新：团队）。这是次级分类，不是预注册的新裁判指标。广义过度解读仍包含对当前对话者和关系的过度框定。助手回复总数：{reply_denominators}，机器报告另给每百条助手回复的缺陷次数，避免只因更早结束而显得缺陷减少。整体偏好：{eq['outcomes']['overall']}；自然度偏好：{eq['outcomes']['naturalness']}。control=上轮、patched=本轮；discordant=两个顺序结论不同，不擅自折成胜或负。", '',
          '说教违规主计数两版均为0，存在地板效应；不能据此证明减少，也不能断言没有训练腔。盲评自然度理由仍多次指出泛化管理格言、流程化总结等问题。下一轮需预先加入带例子的连续语气强度评估，而不是事后放宽标签制造通过。', '',
          f"v2 的 12 个开发脚本整体偏好：{scripted['outcomes']['overall']}；自然度偏好：{scripted['outcomes']['naturalness']}。这些脚本由残留问题设计，属于开发回归集，不是未见真实用户样本。", '',
          f"v2 新增 4 个控制整体偏好：{validation['outcomes']['overall']}；自然度偏好：{validation['outcomes']['naturalness']}。这些用例结果属于开发证据，不能作为最终隔离候选的未见验证。", '',
          f"预注册门槛：`{json.dumps(gates, ensure_ascii=False)}`。", '',
          '## 原有评分与约束回归', '',
          f"EQ 自然度均值 {means['control']['naturalness_authenticity']:.3f}→{means['patched']['naturalness_authenticity']:.3f}。此为 pointwise 倾向画像，无官方排行榜意义；不宣称显著性。", '',
          '| 场景 | 自然度（上轮→本轮） | 助手轮数 | 整体偏好 | 自然度偏好 |', '|---|---:|---:|---|---|']
for scene, pair in zip(scenes, eq['pairs']):
    assert scene['caseId'] == pair['caseId']
    lines.append(f"| {scene['relationship']} | {scene['controlTraits']['naturalness_authenticity']:.0f}→{scene['patchedTraits']['naturalness_authenticity']:.0f} | {scene['controlTurns']}→{scene['patchedTurns']} | {pair['overall']} | {pair['naturalness']} |")
lines += ['', f"近邻版本 v2 的 FollowBench（不是最终隔离候选全量评分）：HSR {follow['control']['HSR']:.2%}→{follow['patched']['HSR']:.2%}；SSR {follow['control']['SSR']:.2%}→{follow['patched']['SSR']:.2%}；CSL {follow['control']['CSL']:.3f}→{follow['patched']['CSL']:.3f}。两轮各150条均有有效评分；v2阶段结束源码哈希独立校验不变，主进程在后续EQ阶段完成前主动停止，不能宣称整个原始进程成功退出。", '',
          f"既知创作题 S11-L5：上轮 `{follow_rows['control']['FB-ZH-S11-L5'].get('verdicts')}`→本轮 `{known_creative.get('verdicts')}`。候选回答：{known_creative.get('answer', '')}。这是 v2 的实际回归，且“起草文本不许虚构事件”存在语义范围过宽的问题。v3/v4 的单项结果因夹带并行默认风格改动被排除，不能用来推断修复的因果效果；最终隔离源码恢复旧宿主并保留修复后另行验证；单次采样不能证明因果效应大小。", '',
          f"最终隔离候选创作控制是否通过：`{creative_fixed}`；EQ 聚焦门槛与创作保护共同通过：`{release_ready}`。v2 额外观察到的回归：`{json.dumps(regression_blockers, ensure_ascii=False)}`。这些是本轮观察到的保护条件，不冒充预注册指标。最终隔离候选没有完成 150 条 FollowBench，不能据此宣称全量约束回归通过。", '',
          f"v2 旧失败转通过 {len(follow['gains'])} 条，旧通过转失败 {len(follow['losses'])} 条；完整 ID 与每场的双顺序引文、分歧、严重性、来源和源码哈希见同名 JSON。", '',
          '## 复核重点与证据', '']
case_analysis = {
    'adult_child': '总体与自然度均存在展示顺序分歧。新版更快形成责任与回复时限，仍有一次裁判认为结尾重复确认承诺。',
    'applicant': '两序均偏好新版：对截止日期和临时流程提出有用问题，答应等待后结束；旧版反复催问已承诺的四点。',
    'board_member': '两序均偏好新版：更像业主就具体责任和更新协商；但把请求中的时限说得像既定安排，被纠正后才回到准确表述。',
    'chatbot': '总体与自然度均分歧。对同事感受的事实断言减少，但新版一度把“不提问”本身当绩效问题，用户纠正为“结果好就不在乎问多少”。脚本后仍附“示范担当”等解释性结论。',
    'crisis_line_volunteer': '两序均偏好旧版。已约定只打电话问保密政策后，新版又询问性行为同意及对象年龄，打断当前范围；不能由此推断应取消所有必要安全筛查。反复的分阶段目标和楼梯比喻也显得包装过。',
    'direct_report': '整体与自然度稳定持平。两边都围绕工作范围、检查点和权限推进，正式的复述在该工作语境中有用途，未被当作无端说教。',
    'employee': '整体结论分歧、自然度持平。新版角色声音更具体，仍有一次裁判指出把待核对的空闲时段提前当成待确认的既定安排。',
    'family_member': '妹妹的自卑和受制处境叙事消失，但开场仍问“你更介意我反对，还是觉得家里只看到你的错”，把未经表达的感受塞进二选一。核心过度解读转移到了当前对话者。',
    'freelancer': '两序均偏好新版：协议后不再重开客户动机分析；仍断言笑话已使全场准备否定建议（“it primed the room to dismiss the recommendation”），把担心的影响当成事实。',
    'friend': '自然度两序均偏好新版，整体存在分歧。新版4轮结束，能承认具体伤害并接受朋友的合理边界；旧版8轮中的逐项澄清更像谈判。对话长度与走向差异是限制。',
    'junior_colleague': '两序整体与自然度均偏好旧版。新版末尾又重述已谈妥的准备和审阅安排；旧版更贴近归功与职业可见性的个人关切。',
    'parent': '自然度两序均偏好旧版。新版把一次朋友聚餐说成“不让关系变成你整个人生”，被用户否认。旧版以具体周三安排及“properly boring Wednesday”收尾，更贴合普通生活愿望。',
}
for pair in eq['pairs']:
    lines.append(f"- **{pair['category']}**：{case_analysis[pair['category']]}")
lines += ['', '## 后续优化建议', '',
          '1. 保留第三方证据边界，在旧P0指导上做更小增量；保留原有内容完整性与创作示例，降低重写其他规则带来的回归风险。',
          '2. 把有动机预设的二选一改成自己的具体关切和行为请求；对父母、家属角色，用实际日程与对方明确表达的需求推进，不扩展为整段关系的定性。',
          '3. 对管理建议先交付可直接说的文字，再按尚未解决的疑问解释；评估工作结果而非是否按助手设计的流程提问。对情绪支持减少包装式比喻和提前庆祝，保留必要安全信息。',
          '4. 用相同用户续话检验家属、顾问、父母和热线残留；在结果前冻结语气强度锚点，分别评估“内容合理但像培训”和“无端说教”。最终候选还需完整150条FollowBench；共享工作区并行默认风格完成后，应另建集成基线。', '',
          '候选补丁：`docs/design/technical/personal-dialogue-style-eq-candidate-2026-10-21.patch`。本轮聚焦门槛未全部通过，不应以自然度均值上升替代这项结论。', '']
lines += ['', '## 可比性与限制', '',
          '热线场景的必要安全筛查不能因为显得像清单就删掉；需要改的是铺垫、比喻和重复结尾，而不是牺牲必要信息。管理建议中仍须区分工作结果与“必须提问”的程序要求，避免把沉默自动升级为绩效或心理问题。', '',
          '当前共享工作区另有并行默认风格与配置 API 改动，不属于本轮隔离候选，不能宣称其已被本轮验证。源码对比另有上一轮快照之后合入的 connector 变更，源码差异清单保留；评测 profile 除 instructions 外一致，运行身份仅 configHash 改变。不能把整包源码哈希变化解释为只有提示词变更。上一轮家庭场景沿用已留存的同源码服务调用错误重跑；原错误不覆盖。所有捕获使用独立生产 Gateway、全新默认 Personal profile、相同上下游模型和推理档位；源码冻结且运行结束校验。每场最终对话只有一次候选采样，双方模拟用户续写可能不同；双顺序来自同一个裁判，不是两个独立评审。不能由本轮均值或偏好证明统计显著、生产用户满意度或真实执行结果。没有按低分重跑相同源码。v1→v2→v3→v4 均是明确修改源码后的开发迭代；它们已成为开发数据，不冒充独立未见验证。v3/v4 结果因夹带并行改动排除；最终 EQ 在对照源码上重建隔离候选后才完整捕获，src 只改变提示词和迁移测试三个文件，其他 src 与旧控制逐字节相同。', '',
          '创作控制的一次裁判输出因多余JSON右括号解析失败；原错误保留，同输入、同量表、同模型补充一次评分，未重生成候选。其余24次最终EQ盲评均有效。隔离候选157项Personal测试、类型检查和7项协议测试通过。', '',
          f"原始证据：`{comparison}`；机器可读报告：`{report}`。"]
report.with_suffix('.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({'eq': eq['outcomes'], 'scripted': scripted['outcomes'], 'validation': validation['outcomes'], 'traitMeans': means, 'gates': gates, 'follow': follow}, ensure_ascii=False))
