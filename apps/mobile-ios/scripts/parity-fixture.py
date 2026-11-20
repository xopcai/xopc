# Synthetic, loopback-only Gateway fixture for MobileLayoutParityUITests.
# Start this server before running that UI test class; no user credentials are required.
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import base64, json, time, wave, io, math, re, struct, sys
public_assets = Path(__file__).resolve().parents[3] / 'web/public'
capability_brands = {
 '/channel-icons/telegram.svg': (public_assets / 'channel-icons/telegram.svg').read_bytes(),
 '/connector-icons/gmail.svg': (public_assets / 'connector-icons/gmail.svg').read_bytes(),
}
capability_plugin_icon = 'data:image/svg+xml;base64,' + base64.b64encode(
 (public_assets / 'channel-icons/feishu.svg').read_bytes()).decode()
now = int(time.time()*1000)
parent = '11111111-1111-4111-8111-111111111111'
child = '22222222-2222-4222-8222-222222222222'
personal = '33333333-3333-4333-8333-333333333333'
schedule_chat = '44444444-4444-4444-8444-444444444444'
music_job = {'id':'fixture-song','title':'模拟器背景音乐','lyrics':'用于校验歌词和跨页播放。','state':'completed','createdAt':1,'durationMs':30000}
older_music_job = {'id':'fixture-older-song','title':'历史歌曲验收','state':'completed','createdAt':0,'durationMs':30000}
music_reply = {'id':'fixture-music-reply','role':'assistant','content':'','generatedMediaIds':[music_job['id']]}
live_music_state = None
device_file_allowed = False
space_id = '55555555-5555-4555-8555-555555555555'
space_version = {'id':'66666666-6666-4666-8666-666666666666','ordinal':2,'fileName':'验收.txt',
 'mimeType':'text/plain','sizeBytes':20,'createdAt':now,'indexStatus':'ready'}
space_origin = {'kind':'chat','versionId':space_version['id'],'conversationId':parent,'label':'移动端布局检查','available':True}
older_space_version = dict(space_version,id='77777777-7777-4777-8777-777777777777',ordinal=1,createdAt=now-86400000)
older_space_origin = dict(space_origin, versionId=older_space_version['id'])
def space_seed():
 return {'id':space_id,'title':'资料库验收','kind':'document','favorite':False,'trashedAt':None,
  'updatedAt':now,'revision':1,'currentVersion':space_version,'origin':space_origin,
  'versions':[space_version,older_space_version],'origins':[space_origin,older_space_origin]}
space_item = space_seed()
goals = [
 {'id':'fixture-ongoing','title':'跟进移动端验收','desiredOutcome':'完成手势回归','status':'active','isPrimary':True},
 {'id':'fixture-achieved','title':'整理发布记录','desiredOutcome':'归档本次发布','status':'achieved'}
]
work_memory = [
 {'id':'fixture-work-decision','kind':'decision','scope':{'type':'project'},'status':'active','updatedAt':now,
  'content':'移动端项目决定：验收须覆盖首屏布局。\n同时检查搜索和记录详情。\n验证返回路径。\n保留分页后的滚动位置。'},
 {'id':'fixture-work-lesson','kind':'task_lesson','scope':{'type':'global'},'status':'active','updatedAt':now-1,
  'content':'验收经验：先使用独立数据。'}
]
shares = [
 {'id':f'fixture-share-{kind}','kind':kind,'fileName':name,'shareUrl':None if revoked else f'https://example.test/s/{kind}',
  'createdAt':'2026-10-05T09:00:00.000Z','expiresAt':'2026-10-06T09:00:00.000Z','expired':expired,'revoked':revoked}
 for kind,name,expired,revoked in [
  ('session','已过期的对话链接',True,False), ('note','已撤销的笔记链接',False,True)
 ]
]
long_body = '# 移动端阅读\n\n' + '\n\n'.join(f'{i}. **工作记录**\n   - 窄屏列表应该保留足够的阅读宽度，换行不重复占用左侧缩进。\n   - 保持信息清晰。' for i in range(1, 20))
messages = [{'id':f'history-{i}','role':'user','content':f'移动端回归检查记录 {i}'} for i in range(12)] + [
 {'id':'long-ai','turnId':'turn-1','role':'assistant','content':long_body},
 {'id':'user-1','role':'user','content':'请整理移动端布局'},
 {'id':'voice-1','role':'user','content':'','attachments':[{'id':'voice','type':'audio','name':'语音','mimeType':'audio/wav','uri':'media://outbound/voice.wav','durationSeconds':3}]},
 {'id':'ai-1','turnId':'turn-1','role':'assistant','content':'## 检查结果\n\n1. **消息布局**\n   - 收紧列表缩进，换行保留阅读宽度。\n2. **交互**\n   - 长按显示用户消息操作。\n\n所有改动均已记录。'}]
