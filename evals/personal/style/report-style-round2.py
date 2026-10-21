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


def aggregate(kind):
    folder = COMPARISON / ('judgments-' + kind)
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


eq, scripted = [aggregate(kind) for kind in ['eq', 'scripted']]
completion = read(PATCHED / 'completion.json')
assert not completion['sourceChanged']
old_completion = read(CONTROL / 'completion.json')
assert not old_completion['sourceChanged'] and old_completion['exitCode'] == 0
scenes = []
for item in read(CONTROL / 'selection.json')['eq']:
    old = read(CONTROL / 'cases' / (item['caseId'] + '.json'))
    new = read(PATCHED / 'cases' / (item['caseId'] + '.json'))
    assert not old.get('error') and not new.get('error'), item['caseId']
    scenes.append({'caseId': item['caseId'], 'category': item['relationship'],
                   'controlTraits': old['traits'], 'patchedTraits': new['traits'],
                   'controlTurns': old['assistantTurns'], 'patchedTurns': new['assistantTurns']})
assert len(scenes) == 12
traits = {condition: {d: sum(s[condition + 'Traits'][d] for s in scenes) / len(scenes)
                      for d in scenes[0]['controlTraits']} for condition in ['control', 'patched']}
reply_counts = {condition: sum(s[condition + 'Turns'] for s in scenes) for condition in ['control', 'patched']}
for dim in DIMS:
    for condition in ['control', 'patched']:
        eq['metrics'][dim][condition]['bothOrderRepliesPer100'] = 100 * eq['metrics'][dim][condition]['bothOrders']['replies'] / reply_counts[condition]
follow = {}
follow_rows = {}
for condition, folder in [('historicalP0', HISTORICAL), ('patched', PATCHED)]:
    rows = [read(p) for p in sorted((folder / 'cases').glob('FB-*.json'))]
    assert len(rows) == 150
    follow[condition] = follow_summary(rows, 150)
    follow_rows[condition] = {r['caseId']: r for r in rows}
assert follow['patched']['complete']
follow['previousFinalCandidateHasFull150'] = False
follow['gainsVsHistoricalP0'] = [k for k in follow_rows['patched'] if not follow_rows['historicalP0'][k]['hardSatisfied'] and follow_rows['patched'][k]['hardSatisfied']]
follow['lossesVsHistoricalP0'] = [k for k in follow_rows['patched'] if follow_rows['historicalP0'][k]['hardSatisfied'] and not follow_rows['patched'][k]['hardSatisfied']]
follow['S11L5'] = follow_rows['patched']['FB-ZH-S11-L5']
major_dimensions = ['required_content_or_boundary', 'premature_resolution', 'unnecessary_question']
gates = {
    'all150FollowValid': follow['patched']['complete'],
    'all12EQValid': read(PATCHED / 'eq-summary.json')['complete'],
    'sourceUnchanged': not completion['sourceChanged'],
    'S11L5AllFiveSatisfied': follow['S11L5']['hardSatisfied'],
    'overinterpretationNonincrease': eq['metrics']['overinterpretation']['patched']['bothOrders']['conversations'] <= eq['metrics']['overinterpretation']['control']['bothOrders']['conversations'],
    'coachingMeanDropAtLeastQuarterPoint': eq['toneMeans']['coaching_register']['control'] - eq['toneMeans']['coaching_register']['patched'] >= .25,
    'motiveMeanNonincrease': eq['toneMeans']['motive_menu']['patched'] <= eq['toneMeans']['motive_menu']['control'],
    'relationshipMeanNonincrease': eq['toneMeans']['relationship_generalization']['patched'] <= eq['toneMeans']['relationship_generalization']['control'],
    'noNewMajorContentBoundaryOrBlocking': not any(p['conditions']['patched'][dim]['majorEitherOrder'] and not p['conditions']['control'][dim]['majorEitherOrder']
                                                 for suite in [eq, scripted] for p in suite['pairs'] for dim in major_dimensions)}
for metric in ['overall', 'naturalness']:
    counts = eq['outcomes'][metric]
    gates[metric + 'StableWinsAtLeastLosses'] = counts.get('patched', 0) >= counts.get('control', 0)
gates['passed'] = all(gates.values())
focused_tones = {tone: {condition: sum(p['tones'][condition][tone]['mean'] for p in scripted['pairs'] if p['category'] == tone) / 3
                       for condition in ['control', 'patched']} for tone in TONES}
