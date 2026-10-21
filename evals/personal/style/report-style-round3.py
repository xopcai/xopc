"""Retain ablation selection and independently validated final-source regressions."""
import hashlib
import json
from pathlib import Path
from style_analysis import aggregate_folder, follow_summary, DIMS, TONES, LOCAL, ROOT

P = LOCAL / 'style-round3-comparison-v1'
NEW, OLD = LOCAL / 'style-round3-full-v1', LOCAL / 'eq-style-round2-full-v1'
read = lambda p: json.loads(p.read_text())
selection = read(P / 'selection.json')
eq = aggregate_folder(P / 'judgments-eq')
validation = aggregate_folder(P / 'judgments-validation')
assert len(eq['pairs']) == 12 and len(validation['pairs']) == 8
completion = read(NEW / 'completion.json')
assert completion['exitCode'] in [0, 1] and not completion['sourceChanged']
assert read(NEW / 'manifest.json')['commit'] == selection['sourceCommit']
assert read(NEW / 'eq-summary.json')['complete']
rows, follow, follow_recoveries = {}, {}, []
for name, folder in [('control', OLD), ('patched', NEW)]:
    values = [read(p) for p in sorted((folder / 'cases').glob('FB-*.json'))]
    if name == 'patched':
        follow['patchedRaw'] = follow_summary(values, 150)
        recovery = P / 'follow-recovery'
        if recovery.exists():
            registration = read(recovery / 'registration.json')
            assert registration['sourceRun'] == str(NEW)
            assert registration['judge'] == read(NEW / 'manifest.json')['judge']
            registered = {v['caseId']: v for v in registration['candidates']}
            for index, row in enumerate(values):
                if row['caseId'] not in registered:
                    continue
                source = NEW / 'cases' / (row['caseId'] + '.json')
                assert hashlib.sha256(source.read_bytes()).hexdigest() == registered[row['caseId']]['sourceSha256']
                supplement = read(recovery / (row['caseId'] + '.json'))
                assert row.get('error') and row.get('answer') and not row.get('verdicts')
                assert supplement['judgePrompt'] == row['judgePrompt'] and supplement['candidateRegenerated'] is False
                follow_recoveries.append({'caseId': row['caseId'], 'originalError': row['error'], 'supplement': supplement})
                if not supplement.get('error'):
                    merged = {**row, **supplement}
                    merged.pop('error')
                    values[index] = merged
    rows[name] = {v['caseId']: v for v in values}
    follow[name] = follow_summary(values, 150)
    assert len(values) == 150
follow['gains'] = [k for k, v in rows['patched'].items() if v['hardSatisfied'] and not rows['control'][k]['hardSatisfied']]
follow['losses'] = [k for k, v in rows['patched'].items() if not v['hardSatisfied'] and rows['control'][k]['hardSatisfied']]
follow['creativeControl'] = rows['patched']['FB-ZH-S11-L5']
scenes = []
for item in read(OLD / 'selection.json')['eq']:
    a, b = [read(folder / 'cases' / (item['caseId'] + '.json')) for folder in [OLD, NEW]]
    assert not a.get('error') and not b.get('error')
    scenes.append({'caseId': item['caseId'], 'category': item['relationship'],
                   'controlTraits': a['traits'], 'patchedTraits': b['traits'],
                   'controlTurns': a['assistantTurns'], 'patchedTurns': b['assistantTurns']})
means = {c: sum(s[c+'Traits']['naturalness_authenticity'] for s in scenes)/12 for c in ['control', 'patched']}
exposure = {c: sum(s[c+'Turns'] for s in scenes) for c in ['control', 'patched']}
for dim in DIMS:
    for c in ['control', 'patched']:
        eq['metrics'][dim][c]['bothOrderRepliesPer100'] = 100*eq['metrics'][dim][c]['bothOrders']['replies']/exposure[c]
major_dims = ['required_content_or_boundary', 'unnecessary_question', 'premature_resolution']
new_majors = [{'suite': name, 'caseId': pair['caseId'], 'dimension': dim,
               'evidence': pair['conditions']['patched'][dim]['evidenceByOrder']}
              for name, suite in [('eq', eq), ('validation', validation)] for pair in suite['pairs'] for dim in major_dims
              if pair['conditions']['patched'][dim]['majorEitherOrder'] and not pair['conditions']['control'][dim]['majorEitherOrder']]
