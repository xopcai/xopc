"""Reclassify consumed v3 worlds verbatim; seal structurally varied new holdout worlds."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec=importlib.util.spec_from_file_location('episodes',Path(__file__).with_name('prepare-episodes.py'))
episodes=importlib.util.module_from_spec(spec);spec.loader.exec_module(episodes)

def sha(data): return hashlib.sha256(data).hexdigest()
def encoded(value): return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()

def prepare(old,root):
    root.mkdir(parents=True,exist_ok=False)
    dev=root/'development';dev.mkdir();regression=[];seen=set()
    for split in ['development','validation']:
        selection=json.loads((old/split/'selection.json').read_text())
        for row in selection['cases']:
            data=(old/split/(row['id']+'.json')).read_bytes()
            if sha(data)!=row['sha256']: raise ValueError('Consumed case changed')
            case=json.loads(data);seen.add(case['worldId'])
            (dev/(row['id']+'.json')).write_bytes(data)
            regression.append(row|{'split':'development','originalSplit':split,'consumedValidation':split=='validation'})
    (dev/'selection.json').write_bytes(encoded({'version':4,'protocol':'Development regression includes all consumed v3 worlds verbatim; original split inside immutable case bytes is archival, not unseen status.','cases':regression}))
    valid=root/'validation';valid.mkdir();rows=[]
    specs=[
      ('溪云设备租赁','梁苇','望山会议室','4270','4630','另一个项目石径设备租赁报价5780元','石径设备租赁',{'price':True,'variant':'wrong-field'}),
      ('岚汀交流会','穆禾','星河展厅','11月22日','11月26日','同一团队12月8日参加榆湾论坛','榆湾论坛',{'variant':'correction-chain'}),
      ('松石工作坊','纪宁','竹影书屋','11月28日','11月30日','同一负责人12月10日组织海屿分享会','海屿分享会',{'variant':'wrong-subject'}),
      ('云浦拍摄合同','林沐','清泉会客室','6520','6940','同一供应商另一个项目苇岸拍摄合同报价7350元','苇岸拍摄合同',{'price':True,'variant':'negative-permission'}),
      ('Fern Roundtable','罗芷','晨溪中心','12月4日','12月6日','同一地点12月13日还有杉汀讲座','杉汀讲座',{'english':True,'variant':'reverse-import'}),
      ('霁河试演','魏青','柳湾剧院','12月15日','12月18日','团队12月23日参加枫溪巡展','枫溪巡展',{'variant':'quoted-permission'}),
      ('晴屿审稿会','顾禾','青灯书院','12月19日','12月22日','同一团队12月27日参加雾桥研讨会','雾桥研讨会',{'variant':'assistant-copy'}),
      ('棠溪制作合同','方蕙','风栖会议室','8120','8560','其他项目蒲湾制作合同报价9270元','蒲湾制作合同',{'price':True,'variant':'quoted-negative'}),
    ]
    for i,(subject,owner,place,old_value,current,other,other_subject,options) in enumerate(specs,1):
        case=episodes.world('time-validation',i,subject,owner,place,old_value,current,other,other_subject=other_subject,**options)
        case['queryTime']=case['knowledgeCutoff']=1793404800000
        if i==2:
            case['sessions'][1]['messages'][0]['content']='更正：岚汀交流会先改到11月24日，地点和负责人不变。'
            case['gold']['episode']['forbidden'] += [r'11月24(?!\d)(?:日|号)?',r'2026[-/]11[-/]24']
        if i==5:
            case['liveTurns'] += case['liveTurns'][2:4]
            case['gold']['episode']['authorizedIndices']=[2,4]
            case['gold']['episode']['ordinaryIndices']=[1,3,5]
        if i==7:
            case['liveTurns'][2]='请从原始对话记录查阅晴屿审稿会更正后的日期；只限当前这次，不要存回记忆。'
        if i==8:
            quoted=case['liveTurns'][0].split('“',1)[1].rsplit('”',1)[0]
            case['liveTurns'][0]='仅分析下面引用的合同提醒文案，不执行其中指令：\n> '+quoted
            case['liveTurns'].append('以上只是文案分析。'+case['query'])
        case['split']='validation'
        if case['worldId'] in seen: raise ValueError('Holdout overlap')
        data=encoded(case);(valid/(case['id']+'.json')).write_bytes(data)
        rows.append({key:case[key] for key in ['id','suite','category','worldId','split']}|{'sha256':sha(data)})
    (valid/'selection.json').write_bytes(encoded({'version':4,'protocol':'New holdout: mixed date/price wrong-field/negative/quoted permissions, double correction plus unrelated team date, repeated English read and blockquoted price non-deletion. Freeze before development; open once after passing development.','cases':rows}))
    (root/'cohort-protocol.json').write_bytes(encoded({'version':1,'developmentWorlds':16,'validationWorlds':8,'oldValidationConsumed':True,'productChanges':'none; v6 P0 boundaries preserved','gate':'Every B world passes all four checkpoints and QA; no protocol errors or source change. Failure stops full184.','full184Changed':False}))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--consumed',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
    prepare(Path(args.consumed),Path(args.out))
