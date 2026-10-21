"""Report the frozen fourth round without tuning on independent validation."""
import hashlib,json,re
from pathlib import Path
from style_analysis import aggregate_folder,follow_summary,DIMS,TONES,LOCAL,ROOT

P=LOCAL/'style-round4-comparison-v2'
NEW,OLD=LOCAL/'style-round4-full-v1',LOCAL/'style-round3-full-v1'
read=lambda p:json.loads(p.read_text())
selection=read(P/'selection.json')
eq,validation=[aggregate_folder(P/('judgments-'+kind)) for kind in ['eq','validation']]
assert len(eq['pairs'])==12 and len(validation['pairs'])==8
assert eq['registration']['evidenceFocus'] and validation['registration']['evidenceFocus']
assert eq['registration']['runtimeContext'] and validation['registration']['runtimeContext']
completion=read(NEW/'completion.json');manifest=read(NEW/'manifest.json')
assert not completion['sourceChanged'] and manifest['commit']==selection['sourceCommit']
validation_runs=read(P/'validation-before-full.json')
for condition in ['control','selected']:
 root=Path(validation_runs[condition+'Run'])
 assert read(root/'completion.json')['exitCode']==0 and not read(root/'completion.json')['sourceChanged']
assert read(Path(validation_runs['selectedRun'])/'manifest.json')['commit']==manifest['commit']

def load_follow(folder,recovery):
 values=[read(f) for f in sorted((folder/'cases').glob('FB-*.json'))];assert len(values)==150
 raw=follow_summary(values,150);recoveries=[]
 if recovery.exists():
  reg=read(recovery/'registration.json');assert reg['sourceRun']==str(folder) and reg['judge']==manifest['judge']
  ids={v['caseId']:v for v in reg['candidates']}
  for index,row in enumerate(values):
   if row['caseId'] not in ids:continue
   original=folder/'cases'/(row['caseId']+'.json')
   assert hashlib.sha256(original.read_bytes()).hexdigest()==ids[row['caseId']]['sourceSha256']
   extra=read(recovery/(row['caseId']+'.json'))
   assert row.get('error') and row.get('answer') and not row.get('verdicts')
   assert extra['judgePrompt']==row['judgePrompt'] and extra['candidateRegenerated'] is False and extra['judge']==reg['judge']
   recoveries.append({'caseId':row['caseId'],'originalError':row['error'],'supplement':extra})
   if not extra.get('error'):
    merged={**row,**extra};merged.pop('error');values[index]=merged
 return {'raw':raw,'supplemented':follow_summary(values,150),'recoveries':recoveries,'rows':{v['caseId']:v for v in values}}
follow={'control':load_follow(OLD,LOCAL/'style-round3-comparison-v1/follow-recovery'),
        'patched':load_follow(NEW,P/'follow-recovery')}
follow['gains']=[k for k,v in follow['patched']['rows'].items() if not v.get('error') and not follow['control']['rows'][k].get('error') and v['hardSatisfied'] and not follow['control']['rows'][k]['hardSatisfied']]
follow['losses']=[k for k,v in follow['patched']['rows'].items() if not v.get('error') and not follow['control']['rows'][k].get('error') and not v['hardSatisfied'] and follow['control']['rows'][k]['hardSatisfied']]
capture_recovery=read(P/'eq-capture-recovery.json') if (P/'eq-capture-recovery.json').exists() else None
capture_supplement=Path(capture_recovery['supplementRun']) if capture_recovery else None
capture_recoveries=[]
scenes=[]
for item in read(OLD/'selection.json')['eq']:
 a,b=[read(root/'cases'/(item['caseId']+'.json')) for root in [OLD,NEW]]
 if b.get('error') and capture_supplement:
  original=NEW/'cases'/(item['caseId']+'.json')
  replacement=capture_supplement/'cases'/(item['caseId']+'.json')
  c=read(capture_supplement/'completion.json');m=read(capture_supplement/'manifest.json')
  assert c['exitCode']==0 and not c['sourceChanged'] and m['sourceHash']==manifest['sourceHash'] and m['commit']==manifest['commit']
  capture_recoveries.append({'caseId':item['caseId'],'originalSource':str(original),'originalSha256':hashlib.sha256(original.read_bytes()).hexdigest(),'originalError':b['error'],'supplementalSource':str(replacement)})
  b=read(replacement)
 assert not a.get('error') and not b.get('error')
 scenes.append({'caseId':item['caseId'],'category':item['relationship'],'controlTraits':a['traits'],'patchedTraits':b['traits'],'controlTurns':a['assistantTurns'],'patchedTurns':b['assistantTurns']})