gates = {'all150FollowValid': follow['patched']['complete'], 'all12EQValid': read(NEW/'eq-summary.json')['complete'],
         'sourceUnchanged': not completion['sourceChanged'],
         'followHSRNonincreaseInFailures': follow['patched']['HSR'] >= follow['control']['HSR'],
         'coachingMeanDropAtLeastQuarterPoint': eq['toneMeans']['coaching_register']['control']-eq['toneMeans']['coaching_register']['patched']>=.25,
         'noNewMajorContentBoundaryOrBlocking': not new_majors}
for dim in ['overinterpretation', 'unnecessary_question', 'repeated_closing']:
    gates[dim+'Nonincrease'] = eq['metrics'][dim]['patched']['bothOrders']['conversations'] <= eq['metrics'][dim]['control']['bothOrders']['conversations']
for dim in ['overall','naturalness']:
    counts = eq['outcomes'][dim]
    gates[dim+'StableWinsAtLeastLosses'] = counts.get('patched',0)>=counts.get('control',0)
gates['passed'] = all(gates.values())
report = {'schemaVersion': 1, 'selection': selection, 'eq': eq, 'validation': validation,
          'follow': follow, 'followRecoveries': follow_recoveries, 'scenes': scenes, 'naturalnessMeans': means, 'assistantReplyCounts': exposure,
          'newMajorFailures': new_majors, 'gates': gates, 'registration': read(P/'registration.json'),
          'sourceAudit': read(P/'source-audit.json'), 'selectedChecks': read(P/'selected-checks.json'),
          'sourceManifest': read(NEW/'manifest.json'), 'sourceCompletion': completion}
out = ROOT/'docs/design/technical/personal-dialogue-style-round3-2026-10-21.json'
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
lines = ['# Personal AI 第三轮：消融选择与完整回归', '',
         f"结论：预设门槛{'通过' if gates['passed'] else '未通过'}。开发消融选中 `{selection['selected']}`，随后冻结该源完成150条FollowBench、12场EQ和独立8条固定脚本验证，没有用验证分数重新挑选候选。", '',
         '**本轮建议：保留为候选，不替换默认版本。** 明确第三方证据编造有所减少，非必要追问减少，整体和自然度稳定净胜为正；但培训腔几乎未降、重复收尾未降，过度解读增加，且有“承诺写作却未交付”的明确回退。', '',
         '测试 GPT-5.6 Sol，裁判与EQ模拟用户 GPT-6.1 Sol。全量直接对照上一轮最终候选（round2），两边均有完整150条FollowBench及12场EQ。', '',
         '## 消融与隔离', '',
         '以同一round2源码作对照，事实组仅替换事实/解释模块，表达组仅替换角色表达/收尾模块，组合组替换两者；全部保留同样的前五条规则和示例。开发集8条，独立验证集8条，中英混合；均是围绕已知错误机制构造的回归，不能代表真实用户总体。', '',
         '先按任一序重大内容问题、双序共识内容问题、培训腔均值、重复收尾、自然度净胜、整体净胜排序，平局优先表达、事实、组合。若所有组重大内容问题比对照多则保留对照。规则、脚本、排序在有效生成前固定；没有为失利重抽样。', '',
         '| 组别 | 重大内容轮数（任一序） | 内容轮数（双序） | 培训腔均值 | 重复收尾轮数（双序） | 自然度净胜 | 整体净胜 |', '|---|---:|---:|---:|---:|---:|---:|']
for n,v in selection['results'].items():
    a=v['rank'];lines.append(f'| {n} | {a[0]} | {a[1]} | {a[2]:.3f} | {a[3]} | {-a[4]} | {-a[5]} |')
lines += ['', '消融不等于修复确认：三组都在D-M1提醒关门的拟稿里加入未经提供的“已经关门”行动，两序均判轻微内容问题；事实规则没有消除这个残留。开发集的三项语气强度两边都是零，存在地板效应，不能据此宣布培训腔改善。组合版开发整体稳定0胜1负7平，自然度1胜0负6平1分歧；它是预设排序选出的相对候选，不是显著优于对照的结论。表达组有一次重复收尾，事实组自然度稳定负2场，均保留。', '']
lines += ['', f"独立验证8条：整体偏好{validation['outcomes']['overall']}，自然度{validation['outcomes']['naturalness']}。", '',
          '验证中的明确局部改善是V4等待维修单号：新版没有再要求用户收到后发来核对，整体和自然度两序均偏好新版。不过两版仍复述了已确定的等待流程；新版培训腔接近零并不表示所有重复都清除。V1的第三方代言质问两版均未编造披露，这说明该小脚本本身无法证明新版比旧版更能抵抗EQ压力。V8两版都保留明确提供的同事感受，提出尚未执行的倾听安排；一序平局、一序偏好新版，不能算稳定胜出。', '',
          '## EQ 双顺序盲评', '',
          f"整体偏好{eq['outcomes']['overall']}；自然度偏好{eq['outcomes']['naturalness']}。patched为新版，control为上一轮，discordant为交换顺序后未达一致。上游pointwise自然度{means['control']:.3f}→{means['patched']:.3f}。", '',
          '| 违规影响对话/12，双序同一助手轮交集 | 上轮 | 新版 |','|---|---:|---:|']