result = {'schemaVersion': 1, 'date': '2026-10-21', 'eq': eq, 'scripted': scripted,
          'focusedScriptToneMeans': focused_tones, 'scenes': scenes, 'traitMeans': traits,
          'assistantReplyCounts': reply_counts, 'follow': follow, 'gates': gates,
          'plan': read(COMPARISON / 'eq-style-round2-plan.json'), 'sourceAudit': read(COMPARISON / 'registration.json'),
          'sourceRuns': {'controlEQ': str(CONTROL), 'patched': str(PATCHED), 'historicalP0Follow': str(HISTORICAL)},
          'sourceManifest': read(PATCHED / 'manifest.json'), 'sourceCompletion': completion}
output = ROOT / 'docs/design/technical/personal-dialogue-style-round2-2026-10-21.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
lines = ['# Personal AI 风格第二轮优化与完整回归（2026-10-21）', '',
         '**结论：本轮已完整验证，但未通过晋级门槛，不建议替换上一轮。** EQ关系泛化强度下降，动机二选一核心用例仍在；培训腔和自然度回退，并新增编造第三方私下披露的重大内容问题。保留候选补丁与全部证据，不将它标记为验证通过的修复。', '',
         '测试 GPT-5.6 Sol，裁判与模拟用户 GPT-6.1 Sol。EQ对照是上一轮最终隔离候选（自然度6.917），不是更早的P0版本。最终候选同一冻结源码完整捕获150条FollowBench和12场EQ，另有两版相同的13个固定用户脚本。', '',
         '## 修改与隔离', '',
         '恢复P0中经过验证的前五条内容与表达规则，保留创作和必要澄清示例；集中约束未表达动机的菜单式提问、单一事件到长期关系的泛化、培训口号和流程化收尾。加入具体异议、时间协调及简短道歉示例。迁移仅替换已知完整生成规则，并对仍沿用的规则去重、保留原位置及自定义文字。', '',
         '从上一轮冻结源码派生，只有reply-style、prompts迁移及迁移测试三个src文件变化。共享工作区的并行默认风格/API变更未纳入，实际profile除instructions外必须一致。源代码、量表和脚本在结果前冻结，没有依据分数重新生成候选。', '',
         '## EQ 双顺序盲评', '',
         f"整体偏好：{eq['outcomes']['overall']}；自然度偏好：{eq['outcomes']['naturalness']}。patched=新版，control=上轮，discordant=两个顺序不一致。", '',
         '| 违规：受影响对话/12（双序同轮交集） | 上轮 | 新版 |', '|---|---:|---:|']
for dim in DIMS:
    lines.append(f"| {dim} | {eq['metrics'][dim]['control']['bothOrders']['conversations']} | {eq['metrics'][dim]['patched']['bothOrders']['conversations']} |")
lines += ['', '| 语气强度0–4，越高越明显 | 上轮 | 新版 |', '|---|---:|---:|']
for tone in TONES:
    lines.append(f"| {tone} | {eq['toneMeans'][tone]['control']:.3f} | {eq['toneMeans'][tone]['patched']:.3f} |")
