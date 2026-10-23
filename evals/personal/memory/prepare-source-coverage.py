"""Freeze 24 consumed worlds and eight new source-coverage holdouts; no old bytes change."""
import argparse
import importlib.util
import json
import hashlib
from pathlib import Path

spec=importlib.util.spec_from_file_location('episodes',Path(__file__).with_name('prepare-episodes.py'))
episodes=importlib.util.module_from_spec(spec);spec.loader.exec_module(episodes)
def data(value): return (json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode()
def sha(value):return hashlib.sha256(value).hexdigest()
def prepare(consumed,out):
    out.mkdir(parents=True,exist_ok=False);dev=out/'development';dev.mkdir();rows=[];seen=set()
    for split in ['development','validation']:
        for row in json.loads((consumed/split/'selection.json').read_text())['cases']:
            payload=(consumed/split/(row['id']+'.json')).read_bytes();case=json.loads(payload)
            if sha(payload)!=row['sha256'] or case['worldId'] in seen:raise ValueError('Changed or duplicate consumed world')
            seen.add(case['worldId']);(dev/(row['id']+'.json')).write_bytes(payload)
            rows.append(row|{'split':'development','consumedValidation':row.get('consumedValidation',False) or split=='validation','previousCohort':split})
    if len(rows)!=24:raise ValueError('Expected all 24 consumed worlds')
    (dev/'selection.json').write_bytes(data({'version':5,'protocol':'All prior 24 worlds are consumed development, copied verbatim.','cases':rows}))
    valid=out/'validation';valid.mkdir();rows=[]
    specs=[
      ('苔湾摄影合同','沈荻','秋帆会议室','10420','10960','同一供应商另一个项目栖木摄影合同报价11730元','栖木摄影合同',{'price':True,'variant':'wrong-field'}),
      ('遥岑工作坊','杜葵','春汀书院','11月8日','11月12日','同一团队12月14日参加照溪圆桌','照溪圆桌',{'variant':'wrong-subject'}),
      ('沐桥设备租赁','贺蓝','月藤会客室','12340','12890','另一个项目岚舟设备租赁报价13760元','岚舟设备租赁',{'price':True,'variant':'quoted-permission'}),
      ('Larch Forum','钟宁','森月中心','11月16日','11月20日','同一场地12月18日举行榛溪讲座','榛溪讲座',{'english':True,'variant':'reverse-import'}),
      ('烟汀说明会','徐菱','晴藤展厅','11月23日','11月26日','同一负责人12月20日组织初禾沙龙','初禾沙龙',{'variant':'negative-permission'}),
      ('砚溪制作合同','秦竹','苇月会议室','14620','15180','另一项目蒲岑制作合同报价16430元','蒲岑制作合同',{'price':True,'variant':'quoted-negative'}),
      ('星藤交流会','姚苇','月湾展馆','12月2日','12月5日','同一团队12月22日参加书岚论坛','书岚论坛',{'variant':'correction-chain'}),
      ('泉苇审稿会','乔榆','云棠书屋','12月7日','12月11日','另一场青榛研讨会12月26日举行','青榛研讨会',{'variant':'assistant-copy'}),
    ]
    for i,(subject,owner,place,old,current,other,other_subject,options) in enumerate(specs,1):
        case=episodes.world('coverage-validation',i,subject,owner,place,old,current,other,other_subject=other_subject,**options)
        case['queryTime']=case['knowledgeCutoff']=1793404800000;case['split']='validation'
        if i<=4:
            # A retained raw conversation can predate memory indexing. This is declared input,
            # not a simulated model failure or a hidden retry of a failed learning job.
            original=min(case['sessions'],key=lambda s:s['timestamp']);original['learningMode']='source-only'
            latest=max(case['sessions'],key=lambda s:s['timestamp'])
            latest['messages'][0]['content']+=f' 联系人是{owner}，地点是{place}。{other}。'
            if i==3:
                case['sessions'].append({'id':'history-0002','timestamp':episodes.T+43200000,'learningMode':'source-only','messages':[{'id':'history-0002-user','role':'user','content':f'备份原始记录：{subject}的旧报价为{old}元。','timestamp':episodes.T+43200000},{'id':'history-0002-assistant','role':'assistant','content':'已收到。','timestamp':episodes.T+43200000}]})
        if i==4:
            case['liveTurns']+=case['liveTurns'][2:4];case['gold']['episode']['authorizedIndices']=[2,4];case['gold']['episode']['ordinaryIndices']=[1,3,5]
        if i==7:
            case['sessions'][1]['messages'][0]['content']='更正：星藤交流会先改到12月3日，地点和负责人不变。'
            case['gold']['episode']['forbidden'] += [r'12月3(?!\d)(?:日|号)?',r'2026[-/]12[-/]03']
        if i==8:
            case['liveTurns'][2]='请从旧对话记录查阅泉苇审稿会更正后的日期，仅当前这次，不要重新保存。'
        case['gold']['evidenceRefs']=[m['id'] for s in case['sessions'] for m in s['messages'] if m['role']=='user']
        case['gold']['evidenceSessionIds']=[s['id'] for s in case['sessions']]
        payload=data(case);(valid/(case['id']+'.json')).write_bytes(payload)
        rows.append({k:case[k] for k in ['id','suite','category','worldId','split']}|{'sha256':sha(payload)})
    (valid/'selection.json').write_bytes(data({'version':5,'protocol':'Eight new worlds, four declared unindexed raw-source controls, one duplicate raw source, date/price cross-field permissions, repeated English read, quoted non-deletion, two corrections. Every actually scheduled learning job must complete.','cases':rows}))
    (out/'cohort-protocol.json').write_bytes(data({'version':2,'developmentWorlds':24,'validationWorlds':8,'reliability':'Zero learning exceptions, failed/running extractions and pending/errored jobs at every checkpoint. Superseded canceled jobs without errors allowed. Declared source-only histories never schedule learning and remain raw retained evidence.','full184Changed':False}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--consumed',required=True);p.add_argument('--out',required=True);a=p.parse_args();prepare(Path(a.consumed),Path(a.out))