means={c:sum(s[c+'Traits']['naturalness_authenticity'] for s in scenes)/12 for c in ['control','patched']}
exposure={c:sum(s[c+'Turns'] for s in scenes) for c in ['control','patched']}
for dim in DIMS:
 for c in ['control','patched']:eq['metrics'][dim][c]['bothOrderRepliesPer100']=100*eq['metrics'][dim][c]['bothOrders']['replies']/exposure[c]
major_dims=['required_content_or_boundary','unnecessary_question','premature_resolution']
new_majors=[{'suite':name,'caseId':row['caseId'],'dimension':dim,'evidence':row['conditions']['patched'][dim]['evidenceByOrder']}
            for name,suite in [('eq',eq),('validation',validation)] for row in suite['pairs'] for dim in major_dims
            if row['conditions']['patched'][dim]['majorEitherOrder'] and not row['conditions']['control'][dim]['majorEitherOrder']]
gates={'all150FollowValid':follow['patched']['supplemented']['complete'],'all12EQValid':len(scenes)==12,'sourceUnchanged':not completion['sourceChanged'],
       'followHSRNondecrease':follow['patched']['supplemented']['HSR']>=follow['control']['supplemented']['HSR'],
       'coachingMeanDropAtLeastQuarterPoint':eq['toneMeans']['coaching_register']['control']-eq['toneMeans']['coaching_register']['patched']>=.25,
       'noNewMajorContentBoundaryOrBlocking':not new_majors}
for tone in ['motive_menu','relationship_generalization']:gates[tone+'Nonincrease']=eq['toneMeans'][tone]['patched']<=eq['toneMeans'][tone]['control']
for dim in ['overinterpretation','unnecessary_question','repeated_closing']:gates[dim+'Nonincrease']=eq['metrics'][dim]['patched']['bothOrders']['conversations']<=eq['metrics'][dim]['control']['bothOrders']['conversations']
for dim in ['required_content_or_boundary','overinterpretation','repeated_closing']:gates['validation_'+dim+'Nonincrease']=validation['metrics'][dim]['patched']['bothOrders']['conversations']<=validation['metrics'][dim]['control']['bothOrders']['conversations']
for metric in ['overall','naturalness']:
 counts=eq['outcomes'][metric];gates[metric+'StableWinsAtLeastLosses']=counts.get('patched',0)>=counts.get('control',0)
