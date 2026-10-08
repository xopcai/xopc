import type { ConnectorDefinition } from './types.js';

const DINGTALK_MCP_VERSION = '1.1.21';
const AMAP_MCP_VERSION = '0.0.8';
const YUQUE_MCP_VERSION = '1.0.0';
const RAILWAY_MCP_VERSION = '0.3.10';
const ANTV_CHART_MCP_VERSION = '0.9.10';

export const CHINA_CONNECTORS: readonly ConnectorDefinition[] = [
  {
    id: 'feishu-workspace', version: '1.0.96', displayName: '飞书办公',
    description: '连接飞书账号，搜索和读取文档、查询日程和联系人，并按权限创建日程。',
    category: 'docs', kind: 'cli', source: 'builtin', capabilities: ['tools'],
    benefits: ['understand', 'act'], tags: ['中国', 'Feishu', 'Lark', '飞书', '日历', '文档', '文件', '联系人'],
    branding: { logoUrl: '/channel-icons/feishu.svg', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'cli' }, setup: {},
    runtime: { type: 'cli', adapterId: 'lark', adapterVersion: '1', binaryVersion: '1.0.96' },
    permissions: { localExec: true, data: ['calendar', 'documents', 'contacts'], networkDomains: ['open.feishu.cn'] },
    integrationStrategy: { lane: 'native', workload: 'core', preferred: true },
  },
  {
    id: 'wecom-workspace', version: '1.3.0', displayName: '企业微信',
    description: '扫码连接企业微信，搜索和读取文档、查询联系人和待办，并按权限创建待办。',
    category: 'docs', kind: 'cli', source: 'builtin', capabilities: ['tools'],
    benefits: ['understand', 'act'], tags: ['中国', 'WeCom', '企业微信', '文档', '联系人', '待办'],
    branding: { logoUrl: '/connector-icons/wecom.svg', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'cli' }, setup: {},
    runtime: { type: 'cli', adapterId: 'wecom', adapterVersion: '1', binaryVersion: '1.3.0' },
    permissions: { localExec: true, data: ['documents', 'contacts', 'tasks'], networkDomains: ['qyapi.weixin.qq.com'] },
    integrationStrategy: { lane: 'native', workload: 'core', preferred: true },
  },
  {
    id: 'dingtalk-workspace',
    version: DINGTALK_MCP_VERSION,
    displayName: '钉钉办公',
    description: '连接钉钉通讯录、待办、日历、机器人和工作通知。',
    category: 'automation',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio', 'auth.apiKey'],
    benefits: ['act', 'reach'],
    tags: ['中国', '钉钉', '通讯录', '待办', '日历', '机器人'],
    branding: { logoUrl: '/connector-icons/dingtalk-mark.svg', source: 'builtin' },
    verificationLevel: 'verified',
    auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '前往钉钉开发者后台创建应用', href: 'https://open-dev.dingtalk.com/fe/app', external: true },
      ],
      secrets: [
        { key: 'clientId', label: 'Client ID', description: '在钉钉应用的凭证与基础信息页复制。', required: true },
        { key: 'clientSecret', label: 'Client Secret', description: '与 Client ID 同一页面，仅保存在本机凭据存储。', required: true },
      ],
      config: [
        {
          key: 'activeProfiles',
          label: '启用服务',
          type: 'string',
          required: true,
          defaultValue: 'dingtalk-contacts,dingtalk-calendar,dingtalk-todo,dingtalk-robot',
          description: '逗号分隔的钉钉 MCP 服务列表。',
        },
      ],
    },
    runtime: {
      type: 'mcp',
      serverId: 'dingtalk_workspace',
      localPackage: {
        registry: 'npm',
        name: 'dingtalk-mcp',
        version: DINGTALK_MCP_VERSION,
      },
      serverTemplate: {
        command: 'npx',
        args: ['-y', `dingtalk-mcp@${DINGTALK_MCP_VERSION}`],
        env: {
          DINGTALK_Client_ID: '{{secrets.clientId}}',
          DINGTALK_Client_Secret: '{{secrets.clientSecret}}',
          ACTIVE_PROFILES: '{{config.activeProfiles}}',
        },
      },
    },
    permissions: {
      data: ['contacts', 'communications', 'calendar', 'tasks'],
      networkDomains: ['api.dingtalk.com', 'oapi.dingtalk.com'],
      localExec: true,
      filesystem: [],
    },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'wps365-workspace', version: '0.3.6', displayName: 'WPS 365',
    description: '连接 WPS 365 企业账号，查看和搜索云文档、日程及邮件。当前仅支持读取。',
    category: 'docs', kind: 'cli', source: 'builtin', capabilities: ['tools'],
    benefits: ['understand'], tags: ['中国', 'WPS', 'WPS365', '金山', '金山文档', '云文档', '日历', '邮箱'],
    branding: { logoUrl: '/connector-icons/wps-docs.svg', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'cli' },
    setup: { links: [{ label: 'WPS 365 企业授权与权限说明', href: 'https://open.wps.cn/documents/wps365-cli', external: true }] },
    runtime: { type: 'cli', adapterId: 'wps365', adapterVersion: '1', binaryVersion: '0.3.6' },
    permissions: { localExec: true, data: ['documents', 'calendar', 'email'], networkDomains: ['openapi.wps.cn', 'open.wps.cn'] },
    integrationStrategy: { lane: 'native', workload: 'core', preferred: true },
  },
  {
    id: 'tencent-meeting',
    version: '1.0.0',
    displayName: '腾讯会议',
    description: '通过腾讯会议官方 MCP 查询、创建和管理个人会议。',
    category: 'automation',
    kind: 'mcp',
    source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.streamableHttp', 'auth.apiKey'],
    benefits: ['understand', 'act'],
    tags: ['中国', '腾讯会议', '会议', '日程'],
    branding: { logoUrl: '/connector-icons/tencent-meeting-mark.svg', source: 'builtin' },
    verificationLevel: 'beta',
    auth: { mode: 'apiKey' },
    setup: {
      links: [{ label: '前往腾讯会议 MCP 获取说明', href: 'https://meeting.tencent.com/support/topic/2233/index.html', external: true }],
      secrets: [{ key: 'token', label: '腾讯会议 MCP Token', description: '目前个人账号可直接获取，企业账号需申请灰度。', required: true }],
    },
    runtime: {
      type: 'mcp',
      serverId: 'tencent_meeting',
      serverTemplate: {
        url: 'https://mcp.meeting.tencent.com/mcp',
        transport: 'streamable-http',
        headers: { 'X-Tencent-Meeting-Token': '{{secrets.token}}' },
      },
    },
    permissions: {
      data: ['calendar', 'meeting_records'],
      networkDomains: ['mcp.meeting.tencent.com'],
      localExec: false,
      filesystem: [],
    },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'tencent-docs', version: '1.0.0', displayName: '腾讯文档',
    description: '通过腾讯文档官方 MCP 搜索和读取文档、创建智能文档，用于工作资料、家庭清单和计划整理。可用工具受账号权限及会员权益限制。',
    category: 'docs', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.streamableHttp', 'auth.apiKey'],
    benefits: ['understand', 'act'], tags: ['中国', '工作', '生活', '规划', '腾讯文档', 'Tencent Docs', '文档', '清单'],
    branding: { logoUrl: '/connector-icons/tencent-docs.ico', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '获取腾讯文档 MCP Token', href: 'https://docs.qq.com/open/auth/mcp.html', external: true },
        { label: '官方 MCP 接入与工具说明', href: 'https://developer.cloud.tencent.com/mcp/server/11803', external: true },
      ],
      secrets: [{ key: 'token', label: '腾讯文档 MCP Token', description: '在腾讯文档授权页获取，直接粘贴 Token，不要添加 Bearer 前缀。', required: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'tencent_docs',
      serverTemplate: {
        url: 'https://docs.qq.com/openapi/mcp', transport: 'streamable-http',
        headers: { Authorization: '{{secrets.token}}' },
      },
    },
    permissions: { data: ['documents'], networkDomains: ['docs.qq.com'], localExec: false, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'yuque', version: YUQUE_MCP_VERSION, displayName: '语雀',
    description: '连接语雀知识库，搜索和读取笔记、创建和更新文档，用于工作知识、学习笔记及长期计划。',
    category: 'docs', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio', 'auth.apiKey'],
    benefits: ['understand', 'act'], tags: ['中国', '工作', '生活', '规划', '语雀', 'Yuque', '知识库', '笔记', '学习'],
    branding: { logoUrl: '/connector-icons/yuque.png', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '获取语雀个人 Token', href: 'https://www.yuque.com/settings/tokens', external: true },
        { label: '语雀官方 MCP 项目', href: 'https://github.com/yuque/yuque-mcp-server', external: true },
      ],
      secrets: [{ key: 'token', label: '语雀个人 Token', description: '在语雀账号设置中创建，勾选需要访问的知识库和文档权限；Token 获取资格以账号权益为准。', required: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'yuque',
      localPackage: { registry: 'npm', name: 'yuque-mcp', version: YUQUE_MCP_VERSION },
      serverTemplate: {
        command: 'npx', args: ['-y', `yuque-mcp@${YUQUE_MCP_VERSION}`],
        env: { YUQUE_PERSONAL_TOKEN: '{{secrets.token}}' },
      },
    },
    permissions: { data: ['documents', 'knowledge_bases'], networkDomains: ['www.yuque.com'], localExec: true, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'amap-maps', version: AMAP_MCP_VERSION, displayName: '高德地图',
    description: '查询国内地点、周边设施和天气，规划驾车、步行、骑行及公交路线，用于日常生活、通勤和旅行安排。',
    category: 'data', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio', 'auth.apiKey'],
    benefits: ['understand'], tags: ['中国', '生活', '出行', '规划', '高德', 'Amap', '地图', '路线', '公交', '天气', '周边'],
    branding: { logoUrl: '/connector-icons/amap.ico', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '在高德控制台创建 Web 服务 Key', href: 'https://console.amap.com/dev/key/app', external: true },
        { label: '高德官方 MCP 接入说明', href: 'https://developer.amap.com/api/mcp-server/gettingstarted', external: true },
      ],
      secrets: [{ key: 'apiKey', label: '高德 Web 服务 Key', description: '创建应用并添加 Key，服务平台选择 Web 服务。调用配额和商业使用条件以高德账号及服务条款为准。', required: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'amap_maps',
      localPackage: { registry: 'npm', name: '@amap/amap-maps-mcp-server', version: AMAP_MCP_VERSION },
      serverTemplate: {
        command: 'npx', args: ['-y', `@amap/amap-maps-mcp-server@${AMAP_MCP_VERSION}`],
        env: { AMAP_MAPS_API_KEY: '{{secrets.apiKey}}' },
      },
    },
    permissions: { data: ['locations', 'routes', 'weather'], networkDomains: ['restapi.amap.com'], localExec: true, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'bailian-web-search', version: '1.0.0', displayName: '百炼联网搜索',
    description: '通过阿里云百炼官方 MCP 检索实时网页，为工作调研、生活信息、出行攻略和计划比较提供来源。',
    category: 'data', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.streamableHttp', 'auth.apiKey'],
    benefits: ['understand'], tags: ['中国', '工作', '生活', '出行', '规划', '百炼', '阿里云', 'DashScope', '联网搜索', '调研'],
    branding: { logoUrl: '/connector-icons/bailian.png', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '前往百炼控制台开通联网搜索 MCP 并获取 API Key', href: 'https://bailian.console.aliyun.com/', external: true },
        { label: '百炼 MCP 外部调用说明', href: 'https://docs.agent.bailian.aliyun.com/zh/mcp/external-invocation', external: true },
      ],
      secrets: [{ key: 'apiKey', label: 'DashScope API Key', description: '先在百炼 MCP 广场开通联网搜索，再填入对应的百炼平台 API Key。服务配额以控制台为准；直接粘贴 Key，不要添加 Bearer 前缀。', required: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'bailian_web_search',
      serverTemplate: {
        url: 'https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp', transport: 'streamable-http',
        headers: { Authorization: 'Bearer {{secrets.apiKey}}' },
      },
    },
    permissions: { data: ['search_queries'], networkDomains: ['dashscope.aliyuncs.com'], localExec: false, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'dida365', version: '1.0.0', displayName: '滴答清单',
    description: '连接你的个人滴答清单账号，查询和管理任务、清单、习惯及专注记录，用于工作安排、家庭事项和学习计划。',
    category: 'automation', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.streamableHttp', 'auth.apiKey'],
    benefits: ['understand', 'act'], tags: ['中国', '个人账号', '工作', '生活', '规划', '滴答清单', 'Dida365', '待办', '任务', '习惯', '专注'],
    branding: { logoUrl: '/connector-icons/dida365.png', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '打开滴答清单网页版获取 API 口令', href: 'https://dida365.com/', external: true },
        { label: '滴答清单官方 MCP 配置说明', href: 'https://help.dida365.com/articles/7438132116019216384', external: true },
      ],
      secrets: [{ key: 'token', label: '滴答清单 API 口令', description: '登录个人账号，在「设置 → 账户与安全 → API 口令」中创建并复制。直接粘贴口令，不要添加 Bearer 前缀；无需创建开发者应用。', required: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'dida365',
      serverTemplate: {
        url: 'https://mcp.dida365.com', transport: 'streamable-http',
        headers: { Authorization: 'Bearer {{secrets.token}}' },
      },
    },
    permissions: { data: ['tasks', 'habits', 'focus_records'], networkDomains: ['mcp.dida365.com'], localExec: false, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'flomo', version: '1.0.0', displayName: 'flomo 浮墨笔记',
    description: '连接你的个人 flomo 账号，搜索和读取旧笔记、保存新想法、整理标签，用于工作思考、生活记录和长期复盘。需要 flomo Max 会员。',
    category: 'docs', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.streamableHttp', 'auth.apiKey'],
    benefits: ['understand', 'act'], tags: ['中国', '个人账号', '工作', '生活', '规划', 'flomo', '浮墨', '笔记', '标签', '复盘'],
    branding: { logoUrl: '/connector-icons/flomo.png', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'apiKey' },
    setup: {
      links: [
        { label: '登录 flomo 创建个人 MCP Token', href: 'https://flomoapp.com/', external: true },
        { label: 'flomo 官方个人 Token 接入说明', href: 'https://help.flomoapp.com/advance/mcp/connect-maxclaw.html', external: true },
      ],
      secrets: [{ key: 'token', label: 'flomo 个人 MCP Token', description: '需要 Max 会员。在 flomo「设置 → MCP 连接 → 个人 Token」中创建并复制完整 Token；只显示一次，可在同一页面注销。不要添加 Bearer 前缀。', required: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'flomo',
      serverTemplate: {
        url: 'https://flomoapp.com/mcp', transport: 'streamable-http',
        headers: { Authorization: 'Bearer {{secrets.token}}' },
      },
    },
    permissions: { data: ['notes', 'tags', 'memory_profiles'], networkDomains: ['flomoapp.com'], localExec: false, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'railway-12306', version: RAILWAY_MCP_VERSION, displayName: '12306 车次查询（社区）',
    description: '查询国内火车车次、余票、经停和中转方案，用于个人差旅与旅行规划。社区维护的查询工具，非铁路官方 MCP；不登录账号、不读取订单、不购票。',
    category: 'data', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio'],
    benefits: ['understand'], tags: ['中国', '个人自助', '社区', '生活', '出行', '规划', '12306', '火车', '高铁', '余票', '中转'],
    branding: { logoUrl: '/connector-icons/railway-12306.jpg', source: 'builtin' },
    verificationLevel: 'experimental', auth: { mode: 'none' },
    setup: {
      links: [{ label: '社区项目及查询范围', href: 'https://github.com/Joooook/12306-mcp', external: true }],
    },
    runtime: {
      type: 'mcp', serverId: 'railway_12306',
      localPackage: { registry: 'npm', name: '12306-mcp', version: RAILWAY_MCP_VERSION },
      serverTemplate: { command: 'npx', args: ['-y', `12306-mcp@${RAILWAY_MCP_VERSION}`] },
    },
    permissions: { data: ['travel_queries'], networkDomains: ['kyfw.12306.cn', 'search.12306.cn', 'www.12306.cn'], localExec: true, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
  {
    id: 'antv-chart', version: ANTV_CHART_MCP_VERSION, displayName: 'AntV 图表',
    description: '将工作数据、家庭预算和规划资料生成统计图表、思维导图或路书。无需账号凭据；默认把图表数据发送到 AntV 远程出图服务。',
    category: 'data', kind: 'mcp', source: 'builtin',
    capabilities: ['tools', 'runtime.mcp.stdio'],
    benefits: ['act'], tags: ['中国', '个人自助', '工作', '生活', '出行', '规划', 'AntV', '图表', '可视化', '预算', '思维导图', '路书'],
    branding: { logoUrl: '/connector-icons/antv-chart.png', source: 'builtin' },
    verificationLevel: 'beta', auth: { mode: 'none' },
    setup: {
      links: [
        { label: 'AntV 官方 MCP 及出图服务说明', href: 'https://github.com/antvis/mcp-server-chart', external: true },
        { label: '魔搭国内服务页', href: 'https://modelscope.cn/mcp/servers/@antvis/mcp-server-chart', external: true },
      ],
    },
    runtime: {
      type: 'mcp', serverId: 'antv_chart',
      localPackage: { registry: 'npm', name: '@antv/mcp-server-chart', version: ANTV_CHART_MCP_VERSION },
      serverTemplate: { command: 'npx', args: ['-y', `@antv/mcp-server-chart@${ANTV_CHART_MCP_VERSION}`] },
    },
    permissions: { data: ['chart_data'], networkDomains: ['antv-studio.alipay.com'], localExec: true, filesystem: [] },
    integrationStrategy: { lane: 'mcp', workload: 'core', preferred: true },
  },
];