for dim in DIMS:lines.append(f"| {dim} | {eq['metrics'][dim]['control']['bothOrders']['conversations']} | {eq['metrics'][dim]['patched']['bothOrders']['conversations']} |")
lines += ['', '| 语气强度0–4，越低越轻 | 上轮 | 新版 |','|---|---:|---:|']
for tone in TONES:lines.append(f"| {tone} | {eq['toneMeans'][tone]['control']:.3f} | {eq['toneMeans'][tone]['patched']:.3f} |")
lines += ['',f"助手回复总数{exposure}。JSON保留每百条回复缺陷率、每序分数与证据、交并集、所有新重大错误。连续量表与严格违规分别报告，不把短或冷淡本身计为改善。", '',
          '重大内容问题：双序同轮共识1场→0场，任一序2场→0场。任一序包括旧版freelancer被一序判为编造团队反应，不能当成两序一致结论。旧版与新版本轮重新按同一量表评分，旧版标签计数不必等于上份报告；这类裁判波动不能当成代码变化。', '',
          '## 重点用例与原因分析', '',
          '1. **第三方事实：从明确编造退到了含混暗示，仍需继续修。** family_member旧版“She did tell me afterward that it hurt”被两序判重大；新版没有再断言妹妹倾诉或解释她笑的原因，整体两序偏好新版。不过新版说“I’d rather not use anything she may have said privately without her permission”，对方随后回应“keep whatever she’s told you private”。这是人工复核发现的暗示风险，本轮两序裁判没有把它标成内容违规；保留该差异，不擅改裁判分数。新版仍主动写道歉台词，对方要求别写自己的台词。freelancer也有“the comment about consultants making simple things complicated”这种未经提供的具体历史引语，被一序判轻微。本次显性证据编造减少，尚未确保所有话语都守住证据边界。', '',
          '2. **培训腔：仍由回合结构而非几个关键词维持。** freelancer新版第3轮教客户如何表达批评，对方直接说不要教自己说话；第5轮又复述“decision, cost, next step”及“press the proposal, not the profession”。这场新版培训腔两序为2/1，旧版1/1；双方各有一次双序共识重复收尾。仅写“after agreement, close”没有让模型稳定识别“对方已接受”。junior_colleague继续使用更深需要、判断等精致总结，顺序间自然度偏好不一致。', '',
          '3. **过度解读发生迁移。** parent旧版把朋友距离上升为独立性，新版避免该框架，并接上女儿关于厨房的具体幽默，整体与自然度两序均胜。与此同时，新版chatbot断言公开承认错误能“restores the team’s confidence in your judgment”，用户纠正并没有证据表明团队失去信心；friend新版说“choosing Clara’s comfort over our friendship”及“a conflict I didn’t create”，把宾客安排上升为整段友谊，并擅自确定冲突责任，两序均偏好旧版。family_member首轮动机二选一则仍在，纠正后会撤回，强度两版均2。一个场景改善不代表机制跨场景解决。', '',
          '4. **存在可保留的局部收益。** board_member新版围绕更新与时间点推进，减少旧版已得到指示后继续索取限制的两次追问，整体和自然度两序胜。applicant新版维持连续角色对话，避免旧版大量占位符，两序自然度胜；crisis_line_volunteer更贴合用户关于安静时段、短便条和不承诺执行的偏好，两序自然度胜。必要安全询问仍被保留。', '',
          '**归因限度：** 本轮的模块消融只在8条开发脚本上完成，不能据此证明完整EQ收益都由某一模块导致；开发集培训腔为零也解释了它为何筛不掉完整EQ的回合结构问题。公开EQ每轮鼓励洞察、深层需要和人格理解；当前规则仍可能被这种任务推进方式带回辅导腔，但这是待消融验证的机制假设。盲评的4场整体、5场自然度顺序分歧也很大，不宣称统计显著或泛化成功。', '',
          '## 完整 FollowBench', '',
          '| 指标 | 上轮 | 新版 |','|---|---:|---:|']
for metric in ['HSR','SSR','CSL']:
    a,b=[follow[c][metric] for c in ['control','patched']]
    lines.append(f'| {metric} | {a:.4f} | {b:.4f} |')