gates['passed']=all(gates.values())
checks=read(P/'selected-checks.json');match=re.search(r'Tests\s+(\d+) passed',(P/'selected-tests.log').read_text());checks['personalTestsPassed']=int(match[1]) if match else None
recovered_ids={r['caseId'] for r in capture_recoveries}
common_pairs=[p for p in eq['pairs'] if p['caseId'] not in recovered_ids]
common_summary={'conversations':len(common_pairs),'outcomes':{dim:{label:sum(p[dim]==label for p in common_pairs) for label in ['patched','control','tie','discordant']} for dim in ['overall','naturalness']},'toneMeans':{tone:{c:sum(p['tones'][c][tone]['mean'] for p in common_pairs)/len(common_pairs) for c in ['control','patched']} for tone in TONES}}
common_summary['metrics']={dim:{c:{rule:{'conversations':sum(bool(p['conditions'][c][dim][rule]) for p in common_pairs),'replies':sum(len(p['conditions'][c][dim][rule]) for p in common_pairs)} for rule in ['bothOrders','eitherOrder','majorEitherOrder']} for c in ['control','patched']} for dim in DIMS}
residual_analysis=(P/'residual-analysis-draft.md').read_text()
result={'schemaVersion':1,'selection':selection,'eq':eq,'validation':validation,'follow':follow,'scenes':scenes,'naturalnessMeans':means,'assistantReplyCounts':exposure,'newMajorFailures':new_majors,'gates':gates,'registration':read(P/'registration.json'),'sourceManifest':manifest,'sourceCompletion':completion,'selectedChecks':checks,'validationBeforeFull':read(P/'validation-before-full.json'),'eqCaptureRecoveries':capture_recoveries,'eqOriginalSummary':read(NEW/'eq-summary.json'),'eqCommonUnrestartedSubset':common_summary}
result['residualAnalysis']=residual_analysis
result['recommendation']='Keep round3 as the main comparison and deployment reference; retain round4 as an experimental failed candidate. Do not adopt based on lower coaching mean or higher Follow soft score.' if not gates['passed'] else 'All preregistered gates passed; assess the listed limitations before adoption.'
out=ROOT/'docs/design/technical/personal-dialogue-style-round4-2026-10-21.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
lines=['# Personal AI 第四轮：事实暗示、培训腔与过度解读', '',
       f"结论：预设门槛{'通过' if gates['passed'] else '未通过，不建议替换上一轮风格'}；消融选中`{selection['selected']}`。先完成开发消融和独立验证，再由同一冻结源跑完整150条FollowBench及12场EQ，没有根据验证/全量结果改选候选。实验源码及补丁保留供复查，未提交本轮主仓库改动。", '',
       '测试GPT-5.6 Sol，裁判和EQ模拟用户GPT-6.1 Sol。直接对照上一轮round3最终组合候选；前轮的两条原答案补评分也按原证据合并，保留原始服务失败。', '',
       '## 消融设计与选择', '',
       '事实模块：规则及两个事实示例，处理不明证言、隐私保留暗示、过去引语/行动、可能影响与关系泛化。表达模块：规则及两个角色收尾/新问题示例，明确交付作品、按请求给建议、接受后停止复述。三组保留其余五条规则和所有其他src文件。此处是模块消融，不声称拆出了规则和示例各自的因果效果。', '',
       '10条开发脚本、8条独立验证脚本均在有效生成前固定。选择优先事实错误、过度解读，再比较语气、收尾与稳定偏好。验证不能用于换版本。脚本是围绕残留机制构造的回归，非真实用户总体样本。', '',
       '| 组别 | 重大内容轮数（任一序） | 内容轮数（双序） | 过度解读轮数（双序） | 动机+关系均值 | 培训腔 | 重复收尾轮数 | 多余追问轮数 | 自然度净胜 | 整体净胜 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for n,v in selection['results'].items():
 a=v['rank'];lines.append(f'| {n} | {a[0]} | {a[1]} | {a[2]} | {a[3]:.3f} | {a[4]:.3f} | {a[5]} | {a[6]} | {-a[7]} | {-a[8]} |')
lines+=['', '更正后事实组整体与自然度均为1胜0负9平，胜在D-F1更直接表达自己的异议，较少解释对方笑容可能掩盖受伤；旧版的保留性猜测并未被判为具体违规。两版多数开发脚本的语气分均为零，存在地板效应，不能把这个选择当成培训腔或事实暗示普遍消失的证明。组合组有轻微培训式收尾，表达组未显示稳定自然度收益，因此仍按预设排序选择事实组；并未因为偏好某个模块而改动排序。', '']
lines+=['',f"独立验证：整体{validation['outcomes']['overall']}；自然度{validation['outcomes']['naturalness']}。逐维错误和所有原文证据保留在JSON。", '',
        '独立验证没有显示稳定改善：V-O1新版未像旧版一样在桌面提醒里擅加使用计划，整体两序胜；V-S2新版在回答准备问题后追加明早确认安排，与原有今晚通知的约定衔接较弱，两序整体与自然度负。V-C3的两句格式判定存在顺序分歧，不计稳定胜。三项语气均值两版均零。验证结束后没有改源或换候选，继续量化其完整表现。', '',
        '## 运行时间上下文的评估修正', '',
        '原v1盲评没看到候选实际收到的入站时间戳，将D-S2中“周五（10月23日）”判为编造。保留的user_message回执证明两版都能看到2026-10-21（星期三）的时间戳，10月23日确为随后星期五。这一损失属于裁判输入缺失，不应当作产品事实错误，也不能用它制造新版收益。', '',
        '在完整回归启动前停止原流程，保留v1全部捕获、判断和原选型。候选源码、脚本与排序均未调整，复用原回答，给全部三组统一加入真实可见时间戳后进行v2重评，再完成独立验证和完整回归。校验每个时间戳来自对应历史回执，每次左右交换同步映射，且数量与助手回复数一致。无隐藏画像或内心独白混入。v1与v2不混合取分。一次SQLite启动锁在裁判请求前发生，增加读取等待后只重启未发出评分的组，已完成调用不重复。', '',
        '## EQ 双顺序盲评', '',f"整体{eq['outcomes']['overall']}；自然度{eq['outcomes']['naturalness']}。patched为新版、control为上一轮、discordant为两个顺序不一致。上游pointwise自然度{means['control']:.3f}→{means['patched']:.3f}。", '',
        '| 双序同一助手轮交集：影响对话/12 | 上轮 | 新版 |','|---|---:|---:|']
for dim in DIMS:lines.append(f"| {dim} | {eq['metrics'][dim]['control']['bothOrders']['conversations']} | {eq['metrics'][dim]['patched']['bothOrders']['conversations']} |")
lines+=['','| 语气强度0–4 | 上轮 | 新版 |','|---|---:|---:|']
for tone in TONES:lines.append(f"| {tone} | {eq['toneMeans'][tone]['control']:.3f} | {eq['toneMeans'][tone]['patched']:.3f} |")
lines+=['',f"助手回复总数{exposure}；机器报告保留每百条回复缺陷率、交并集、严重度和每序证据。正向语气分不自动等于违规，不能用短或冷淡本身证明改善。", '',
        '本轮新增evidence-focus澄清：用于支持争议判断、却未有公开依据的私下证言/来源暗示属于误导性证据；一般隐私原则或没有暗示事件发生的明确假设不自动违规。两版用同一新增澄清重评，不沿用上一轮计数，不调整0–4锚点。', '',
        '## 完整 FollowBench', '', '| 指标（含有效同输入补分） | 上轮 | 新版 |','|---|---:|---:|']
for metric in ['HSR','SSR','CSL']:lines.append(f"| {metric} | {follow['control']['supplemented'][metric]:.4f} | {follow['patched']['supplemented'][metric]:.4f} |")
lines+=['',f"失败转通过{len(follow['gains'])}、通过转失败{len(follow['losses'])}；仅在两边均有效评分的条目上计算。新版原始有效{follow['patched']['raw']['scored']}/150、原始错误{follow['patched']['raw']['errors']}，单次原答案补分{len(follow['patched']['recoveries'])}条；原始退出码{completion['exitCode']}，合并后有效{follow['patched']['supplemented']['scored']}/150。", '',
        '评分干扰与产品问题分开记录：S01-L2最终指令把老圣人换成侦探，裁判却仍累计要求老圣人风格，本轮据此判首项NO，这是约束继承歧义。S05-L4明确同时要求狄更斯氛围和海盗暗示，新版满足后者，却主要以一句伦敦煤烟点缀前者，属于可解释的混合风格执行不足。两类条目均保留在150条原始总分中，不事后筛除。', '',
        '新增失分还包含可见的产品行为：S07-L3先说不能直接仿写，再交付通用特征文章，裁判据前置拒绝判作者风格NO；S28-L5要求雨果式身份/文风，新版信末却签Ada，是助手人格混入作品。S13-L4、S27-L5则因时代氛围过于泛化失分。后两类风格强度有主观性，但签名串角色和不必要的元说明值得作为独立保护案例。单次生成与评分不能证明这些差异由本轮事实规则因果导致。', '',
        'S06-L5与S11-L5是事先标出的任务完成/创作保护案例，单独检查回答是否交付和具体风格遗漏，不为提升总分而事后排题。', '']
for cid in ['FB-ZH-S06-L5','FB-ZH-S11-L5']:
 row=follow['patched']['rows'][cid];lines.append(f"- {cid}：{row.get('verdicts')}；回答开头：{row.get('answer','')[:160]}")
lines+=['','## 门槛与逐场结果','',f'`{json.dumps(gates,ensure_ascii=False)}`','', '| 场景 | 自然度旧→新 | 回复数旧→新 | 整体 | 自然度 |','|---|---:|---:|---|---|']
for s,pair in zip(scenes,eq['pairs']):
 assert s['caseId']==pair['caseId'];lines.append(f"| {s['category']} | {s['controlTraits']['naturalness_authenticity']:.0f}→{s['patchedTraits']['naturalness_authenticity']:.0f} | {s['controlTurns']}→{s['patchedTurns']} | {pair['overall']} | {pair['naturalness']} |")
if capture_recoveries:
 lines+=['','## EQ 服务失败与补充队列','',
         f"原始EQ完成{read(NEW/'eq-summary.json')['scored']}/12，有效均值保留在JSON的eqOriginalSummary。补充队列恢复{len(capture_recoveries)}场后得到上述12场对比。失败来自模拟用户服务overload，未形成有效评分；原捕获、失败轮次和源码哈希均保留。原预案的candidate transport表述在恢复前明确扩展到未评分的模拟用户传输失败，没有按分数选重跑。", '',
         '恢复使用同一冻结代码和模型完整重启一场，并非相同前缀续跑；因此该场的续话和暴露长度会变化。原批次全部结束后才串行恢复，未改变其并发条件。', '',
         f"排除恢复场景的共同未重启子集（{common_summary['conversations']}场）：整体{common_summary['outcomes']['overall']}，自然度{common_summary['outcomes']['naturalness']}；语气均值{common_summary['toneMeans']}。这是敏感性分析，不代替预设完整队列。"]
lines+=['',*residual_analysis.splitlines(),'','## 下一轮调度','',
        '本轮运行中收到并行调度建议后，保持当前调度不变。下一轮先用固定小批次试跑独立的生成4、裁判4并发池，记录吞吐、延迟和overload比例；不同EQ对话可并行3段，同一段逐轮执行。正反顺序盲评各自排入裁判池，FollowBench每条生成完成即可送评，冻结候选后的FollowBench与EQ可同时运行。', '',
        '每条用例隔离会话和状态，按用例ID保存、汇总；模型、配置和候选代码固定。遇到限流或overload降低相应并发，只补调失败请求，保留原始失败和重试记录。消融选型→独立验证→完整回归的阶段依赖保留，验证结果不参与选型；实际提速以小批试跑测量为准。', '',
        '## 范围与证据','',
        '源码从round3隔离源派生，仅reply-style、prompts迁移和迁移测试三个src文件变化；并行工作区默认风格/API/UI改动未混入。候选在独立验证前已冻结，独立验证完成后才启动完整回归。服务/协议失败仅允许一次单独保留的同输入裁判补调，不重新生成有效回答，不对低分或分歧补调。', '',
        '单次小样本、同一模型裁判和两个相关展示顺序不能证明统计显著。EQ角色任务含洞察与深层需要的要求，续话与暴露长度可能不同；上游pointwise能看隐藏画像及内心独白，盲评仅看公开任务和可见对话。开发及验证均来自已知机制，不能视为未见真实用户验证。', '',
        f"冻结源码{manifest['commit']}，结束源码变化{completion['sourceChanged']}。个人模块{checks['personalTestsPassed']}项测试及类型检查通过；原始证据`{P}`，完整运行`{NEW}`；同名JSON包含消融选择、重评分、服务失败/补分、所有引文和门槛。"]
out.with_suffix('.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'selected':selection['selected'],'eq':eq['outcomes'],'tones':eq['toneMeans'],'follow':{c:follow[c]['supplemented']['HSR'] for c in ['control','patched']},'gates':gates},ensure_ascii=False))