lines += ['', f"上游pointwise自然度：{traits['control']['naturalness_authenticity']:.3f}→{traits['patched']['naturalness_authenticity']:.3f}。助手总回复数{reply_counts}；机器报告保留每百条回复的缺陷率、双序分歧和逐项引文。", '',
          '连续语气量表与原有违规标签分别报告。量表有明确锚点，允许角色适当的解释和真实证据支持的模式；不能把简短或冷淡本身当成改善。均值是序数型模型判断的描述，不宣称人类标注校准或统计显著。', '',
          '本轮两版用同一扩展量表重新评分，因此上轮对照的违规计数不必与此前报告中的不同量表批次相同。严格说教违规依然是0→0，但培训腔连续量表上升，说明“没有明确训诫”不能代表“说得自然”。新版88次助手回复、上轮80次，暴露长度也有差异；过度解读双序共识均为2场/2次回复，每百次回复2.50→2.27，不足以证明核心残留消失。', '',
          '## EQ 残留与自然度下降原因', '',
          '1. **动机二选一换了词，机制没有变。** family_member首轮仍问“Are you more upset that I challenged you, or that you feel the family takes your generosity for granted?”；叔叔明确反对这个框架。两版同一场景都被两序判为动机强度2。此后新版补出“She did tell me afterward that it hurt”，还解释妹妹为什么笑；公开场景没有这段私下披露。用户因新“证据”改变立场，不能把这个转折当成沟通改善。两序均判重大内容问题。', '',
          '2. **关系泛化减轻，但不等于所有心理推断都消失。** parent从“别让关系成为全部生活”的长期关系判断，转成把靠近朋友解释为“independence, spontaneity, and having your support network nearby”。用户仍在可见回复里纠正独立性框架。关系泛化量表2→0，但过度解读仍各有一轮；中文MB03还出现新的整段关系价值评估。改善没有跨场景稳定迁移。', '',
          '3. **培训腔主要由对话推进方式维持。** freelancer第4轮把已接受的安排重述为双方义务和成功标准，客户随后说不要把它变成协议；该场培训腔1→2，两序均偏好上轮。chatbot第8轮又教用户问三个诊断问题，用户上一轮已接受该办法。board_member在明确说明材料要求后继续询问如何管理讨论；friend则从4次助手回复延长到8次，保持“确认—原则—问题”的节奏。不同续话可能贡献时长差异，不能认定延长完全由提示词造成，但具体重复和多余追问有原文支持。', '',
          '4. **角色不匹配也是自然度损失。** applicant新版在实际角色对话里填入[case number]、[date]等模板，而不是完成角色交流；两序均在自然度上偏好上轮，一序将紧急影响信息全部留空判为重大遗漏。该项非双序共识，仍按预设“任一序重大”门槛保留。固定CR03则相反，写得口语化却擅自承诺请客。两者说明只压风格词，不能替代事实与任务模式判断。', '',
          '5. **有真实改善，也有无法判优的部分。** adult_child两序整体偏好新版，补充了通知、权限和不确定性要求；crisis_line_volunteer两序自然度偏好新版，跟随用户的具体障碍给出备选办法，没有复现旧版后期多余筛查。chatbot保住工作要求并避开旧版“没提问就是绩效问题”的错误，但自然度两序分歧。没有因为局部改善抹去整体损失。', '',
          '**原因假设及证据边界：** 公开EQ任务每轮强调了解深层需要、性格与洞察，这会与当前密集的一条综合风格规则竞争；规则写了不做什么，却缺少角色内“当前诉求已满足就停”的具体生成示范。普通中文短脚本与英文8轮角色对话的压力差距也很大。以上是由错误形态提出的可检验假设，本轮没有做单因素消融，不能证明具体哪一条规则导致回退。', '',
          '## 完整 FollowBench', '',
          f"新版150条：HSR {follow['patched']['HSR']:.2%}，SSR {follow['patched']['SSR']:.2%}，CSL {follow['patched']['CSL']:.3f}；调用/评分错误{follow['patched']['errors']}。", '',
          f"历史P0完整150条：HSR {follow['historicalP0']['HSR']:.2%}，SSR {follow['historicalP0']['SSR']:.2%}，CSL {follow['historicalP0']['CSL']:.3f}。上一轮最终候选没有完整150条，因此不伪造与其的同源全量增减。相对历史P0，失败转通过{len(follow['gainsVsHistoricalP0'])}、通过转失败{len(follow['lossesVsHistoricalP0'])}，ID见JSON。", '',
          f"S11-L5五项约束：{follow['S11L5'].get('verdicts')}。回答开头：{follow['S11L5'].get('answer', '')[:220]}", '',
          '新增失败需区分来源：S27-L5裁判判海盗口吻未满足，同时承认该要求在最终指令中被省略；这是数据中最终指令与累计评分约束不一致，不应据此添加海盗示例。S07-L3/L4、S14-L2、S15-L1、S16-L2、S18-L1等出现指定文风/角色的拒绝前缀；这更像基础模型的风格响应行为，不能仅凭本次A/B证明由Personal规则导致。S22-L3未表现用户明确要求的热情，S23-L3/L4、S29-L3则未持续体现指定角色/文体；这些是真实任务风格遗漏，需要保留明确风格请求的优先级。复杂历史文体的边界也依赖主观裁判。以上均不改变原始分数，不把全部退步归给benchmark。', '',
          '## 固定用户续话', '',
          f"13脚本整体偏好{scripted['outcomes']['overall']}；自然度偏好{scripted['outcomes']['naturalness']}。其中9条聚焦三类残留，4条保护有证据的隐私边界、事实草稿、必要收件人澄清和虚构创作。它们来自已知残留，是开发回归证据，不是未见真实用户样本。", '',
          '| 各类3个聚焦脚本的语气均值 | 上轮 | 新版 |', '|---|---:|---:|']
for tone in TONES:
    lines.append(f"| {tone} | {focused_tones[tone]['control']:.3f} | {focused_tones[tone]['patched']:.3f} |")
