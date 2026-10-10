# Synthetic, loopback-only Gateway fixture for MobileLayoutParityUITests.
# Start this server before running that UI test class; no user credentials are required.
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs
import json, time, wave, io, math, struct
now = int(time.time()*1000)
parent = '11111111-1111-4111-8111-111111111111'
child = '22222222-2222-4222-8222-222222222222'
personal = '33333333-3333-4333-8333-333333333333'
long_body = '# 移动端阅读\n\n' + '\n\n'.join(f'{i}. **工作记录**\n   - 窄屏列表应该保留足够的阅读宽度，换行不重复占用左侧缩进。\n   - 保持信息清晰。' for i in range(1, 20))
messages = [{'id':'long-ai','turnId':'turn-1','role':'assistant','content':long_body},
 {'id':'user-1','role':'user','content':'请整理移动端布局'},
 {'id':'voice-1','role':'user','content':'','attachments':[{'id':'voice','type':'audio','name':'语音','mimeType':'audio/wav','uri':'media://outbound/voice.wav','durationSeconds':3}]},
 {'id':'ai-1','turnId':'turn-1','role':'assistant','content':'## 检查结果\n\n1. **消息布局**\n   - 收紧列表缩进，换行保留阅读宽度。\n2. **交互**\n   - 长按显示用户消息操作。\n\n所有改动均已记录。'}]
row={'key':parent,'agentId':'main','name':'移动端布局检查','status':'active','updatedAt':'2026-10-09T08:00:00Z','messageCount':4}
record={'agentId':'personal','conversationId':personal,'state':'ready','displayName':'Ada','appearance':'loopi','revision':1,'preferences':{}}
model={'id':'test/model','name':'Fixture Model','provider':'test','reasoning':True,'vision':False,'thinking':{'options':['off','low','medium','high'],'initialValue':'medium'}}
outreach={'revision':1,'mode':'balanced','timezone':'Asia/Shanghai','quietStart':22,'quietEnd':8,'dailyMessages':2,'dailyModelCalls':12}
config={'model':'test/model','thinkingLevel':'medium','configVersion':1}
w=io.BytesIO()
with wave.open(w,'wb') as audio:
 audio.setparams((1,2,8000,0,'NONE','not compressed'))
 audio.writeframes(b''.join(struct.pack('<h',int(800*math.sin(2*math.pi*440*n/8000))) for n in range(24000)))
def envelope(value): return {'ok':True,'payload':value}
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_PUT(self): self.do_GET()
 def do_POST(self): self.do_GET()
 def do_PATCH(self): self.do_GET()
 def do_GET(self):
  path=urlparse(self.path).path; query=parse_qs(urlparse(self.path).query)
  length=int(self.headers.get('Content-Length','0')); body=self.rfile.read(length) if length else b''
  data=None; status=200
  if path=='/api/agents': data=envelope({'defaultId':'main','agents':[{'id':'main','name':'Main','isDefault':True},{'id':'other','name':'Research'}]})
  elif path=='/api/personal-agent': data=envelope(record)
  elif path=='/api/personal-agent/profile':
   patch=json.loads(body)
   if patch['revision']!=record['revision']: status=409;data={'ok':False,'error':'Settings changed'}
   else: record.update(patch);record['revision']+=1;data=envelope(record)
  elif path=='/api/personal-agent/proactivity':
   if body:
    patch=json.loads(body)
    if patch['revision']!=outreach['revision']: status=409;data={'ok':False,'error':'Settings changed'}
    else: outreach.update(patch);outreach['revision']+=1
   if data is None: data=envelope(outreach)
  elif path=='/api/personal-agent/avatar': data=envelope({'agentId':record['agentId']})
  elif path=='/api/voice/realtime/status': data=envelope({'tts':{'provider':'fixture','model':'tts'}})
  elif path=='/api/voice/tts-voices': data=envelope({'voices':[{'id':'fixture-voice','name':'Fixture voice'}]})
  elif path=='/api/models': data=envelope({'defaultId':'test/model','models':[model]})
  elif path=='/api/sessions':
   items=[dict(row,key='draft',name='新对话',messageCount=0),row]
   data={'items':items,'total':2,'hasMore':False,'childrenByConversationId':{parent:{'total':1,'activeCount':0,'items':[{'taskId':'task-child','title':'移动端子任务','phase':'closed','activeConversationId':child}]}}}
  elif path.endswith('/history'): data={'session':{'key':path.split('/')[3],'agentId':'main','messages':messages},'pagination':{'hasMore':False}}
  elif path.endswith('/context-summary'): data={'summary':{'conversationId':path.split('/')[3],'work':{},'sources':[],'sourcesHasMore':False,'unavailableSections':[],'environment':{'kind':'local_checkout','rootPath':'/fixture','available':True}}}
  elif path.endswith('/agent-config'):
   if body:
    config.update(json.loads(body))
   data=envelope(config)
  elif path.endswith('/clarification'): data=envelope({'clarification':None})
  elif path.endswith('/input-state'): data=envelope({'activeRunId':None,'inputs':[]})
  elif path.endswith('/run'): data=envelope({'active':child in path,'runId':'fixture-live' if child in path else None})
  elif path.endswith('/execution-detail'): data={'detail':{'turnId':query.get('turnId',['turn-1'])[0],'steps':[]}}
  elif path=='/api/home':
   data={'needsUser':[{'id':'attention','kind':'task','title':'需要验收','summary':'执行已完成，等待确认。','statusLabel':'待验收','recommendation':'查看结果后验收。','openAction':{'type':'open','label':'查看任务','href':'/tasks'}}], 'background':[{'id':'running','kind':'task','title':'进行中的工作','summary':'正在处理。'},{'id':'scheduled','kind':'scheduled','title':'明日计划','summary':'明天上午执行。'}],'backgroundCount':2}
  elif path=='/api/tasks': data={'items':[],'total':0,'hasMore':False}
  elif path=='/api/automations/metrics': data={'nextRun':{'automationId':'auto','name':'不应重复显示的计划','runAtMs':now+100000}}
  elif path=='/api/notes': data={'items':[{'id':'note-1','title':'布局检查笔记','kind':'note','status':'active','createdAt':now,'updatedAt':now,'snippet':'用于模拟器验证。'}],'total':1,'hasMore':False}
  elif path=='/api/user-model/mobile-summary': data={'profile':{'callName':'Tester','role':'工程师'},'settings':{'memoryEnabled':True,'showMemoryReferences':True,'sensitiveWritePolicy':'ask'},'counts':{'total':0,'explicit':0,'learned':0,'review':0,'workMemory':0},'goals':[],'recent':[]}
  elif 'media' in path or path.endswith('voice.wav'):
   self.send_response(200);self.send_header('Content-Type','audio/wav');self.send_header('Content-Length',str(len(w.getvalue())));self.end_headers();self.wfile.write(w.getvalue());return
  else:
   status=404;data={'ok':False,'error':{'message':'Fixture endpoint unavailable'}}
   print('unhandled', self.command,path,flush=True)
  payload=json.dumps(data,ensure_ascii=False).encode()
  self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
print('Fixture ready on localhost:18791',flush=True)
ThreadingHTTPServer(('127.0.0.1',18791),Handler).serve_forever()