messages[-1]['deliveries'] = [{'operation':'created','primary':{'kind':'task','id':'task-header','title':'任务顶部栏检查','capabilities':['open']}}]
keyboard_messages = [{'id':'keyboard-user','role':'user','content':'Explain the result.'},
 {'id':'keyboard-answer','role':'assistant','content':'\n\n'.join(f'Paragraph {i}: a long answer spanning several screens.' for i in range(40))}]
bubble_messages = [{'id':'bubble-user','role':'user','content':'请只回复 OK。'},
 {'id':'bubble-short','role':'assistant','content':'OK'},
 {'id':'bubble-code','role':'assistant','content':'```sh\necho OK\n```'}]
row={'key':parent,'agentId':'main','name':'移动端布局检查','status':'active','updatedAt':'2026-10-09T08:00:00Z','messageCount':len(messages)}
record={'agentId':'personal','conversationId':personal,'state':'ready','displayName':'Ada','appearance':'loopi','revision':1,'preferences':{},'voiceCallPreferences':{'openingGreetingEnabled':True}}
model={'id':'test/model','name':'Fixture Model','provider':'test','reasoning':True,'vision':False,'thinking':{'mode':'levels','options':['off','low','medium','high'],'initialValue':'medium'}}
outreach={'revision':1,'mode':'balanced','timezone':'Asia/Shanghai','quietStart':22,'quietEnd':8,'dailyMessages':2,'dailyModelCalls':12}
config={'model':'test/model','thinkingLevel':'medium','configVersion':1}
personal_config=dict(config)
second_model=dict(model,id='test/model-two',name='Second Fixture Model')
project={'id':'fixture-project','name':'资料测试项目','status':'active','updatedAt':now}
automation={'id':'fixture-automation','name':'每天整理纪要','enabled':True,'createdAtMs':now,'updatedAtMs':now,
            'trigger':{'kind':'schedule','schedule':{'kind':'cron','expr':'0 9 * * 1','tz':'Asia/Shanghai'}},
            'action':{'kind':'agent','instruction':'整理最近纪要'}}
automation_run={'id':'fixture-automation-run','automationId':automation['id'],'automationName':automation['name'],
                'status':'succeeded','summary':'已整理最近纪要。','createdAtMs':now}
task={'id':'task-header','version':1,'title':'任务顶部栏检查','body':'验证任务对话入口','phase':'ready','delegateAgentId':'main','createdAt':now,'updatedAt':now}
file_fixture = {'id':'fixture-file','spaceId':'workspace','name':'版本验收.txt','relativePath':'版本验收.txt',
                'parentPath':'','kind':'file','mimeType':'text/plain','size':20,'modifiedAt':now,
                'revision':'fixture-revision','capabilities':['preview','save_version']}
version_attempts = set()
# An independently decodable 72 ms MP3 frame of silence, repeated to match the Gateway's audio/mpeg response.
music_bytes = base64.b64decode(
 '/+MYxAAAAANIAAAAAExBTUUzLjEwMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
) * 417
space_music_id = '88888888-8888-4888-8888-888888888888'
space_music_version = dict(space_version, id='99999999-9999-4999-8999-999999999999', ordinal=1,
 fileName='音乐验收.mp3', mimeType='audio/mpeg', sizeBytes=len(music_bytes))
space_music_origin = dict(space_origin, versionId=space_music_version['id'], conversationId=personal, label='Ada')
space_music_summary = dict(space_seed(), id=space_music_id, title=music_job['title'], kind='audio',
 currentVersion=space_music_version, origin=space_music_origin, versions=[], origins=[])
space_music_detail_version = dict(space_music_version, music={'id':music_job['id'], 'conversationId':personal,
 'lyrics':music_job['lyrics'], 'durationMs':music_job['durationMs']})
w=io.BytesIO()
with wave.open(w,'wb') as audio:
 audio.setparams((1,2,8000,0,'NONE','not compressed'))
 audio.writeframes(b''.join(struct.pack('<h',int(800*math.sin(2*math.pi*440*n/8000))) for n in range(24000)))