lines += ['', f"失败转通过{len(follow['gains'])}条，通过转失败{len(follow['losses'])}条；新版错误{follow['patched']['errors']}。S11-L5：{follow['creativeControl']['verdicts']}。", '',
          f"原始全量运行：有效评分{follow['patchedRaw']['scored']}/150、错误{follow['patchedRaw']['errors']}，HSR {follow['patchedRaw']['HSR']:.4f}；保留原始退出码{completion['exitCode']}。仅对已有回答的服务/协议失败进行一次原提示词补充评分，共{len(follow_recoveries)}条；候选回答未重新生成。上表为合并有效补充后的结果，原始错误及补充响应见JSON。", '',
          '原始分数保留所有150条，不按结果事后排除题目。上轮确认的S27-L5最终指令漏海盗口吻、历史文体判定的主观性及指定作家响应前缀问题仍是解释范围的一部分，不据此免除真实明确风格遗漏。', '',
          '真实回退需要单列：S06-L5要求叙述核物理并融合多种风格，新版只回答“可以”并描述将采用什么气质，没有实际写出叙述内容；这是承诺替代交付，不只是裁判对文体挑剔。S11-L5直接交付完整剧本，但伊丽莎白时代特有措辞和句法未过，四项YES、一项NO。S17-L4以第三人称谈达西，未持续进入所要求角色；S25-L4漏掉希腊与农民身份。这些都有实际指令依据，应保留为任务完成/角色风格风险。', '',
          '## 逐场结果与门槛', '',f'`{json.dumps(gates,ensure_ascii=False)}`', '',
          '| 场景 | 自然度旧→新 | 回复数旧→新 | 整体 | 自然度 |','|---|---:|---:|---|---|']
for s,pair in zip(scenes,eq['pairs']):
    assert s['caseId']==pair['caseId']
    lines.append(f"| {s['category']} | {s['controlTraits']['naturalness_authenticity']:.0f}→{s['patchedTraits']['naturalness_authenticity']:.0f} | {s['controlTurns']}→{s['patchedTurns']} | {pair['overall']} | {pair['naturalness']} |")
lines += ['', '## 下一步方案', '',
          '事实边界先修“说服用证据”：当对方追问第三方是否说过什么时，只有公开记录支持才能复述；否则只表明自己的立场，不以隐私保留措辞暗示掌握未给出的证言。开发回归加入含混证言、虚构过去引语、替用户写入已完成行动与额外承诺等相邻错误。', '',
          '收尾优化应围绕回合状态：区分新请求、新风险、接受安排、停止讨论。接受与停止时只作角色内回应；存在新问题时只答新问题。先用独立的英语客户/同事对话检验“对方已接受”与“用户确实想要继续建议”的最小差异，保留必要解释对照，避免一律短答。', '',
          '任务完成单独设门槛：用户说“能否写/叙述”时必须交付作品，不能只描述将如何写。将S06类型的同义请求与明确风格/角色控制加入新的开发集，不直接复制本轮EQ原句来训练。下一轮继续使用独立冻结验证及同源完整回归；保留本轮不通过结论，不再用当前结果重新挑选另一个消融版本。']
lines += ['', '## 证据与限制', '',
          '所有消融源只改reply-style、prompts迁移和迁移测试，其他src字节与round2一致；实际profile除instructions外一致。并行工作区默认风格/API改动未混入。源码与量表冻结，验证不用于再调参。开发选择受小样本、同一裁判和单次随机生成影响，不能据此推断普遍因果。EQ每轮含洞察与理解人格等公开任务要求；模拟用户续话不同，暴露长度不同。上游pointwise可见隐藏画像/内心独白，盲评仅看公开任务与可见对话；两个顺序也不是独立人类标注。', '',
          '最初四次启动因脚本ID未带P0-前缀，在生成前退出，全部保留。仅修正ID后运行v2；预检时修正旧偏好API测试参数及压缩模块以满足既有20k长度预算，均在有效生成前完成。没有按分数重跑。', '',
          f"冻结源码：{report['sourceManifest']['commit']}；结束源码变化：{completion['sourceChanged']}。消融原始证据：`{P}`；全量原始证据：`{NEW}`。选定隔离版159项个人模块测试、类型检查通过；共享工作区迁移测试9项通过；eval类型检查与7项协议测试通过。消融48次、验证16次、EQ24次盲评均无错误；Follow原始2条评分服务错误，各补一次后均有效。"]
out.with_suffix('.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'selected':selection['selected'],'eq':eq['outcomes'],'tones':eq['toneMeans'],'follow':{c:follow[c]['HSR'] for c in ['control','patched']},'gates':gates},ensure_ascii=False))