lines += ['', '上表只按脚本所属类别取样，不能代表其余维度为零。以下把全部13脚本都按三个维度评分，保留跨类别缺陷。', '',
          '| 全部13脚本的语气均值 | 上轮 | 新版 |', '|---|---:|---:|']
for tone in TONES:
    lines.append(f"| {tone} | {scripted['toneMeans'][tone]['control']:.3f} | {scripted['toneMeans'][tone]['patched']:.3f} |")
lines += ['', '固定续话中的具体回退：MB03里，用户只说同学聚会未被邀请、暂不追问，新版却在第2次回复写“再决定这段关系还值不值得你主动”。两个展示顺序都判为轻微过度解读，关系泛化强度2、培训腔强度1；它属于动机类脚本，却触发了另两个维度。CR03里，新版婉拒饭局时擅自补上“到时候我请你吃饭！”，两序均判为轻微内容忠实度问题。自然口语也可能引入未授权承诺。', '',
          '固定续话中的改善：MB01新版直接表达自己反对玩笑，没有代替弟弟判断感受；两序均偏好新版。创作控制CT04两版均直接写完剧本，没有阻塞式追问，但整体偏好一序上轮、一序平局，因此不把它记为新版胜出。']
lines += ['', '## 门槛与逐场复核', '', f"预设门槛：`{json.dumps(gates, ensure_ascii=False)}`。", '',
          '| 场景 | 自然度旧→新 | 轮数旧→新 | 整体 | 自然度 |', '|---|---:|---:|---|---|']
for scene, pair in zip(scenes, eq['pairs']):
    assert scene['caseId'] == pair['caseId']
    lines.append(f"| {scene['category']} | {scene['controlTraits']['naturalness_authenticity']:.0f}→{scene['patchedTraits']['naturalness_authenticity']:.0f} | {scene['controlTurns']}→{scene['patchedTurns']} | {pair['overall']} | {pair['naturalness']} |")
lines += ['', '## 下一轮建议（本轮未追加改模或重测）', '',
          '先以本轮未通过的候选为诊断证据，保留上一轮作对照，不继续堆叠长禁止列表。下一候选应把生成顺序明确为：回应当前请求；只使用公开已知事实；只有确实缺少决定性信息时提问；对方接受安排后简短收住。涉及第三方时，区分“我反对这个玩笑”和“她私下告诉我”；不能为了让对方接受而创造证据。用户要改约措辞时，也不能额外承诺付款、请客等。', '',
          '用独立的中英角色续话开发集覆盖三种压力：被质问是否代言第三方、用户说不要写台词/不要协议化、已经接受安排后的收尾。用具体角色行动替换抽象教学结语，例如“我反对的是那个玩笑”或“好，周四见”，同时保留有证据的持续隐私侵害、明确风格创作与必要澄清。不要把本轮EQ原句直接加入训练示例再把同题改善当泛化。冻结独立验证集后再跑。', '',
          '下一轮优先做小规模同输入消融，比较仅事实边界、仅角色收尾示例与组合版，确认哪个改动改善培训腔且不牺牲内容。定稿后仍需同源完整150条FollowBench、12场EQ和双序盲评；延续本轮锚点并增加明确的事实编造/额外承诺门槛。FollowBench的数据缺陷另列审计，不用事后排题替候选过关。']
lines += ['', '## 范围与证据', '',
          'EQ使用同一钉住版本、同样12场及参数；模拟用户可能生成不同走向，不能将全部差异归因于提示词。上游pointwise裁判可见隐藏画像和内心独白，新增双序盲评只看可见对话。两次展示顺序仍来自同一裁判。所有服务/协议失败及单次补充评分保留，不用低分或分歧触发重跑。', '',
          f"最终源码：{result['sourceManifest']['commit']}；运行结束源码变化：{completion['sourceChanged']}。隔离源码158项测试、类型检查通过；共享工作区迁移测试8项通过，eval协议测试7项通过。24次EQ盲评、26次脚本盲评均无错误，无补充调用。原始证据：`{COMPARISON}`。同名JSON保留完整输入来源、量表、引文、语气分数、错误、补充评分和门槛。"]
output.with_suffix('.md').write_text('\n'.join(lines) + '\n')
print(json.dumps({'eq': eq['outcomes'], 'toneMeans': eq['toneMeans'], 'naturalnessMeans': [traits[c]['naturalness_authenticity'] for c in ['control', 'patched']],
                  'follow': {k: follow['patched'][k] for k in ['HSR', 'SSR', 'CSL', 'errors']}, 'gates': gates}, ensure_ascii=False))