def envelope(value): return {'ok':True,'payload':value}
capability_skill_enabled = True
model_choices = [dict(ref=item['id'], name=item['name'], provider='Fixture Provider') for item in [model, second_model]]
global_model = model_choices[0]['ref']
global_model_revision = 1
def global_model_payload():
 current = next(item for item in model_choices if item['ref'] == global_model)
 return envelope({'revision':str(global_model_revision),
  'routing':[dict(key='chat',pool='chat',ref=current['ref'],name=current['name']),
   dict(key='speech',pool='speech',ref='fixture/tts',name='Fixture Speech')],
  'tasks':[dict(key='coding',pool='chat',ref=None,name=None,inherited=True,allowInherit=True)],
  'fallbacks':[], 'pools':{'chat':model_choices,
   'speech':[dict(ref='fixture/tts',name='Fixture Speech',provider='Fixture')]}})
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_PUT(self): self.do_GET()
 def do_POST(self): self.do_GET()
 def do_HEAD(self): self.do_GET()
 def send_music(self):
  start, end = 0, len(music_bytes)-1
  requested = self.headers.get('Range')
  if requested:
   matched = re.fullmatch(r'bytes=(\d+)-(\d*)', requested)
   if not matched or int(matched[1]) > end:
    self.send_response(416); self.send_header('Content-Range',f'bytes */{len(music_bytes)}'); self.end_headers(); return
   start = int(matched[1])
   end = min(end, int(matched[2])) if matched[2] else end
  payload = music_bytes[start:end+1]
  self.send_response(206 if requested else 200)
  if requested: self.send_header('Content-Range',f'bytes {start}-{end}/{len(music_bytes)}')
  self.send_header('Accept-Ranges','bytes'); self.send_header('Content-Type','audio/mpeg')
  self.send_header('Content-Length',str(len(payload))); self.end_headers()
  if self.command != 'HEAD':
   try: self.wfile.write(payload)
   except (BrokenPipeError, ConnectionResetError): pass
 def do_PATCH(self): self.do_GET()
 def do_DELETE(self): self.do_GET()
 def do_GET(self):
  global live_music_state, space_item, capability_skill_enabled, global_model, global_model_revision, device_file_allowed
  path=urlparse(self.path).path; query=parse_qs(urlparse(self.path).query)
  keyboard_fixture = path.startswith('/keyboard/')
  suggestion_fixture = path.startswith('/next-turn/')
  bubble_fixture = path.startswith('/bubble-width/')
  sidebar_fixture = path.startswith('/sidebar-pagination/')
  music_fixture = path.startswith('/music/')
  slow_capabilities = path.startswith('/slow-capabilities/')
  live_music_fixture = path.startswith('/music-live/')
  device_connections = path.startswith('/device-connections/')
  device_capabilities = path.startswith('/device-capability-access/')
  if device_capabilities: path = path.removeprefix('/device-capability-access')
  if device_connections: path = path.removeprefix('/device-connections')
  if keyboard_fixture: path = path.removeprefix('/keyboard')
  if suggestion_fixture: path = path.removeprefix('/next-turn')
  if bubble_fixture: path = path.removeprefix('/bubble-width')
  if sidebar_fixture: path = path.removeprefix('/sidebar-pagination')
  if music_fixture: path = path.removeprefix('/music')
  if slow_capabilities: path = path.removeprefix('/slow-capabilities')
  if live_music_fixture: path = path.removeprefix('/music-live')
  length=int(self.headers.get('Content-Length','0')); body=self.rfile.read(length) if length else b''
  data=None; status=200
  if path=='/fixture/space-reset' and self.command=='POST':
   space_item=space_seed(); data={'ok':True}
  elif path=='/api/spaces/items' and self.command=='GET':
   view=query.get('view',['all'])[0]; kind=query.get('kind',[''])[0]; q=query.get('q',[''])[0]
   item=space_item
   visible=item and (item['trashedAt'] is not None)==(view=='trash') and (view!='favorites' or item['favorite'])
   matches=visible and (not kind or item['kind']==kind) and (not q or q in item['title'] or q=='正文')
   data={'items':[dict(item,hit={'text':'正文中的搜索命中','locator':{'line':2}}) if q=='正文' else item] if matches else []}
   if music_fixture and view=='all' and kind in ('','audio') and q in space_music_summary['title']:
    data['items'].append(space_music_summary)
  elif path=='/api/spaces/items/'+space_music_id and music_fixture:
   data=dict(space_music_summary,currentVersion=space_music_detail_version,versions=[space_music_detail_version],origins=[space_music_origin])
  elif path==f"/api/spaces/items/{space_music_id}/versions/{space_music_version['id']}/content" and music_fixture:
   self.send_music(); return
  elif path.startswith('/api/spaces/items/'+space_id):
   action=path.removeprefix('/api/spaces/items/'+space_id).strip('/')
   if not space_item: status=404; data={'error':'Item not found'}
   elif action.startswith('versions/') and action.endswith('/content') and self.command=='GET':
    payload=b'Library version one' if older_space_version['id'] in action else b'Library version two'
    self.send_response(200);self.send_header('Content-Type','text/plain');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
   elif self.command=='GET' and not action: data=space_item
   else:
    mutation=json.loads(body)
    if mutation.pop('revision',None)!=space_item['revision']: status=409; data={'error':'Conflict'}
    elif self.command=='PATCH' and not action:
     space_item=dict(space_item,**mutation); space_item['revision']+=1; data=space_item
    elif self.command=='DELETE' and not action:
     space_item=dict(space_item,trashedAt=now,revision=space_item['revision']+1); data={'ok':True}
    elif action=='restore':
     space_item=dict(space_item,trashedAt=None,revision=space_item['revision']+1); data={'ok':True}
    elif action=='purge' and space_item['trashedAt']:
     space_item=None; data={'ok':True}
    else: status=400; data={'error':'Invalid operation'}
  elif path=='/api/agents': data=envelope({'defaultId':'main','agents':[{'id':'main','name':'Main','isDefault':True},{'id':'other','name':'Research'},{'id':'coder','name':'Coder','description':'Software development, debugging, refactoring, and tests.'}]})
  elif path=='/api/capabilities/mobile-actions/panel/skills' and query.get('id')==['marketplace:search']:
   request=json.loads(body) if body else {}
   action=request.get('action')
   search=request.get('values',{}).get('query','')
   data=envelope({
    'fields':[{'id':'query','label':'技能名称或关键词','type':'text','value':search,'hint':'例如：会议纪要、PDF'}],
    'actions':[{'id':'search','label':'搜索'}],
    **({'message':'技能已安装','chatPrompt':'/skill:meeting-summary '} if action=='install:sample' else {}),
    **({'results':[{'id':'sample','name':'Meeting Summary','source':'技能市场','summary':'整理会议纪要与待办',
                    'iconUrl':capability_plugin_icon,
                    'action':{'id':'install:sample','label':'安装','confirmation':'Meeting Summary'}}]} if action=='search' else {}),
   })
  elif path=='/api/capabilities/mobile-actions/panel/skills' and query.get('id')==['meeting-skill']:
   if self.command=='POST':
    capability_skill_enabled=json.loads(body)['values']['enabled']=='true'
   data=envelope({'fields':[{'id':'enabled','label':'启用技能','type':'toggle',
                            'value':str(capability_skill_enabled).lower()}],
                  'actions':[{'id':'save','label':'保存配置'}],
                  **({'chatPrompt':'/skill:meeting-skill '} if capability_skill_enabled else {})})
  elif path=='/api/capabilities/mobile-actions/panel/plugins':
   request=json.loads(body) if body else {}
   if request.get('action')=='start':
    data=envelope({'message':'正在完成设置…','pollAction':'refresh','revision':1})
   elif request.get('action')=='refresh':
    data=envelope({'message':'已启用','chatPrompt':'请使用「Meeting Plugin」帮我：','actions':[{'id':'disable','label':'停用插件','advanced':True}]})
   else:
    data=envelope({'actions':[{'id':'start','label':'启用插件'}]})
  elif path=='/api/capabilities/mobile-actions/panel/connections':
   if query.get('id')==['mcp:setup']:
    request=json.loads(body) if body else {}
    action=request.get('action')
    values=request.get('values',{})
    try:
     pasted_config=json.loads(values.get('mcp-json','{}'))
    except ValueError:
     pasted_config={}
    checked={'flow':'mobile-mcp-fixture','revision':2,'headline':'example.com','subtitle':'https://example.com/mcp',
             'message':'连接检查通过 · 发现 1 个工具','tone':'success',
             'actions':[{'id':'save','label':'添加连接'},{'id':'edit','label':'返回配置'}]}
    if action=='save' and request.get('flow')==checked['flow'] and request.get('revision')==2:
     data=envelope({'message':'连接已添加','headline':'example.com','tone':'success',
                    'actions':[{'id':'done','label':'完成','dismiss':True}]})
    elif action=='review-command' and values.get('command')=='node':
     data=envelope({'flow':'mobile-mcp-fixture','revision':1,'headline':'node',
                    'message':'程序在 Gateway 主机运行','reviewText':'["node"]\n工作目录  /fixtures',
                    'actions':[{'id':'confirm-check','label':'运行并检查'},{'id':'edit','label':'返回配置'}]})
    elif action=='confirm-check' and request.get('revision')==1:
     data=envelope(checked)
    elif action=='create' and values.get('url')=='https://example.com/mcp':
     data=envelope(checked)
    elif action=='select' and request.get('revision')==1:
     data=envelope(checked)
    elif action=='preview' and isinstance(pasted_config,dict) and pasted_config.get('url')=='https://example.com/mcp':
     data=envelope({'flow':'mobile-mcp-fixture','revision':1,'headline':'选择服务','message':'每次添加一个服务。',
                    'fields':[{'id':'selection','label':'服务','type':'select','value':'0',
                               'options':[{'id':'0','label':'example.com'}]}],
                    'actions':[{'id':'select','label':'检查所选连接'},{'id':'edit','label':'返回配置'}]})
    else:
     link={'field':'mcp-mode','value':'link'}
     pasted={'field':'mcp-mode','value':'json'}
     stdio={'field':'mcp-mode','value':'stdio'}
     data=envelope({'detailsLabel':'连接与数据说明','details':'Gateway 会访问此服务并读取工具列表。',
                    'advancedLabel':'认证与高级设置','fields':[
                     {'id':'mcp-mode','label':'添加方式','type':'select','presentation':'segmented',
                      'value':'json' if action=='edit' else 'link',
                      'options':[{'id':'link','label':'服务链接'},{'id':'json','label':'粘贴 JSON'},{'id':'stdio','label':'命令启动'}]},
                     {'id':'url','label':'服务地址','type':'text','hint':'https://example.com/mcp','visibleWhen':link},
                     {'id':'mcp-json','label':'MCP JSON 配置','type':'multiline','retain':True,'visibleWhen':pasted,
                      'hint':'{ "mcpServers": { … } }'},
                     {'id':'command','label':'可执行程序','type':'text','visibleWhen':stdio},
                     {'id':'id','label':'名称（选填）','type':'text','advanced':True,'visibleWhen':link}],
                    'actions':[{'id':'create','label':'检查连接','visibleWhen':link},
                               {'id':'preview','label':'预览配置','visibleWhen':pasted},
                               {'id':'review-command','label':'审阅命令','visibleWhen':stdio}]})
   else:
    data=envelope({'message':'账号已连接','chatPrompt':'请使用「Drive Connection」帮我：',
                   'actions':[{'id':'authorize','label':'重新授权','advanced':True}]})
  elif path=='/api/capabilities/mobile-actions/panel/agents':
   data=envelope({'fields':[{'id':'name','label':'名称','type':'text','value':'Coding Expert'}],
                  'actions':[{'id':'save','label':'保存'}]})
  elif path=='/api/capabilities/mobile-actions/panel/channels':
   action=json.loads(body).get('action') if body else None
   if query.get('id')==['form-channel']:
    data=envelope({'fields':[{'id':f'option-{i}','label':f'配置项 {i}','type':'text'} for i in range(1, 11)],
                   'actions':[{'id':'save','label':'保存配置'}]})
   elif action in ('pair', 'pair-status'):
    direct=query.get('id')==['mail-channel']
    data=envelope({'qrUrl':'https://example.com/scan-only', 'flow':'setup-preview', 'pollAction':'pair-status',
                   'message':'在验证页完成授权后返回，连接状态会自动更新。' if direct else '等待扫码确认',
                   'actions':[{'id':'pair-cancel','label':'取消配对'}],
                   **({'authorizationUrl':'https://example.com/', 'deviceVerificationCode':'ABCD-1234'}
                      if direct else {})})
   else:
    data=envelope({'message':'可在此管理消息通道。','actions':[{'id':'pair','label':'配对通道'}]})
  elif path in capability_brands:
   logo = capability_brands[path]
   self.send_response(200)
   self.send_header('Content-Type','image/svg+xml')
   self.send_header('Content-Length',str(len(logo)))
   self.end_headers()
   self.wfile.write(logo)
   return
  elif device_capabilities and path=='/api/endpoint-tools/device-connections':
   if self.command=='PATCH':
    change=json.loads(body)
    if change.get('toolName')=='mobile.file.pick' and isinstance(change.get('allowed'),bool):
     device_file_allowed=change['allowed']; data=envelope(change)
    else: status=400; data={'ok':False}
   else:
    data=envelope({'currentDeviceId':'test-phone','devices':[
     {'id':'test-phone','name':'测试 iPhone','kind':'mobile','platform':'ios','availability':'foreground',
      'tools':['mobile.file.pick'],'folders':[],
      'capabilities':[{'name':'mobile.file.pick','title':'Files','titleZh':'文件','allowed':device_file_allowed}]}]})
  elif device_connections and path=='/api/endpoint-tools/device-connections':
   data=envelope({'currentDeviceId':'test-phone','devices':[
    {'id':'test-phone','name':'测试 iPhone','kind':'mobile','platform':'ios','availability':'foreground',
     'tools':['mobile.file.pick','mobile.media.pick','mobile.contacts.pick','mobile.calendar.query_events','mobile.device.get_location'],'folders':[]},
    {'id':'test-mac','name':'工作 MacBook','kind':'desktop','platform':'darwin','endpointId':'test-mac-endpoint','availability':'background',
     'tools':['desktop.folder.search','desktop.folder.read'],'folders':[{'id':space_id,'kind':'downloads','label':'Downloads'}]},
    {'id':'test-offline-pc','name':'家里的电脑','kind':'desktop','platform':'win32','availability':'offline','tools':[],'folders':[]}]})
  elif device_connections and path=='/api/endpoint-tools/device-connections/chat' and self.command=='POST':
   if json.loads(body).get('endpointId') == 'test-mac-endpoint': data=envelope({'conversationId':parent,'agentId':'main'})
   else: status=409; data={'ok':False,'error':{'message':'Selected computer is unavailable'}}
  elif device_connections and path=='/api/endpoint-tools/targets/'+parent:
   data=envelope({'deviceName':'工作 MacBook','deviceState':'ready'})
  elif path=='/api/capabilities/mobile-catalog':
   catalog = {
    'plugins': [{'id':'meeting-plugin','name':'Meeting Plugin','description':'Plan meetings','group':'installed','iconUrl':capability_plugin_icon},
                {'id':'document-plugin','name':'Document Plugin','group':'available'}],
    'skills': [{'id':'meeting-skill','name':'Meeting Skill','group':'installed'}],
    'connections': [{'id':'drive-connection','name':'Drive Connection','group':'connected','iconUrl':'/connector-icons/gmail.svg'}],
    'agents': [{'id':'coder','name':'Coding Expert','group':'expert'}],
    'channels': [{'id':'mail-channel','name':'Mail Channel','group':'configured','iconUrl':'/channel-icons/telegram.svg'}],
   }
   category = query.get('category',['plugins'])[0]
   if category == 'channels':
    catalog['channels'].append({'id':'scan-channel','name':'扫码连接示例','group':'available'})
    catalog['channels'].append({'id':'form-channel','name':'长表单示例','group':'available'})
   if slow_capabilities and category == 'channels': time.sleep(12)
   if slow_capabilities and category == 'plugins':
    catalog['plugins'] += [{'id':f'meeting-{i}','name':f'Meeting Plugin {i}','group':'installed'} for i in range(24)]
   data=envelope({'items':catalog[category]})
  elif path=='/api/personal-agent': data=envelope(record)
  elif path=='/api/personal-agent/activity':
   if query.get('view') == ['deliverables']:
    data=envelope({'items':[{'id':'personal-file','task':{'id':'task-header','title':'任务顶部栏检查','conversationId':parent},
      'artifact':{'artifactId':'fixture-file','title':'版本验收.txt','mimeType':'text/plain','uri':'xopc-file:fixture-file','availability':'available','sizeBytes':20}}], 'nextOffset':None})
   else:
    data=envelope({'current':[{'id':'task-header','title':'任务顶部栏检查','phase':'running','operationalState':'needs_user',
         'attention':{'kind':'prompt'},'updatedAt':now}] + [
        {'id':f'active-{i}','title':f'进行中的助理任务 {i}','phase':'paused','updatedAt':now} for i in range(8)],
       'items':[],'total':0})
  elif path=='/api/personal-agent/schedules': data=envelope([])
  elif path=='/api/personal-agent/profile':
   patch=json.loads(body)
   if patch['revision']!=record['revision']: status=409;data={'ok':False,'error':'Settings changed'}
   else:
    if 'voiceCallPreferences' in patch:
     record['voiceCallPreferences'].update(patch.pop('voiceCallPreferences'))
    record.update(patch);record['revision']+=1;data=envelope(record)
  elif path=='/api/personal-agent/proactivity':
   if body:
    patch=json.loads(body)
    if patch['revision']!=outreach['revision']: status=409;data={'ok':False,'error':'Settings changed'}
    else: outreach.update(patch);outreach['revision']+=1
   if data is None: data=envelope(outreach)
  elif path=='/api/personal-agent/avatar': data=envelope({'agentId':record['agentId']})
  elif path=='/api/voice/realtime/status': data=envelope({'tts':{'provider':'fixture','model':'tts'}})
  elif path=='/api/voice/tts-voices': data=envelope({'voices':[{'id':'fixture-voice','name':'Fixture voice'}]})
  elif path=='/api/models': data=envelope({'defaultId':'test/model','models':[model,second_model]})
  elif path=='/api/mobile/model-settings':
   if self.command == 'PATCH':
    change=json.loads(body)
    if change.get('kind') == 'model' and change.get('key') == 'chat' and change.get('revision') == str(global_model_revision):
     if any(item['ref'] == change.get('ref') for item in model_choices):
      global_model = change['ref']
      global_model_revision += 1
   data=global_model_payload()
  elif sidebar_fixture and path=='/api/sessions':
   rows=[dict(row, key=f'11111111-2026-4000-8000-{i:012d}', name=f'会话 {i}') for i in range(1, 28)]
   offset=int(query.get('offset',['0'])[0]); limit=min(20, int(query.get('limit',['20'])[0]))
   data={'items':rows[offset:offset+limit],'total':len(rows),'hasMore':offset+limit<len(rows)}
  elif path=='/api/sessions':
   items=[dict(row,key='draft',name='新对话',messageCount=0),row]
   data={'items':items,'total':2,'hasMore':False,'childrenByConversationId':{parent:{'total':1,'activeCount':0,'items':[{'taskId':'task-child','title':'移动端子任务','phase':'closed','activeConversationId':child}]}}}
  elif path==f'/api/sessions/{schedule_chat}/history':
   data={'session':{'key':schedule_chat,'agentId':'main','messages':[]},'pagination':{'hasMore':False}}
  elif path.endswith('/history'):
   key=path.split('/')[3]
   history = bubble_messages if bubble_fixture else keyboard_messages if keyboard_fixture else messages
   if key == personal and (music_fixture or live_music_fixture): history = history + [music_reply]
   data={'session':{'key':key,'transcriptId':f'transcript-{key}','agentId':'main','messages':history},'pagination':{'hasMore':False}}
  elif suggestion_fixture and path.endswith('/next-turn-suggestion'):
   key=path.split('/')[3]
   data={'status':'ready','suggestion':{'id':'99999999-9999-4999-8999-999999999999',
    'conversationId':key,'transcriptId':f'transcript-{key}','agentId':'personal' if key==personal else 'main',
    'locale':query.get('locale',['zh'])[0],'prompt':'把刚才的结果拆成三个步骤',
    'sourceRunId':'fixture-run','inputRevision':1,'transcriptCursor':1,'expiresAt':now+600000}}
  elif suggestion_fixture and path.endswith('/next-turn-suggestion-feedback'):
   data={'ok':True}
  elif path.endswith('/context-summary'): data={'summary':{'conversationId':path.split('/')[3],'work':{},'sources':[],'sourcesHasMore':False,'unavailableSections':[],'environment':{'kind':'local_checkout','rootPath':'/fixture','available':True}}}
  elif path.endswith('/agent-config'):
   current = personal_config if path.split('/')[3] == personal else config
   if body:
    patch=json.loads(body)
    if patch.pop('configVersion',None) != current['configVersion']:
     status=409;data={'ok':False,'error':{'message':'Settings changed'}}
    else: current.update(patch);current['configVersion']+=1
   if data is None: data=envelope(current)
  elif path.endswith('/clarification'): data=envelope({'clarification':None})
  elif path.endswith('/input-state'): data=envelope({'activeRunId':None,'inputs':[]})
  elif path.endswith('/run'):
   active=child in path or (live_music_fixture and path == f'/api/sessions/{personal}/run')
   data=envelope({'active':active,'runId':'fixture-live' if active else None})
  elif path.endswith('/execution-detail'): data={'detail':{'turnId':query.get('turnId',['turn-1'])[0],'steps':[]}}
  elif path=='/api/home':
   data={'needsUser':[{'id':'attention','kind':'task','title':'需要验收','summary':'执行已完成，等待确认。','statusLabel':'待验收','recommendation':'查看结果后验收。','openAction':{'type':'open','label':'查看任务','href':'/tasks'},'primaryAction':{'type':'task_review','label':'查看结果并验收','taskId':'task-header'}}], 'background':[{'id':'running','kind':'task','title':'进行中的工作','summary':'正在处理。'},{'id':'scheduled','kind':'scheduled','title':'明日计划','summary':'明天上午执行。'}],'backgroundCount':2,
    'recentDeliveries':[{'id':'task:fixture-delivery','kind':'task','subjectId':'task-header','projectId':'fixture-project','title':'交付纪要','summary':'测试用成果摘要','completedAt':now,'read':False,'href':'/tasks/task-header'}]}
  elif path=='/api/projects': data={'ok':True,'items':[project],'total':1,'hasMore':False}
  elif path=='/api/projects/fixture-project': data={'ok':True,'project':project}
  elif path=='/api/projects/fixture-project/sessions': data={'ok':True,'sessions':[]}
  elif path=='/api/automations/configuration-conversations' and self.command=='POST':
   scope=json.loads(body or b'{}')
   if scope not in ({}, {'projectId':'fixture-project'}, {'personalLocale':'zh'}, {'personalLocale':'en'}):
    status=400; data={'message':'Invalid schedule scope'}
   else: data={'conversationId':schedule_chat}
  elif path==f'/api/music-generation/sessions/{personal}/jobs' and music_fixture:
   data={'jobs':[music_job], 'configured':True, 'transcriptId':f'transcript-{personal}'}
  elif path==f'/api/music-generation/sessions/{personal}/jobs' and live_music_fixture:
   jobs=[older_music_job]
   if live_music_state: jobs.append(dict(music_job,state=live_music_state))
   data={'jobs':jobs,'configured':True,'transcriptId':f'transcript-{personal}'}
  elif path=='/fixture/music-state' and live_music_fixture and self.command=='POST':
   live_music_state=json.loads(body).get('state')
   data={'ok':True}
  elif path=='/api/media/playback-ticket' and music_fixture and self.command=='POST':
   target=json.loads(body).get('path')
   allowed=(f'/api/music-generation/sessions/{personal}/jobs/fixture-song/audio', f'/api/spaces/items/{space_music_id}/versions/{space_music_version["id"]}/content')
   if target in allowed: status=201; data={'path':target+'?playbackTicket='+'a'*43}
   else: status=404; data={'error':'Missing media fixture'}
  elif path==f'/api/music-generation/sessions/{personal}/jobs/fixture-song/audio' and music_fixture:
   self.send_music(); return
  elif path=='/api/automations': data={'automations':[] if 'projectId' in query else [automation]}
  elif path=='/api/automations/fixture-automation': data={'automation':automation}
  elif path=='/api/automation-runs': data={'runs':[automation_run]}
  elif path=='/api/automation-runs/fixture-automation-run': data={'run':automation_run}
  elif path=='/api/automation-runs/fixture-automation-run/events': data={'events':[]}
  elif path=='/api/tasks': data={'ok':True,'items':[{'task':task,'operationalState':'idle'}],'total':1,'hasMore':False}
  elif path in ('/api/tasks/task-header','/api/tasks/task-child'):
   selected_task = task if path.endswith('task-header') else dict(task,id='task-child',title='移动端子任务')
   data={'ok':True,'task':selected_task,'operationalState':'idle','allowedCommands':['move','close'],'runs':[],'waits':[],'criterionReviews':[]}
  elif path in ('/api/tasks/task-header/conversation','/api/tasks/task-child/conversation'):
   data={'ok':True,'conversationId':child}
  elif path=='/api/automations/metrics': data={'nextRun':{'automationId':'auto','name':'不应重复显示的计划','runAtMs':now+100000}}
  elif path in ('/api/files/recent','/api/files/search'): data={'items':[dict(file_fixture,revision='stale-revision')]}
  elif path=='/api/files/fixture-file': data={'resource':file_fixture}
  elif path=='/api/files/fixture-file/content':
   payload=b'File version fixture'
   self.send_response(200);self.send_header('Content-Type','text/plain');self.send_header('ETag',file_fixture['revision']);self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload);return
  elif path=='/api/files/fixture-file/versions' and self.command=='POST':
   command=json.loads(body)
   key=command.get('id')
   if not key or command.get('revision') != file_fixture['revision']:
    status=400; data={'error':{'message':'Wrong version request'}}
   elif key not in version_attempts:
    version_attempts.add(key)
    status=503; data={'error':{'message':'Retry the same version request'}}
   else:
    status=201; data={'version':{'id':key,'revision':file_fixture['revision']}}
  elif path=='/api/notes': data={'items':[{'id':'note-1','title':'布局检查笔记','kind':'note','status':'active','createdAt':now,'updatedAt':now,'snippet':'用于模拟器验证。'}],'total':1,'hasMore':False}
  elif path=='/api/notes/note-1': data={'note':{'id':'note-1','title':'布局检查笔记','markdown':'## 格式示例\n\n- [x] 完成示例','kind':'note','status':'active','createdAt':now,'updatedAt':now}}
  elif path=='/api/user-model/mobile-summary': data={'profile':{'callName':'Tester','role':'工程师'},'settings':{'memoryEnabled':True,'showMemoryReferences':True,'sensitiveWritePolicy':'confirm'},'counts':{'total':0,'explicit':0,'learned':0,'review':0,'workMemory':len(work_memory)},'goals':goals,'recent':[]}
  elif path=='/api/user-model/assertions': data={'items':[]}
  elif path=='/api/knowledge-memory' and query.get('view')==['manage']:
   data={'items':work_memory[1:]} if query.get('cursor')==['work-next'] else {'items':work_memory[:1],'nextCursor':'work-next'}
  elif path=='/api/shares': data={'ok':True,'payload':{'shares':shares}}
  elif 'media' in path or path.endswith('voice.wav'):
   self.send_response(200);self.send_header('Content-Type','audio/wav');self.send_header('Content-Length',str(len(w.getvalue())));self.end_headers();self.wfile.write(w.getvalue());return
  else:
   status=404;data={'ok':False,'error':{'message':'Fixture endpoint unavailable'}}
   print('unhandled', self.command,path,flush=True)
  payload=json.dumps(data,ensure_ascii=False).encode()
  self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
port=int(sys.argv[1]) if len(sys.argv) > 1 else 18791
print(f'Fixture ready on localhost:{port}',flush=True)
ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
