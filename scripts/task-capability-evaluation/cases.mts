const connectorRecovery = 'src/connectors/__tests__/connection-recovery.test.ts';
const gatewayTools = 'src/agent/external-tools/__tests__/gateway-tools.test.ts';
const connectorCard = 'web/src/features/chat/connections/__tests__/connection-action-bar.test.tsx';
const mcpSetup = 'src/agent/mcp/__tests__/conversation-setup.test.ts';
const mcpDiscovery = 'src/agent/mcp/__tests__/discovery.test.ts';
const nativeMcp = 'src/agent/embedded/__tests__/pi-mcp-sdk.integration.test.ts';
const webSearch = 'src/agent/tools/__tests__/search-batch.test.ts';
const browserUse = 'src/agent/tools/browser/__tests__/browser-use-tool.test.ts';

export const cases = [
  {
    id: 'R01',
    prompt: '请把上周工作账号里的客户反馈归纳成三条，每条附原文出处。',
    environment: '有绑定的 Connector Host 或已启用插件，另有 MCP 候选。',
    criteria: '使用绑定的来源，结果与原文一致，零安装和额外授权。',
    checks: {
      [gatewayTools]: ['respects explicit filters and finds CLI tools'],
      'src/agent/external-tools/__tests__/read-policy.test.ts': ['forwards the host-selected discovery account'],
      [mcpSetup]: ['returns the Notion Store plugin without starting web research'],
    },
    unverified: '自然语言能否优先选中当前绑定，并交付带出处的摘要。',
  },
  {
    id: 'R02',
    prompt: '查一下 Acme Desk 工作账号里上周关闭的工单，按关闭时间排序。',
    environment: '只有已经连接的远程 MCP 提供相应工具。',
    criteria: '调用指定账号的正确工具并返回排序结果，零安装和网页调用。',
    checks: {
      [nativeMcp]: ['uses the public MCP extension over http', 'uses native http MCP inside the actual xopc pooled runner'],
      'src/agent/mcp/__tests__/continuation-guard.test.ts': ['pins resumed native calls and resource reads to the selected service'],
    },
    unverified: '独立账号夹具和真实模型首轮工具选择、排序交付。',
  },
  {
    id: 'R03',
    prompt: '找一下工作账号上周收到的三封客户来信。',
    environment: '原账号授权过期，或存在多个有权限且未绑定的账号。',
    criteria: '原账号重新授权或只选择一次，随后自动返回结果。',
    checks: {
      [connectorRecovery]: ['requires explicit account selection', 'rechecks revocation in the worker', 'does not request OAuth again for the selected account', 'continues once after a verified authorization'],
      [connectorCard]: ['asks for one account explicitly', 'does not render a second continue action'],
    },
    unverified: '过期授权与多账号两条路径从自然语言到业务结果的完整运行。',
  },
  {
    id: 'R04',
    prompt: '帮我查 Atlas Notes 工作区里最近更新的三份周报。',
    environment: '仅已审核的 Store 插件能提供所需能力，尚未安装。',
    criteria: '展示准确候选。用户确认前零安装，确认并完成授权后继续查询。',
    checks: {
      'src/capabilities/__tests__/store-connector.test.ts': ['returns exact install candidates with semantic capabilities'],
      [connectorCard]: ['opens the reviewed Store installer and resumes the preserved objective'],
      [connectorRecovery]: ['verifies an exact Store installation and queues the objective'],
    },
    unverified: '模型是否从普通查询发起安装卡，及安装确认、授权和实际业务读取能否串联。',
  },
  {
    id: 'R05',
    prompt: '帮我查询{service}里我资料中的标记码。',
    environment: '目录为空，公开资料公布远程 MCP；分别使用 OAuth 和 Token。',
    criteria: '自行发现候选，生成草稿和安全卡片，授权后在当前会话读到实际标记码，凭据不出现在对话和日志。',
    checks: {
      'src/agent/embedded/__tests__/tool-search-extension.test.ts': ['offers named-service MCP discovery'],
      [mcpDiscovery]: ['discovers from a name and binds a selected plan', 'uses the documented manual Bearer credential'],
      [mcpSetup]: ['keeps Token input out of plans', 'commits the tested server, preserves unrelated config and resumes once', 'returns only the host action to a card-capable turn', 'checks a discovered Bearer plan before showing credentials'],
      'src/gateway/hono/routes/__tests__/mcp-connection-setup.integration.test.ts': ['detects authentication and completes native OAuth'],
      'web/src/features/connectors/mcp/__tests__/mcp-setup-action-bar.test.tsx': ['offers one accurate primary action'],
    },
    unverified: '两种认证的真实模型端到端结论见对应真实聊天结果。',
  },
  {
    id: 'R06',
    prompt: '只查 EU 工作区的退款记录，给出已退款和处理中两部分。',
    environment: '服务同名，一个候选范围错误，一个只能查已退款，另一个来源未核实。',
    criteria: '拒绝错误范围与未审核连接，检查真实能力，准确标明覆盖范围；确有歧义时只问一次。',
    checks: {
      [mcpDiscovery]: ['requires a new user reply before choosing', 'requires owner review even for'],
      [mcpSetup]: ['requires owner review for every discovered plan'],
      [connectorRecovery]: ['does not substitute the sole connected account', 'keeps an authorized account connected when the required tool contracts are missing'],
    },
    unverified: '地区、账号、能力同时不确定时的模型判断和部分结果。',
  },
  {
    id: 'R07',
    prompt: '用 Pulse 周报的行业模板整理这三条销售记录：苹果 120、香蕉 80、苹果 50。',
    environment: '分别提供已启用 Skill 和仅在目录发现的 Skill。',
    criteria: '已启用时直接应用；缺失时确认后才安装；两种情形都交付符合模板的产物。',
    checks: {
      'src/agent/skills/__tests__/format-skills-prompt.test.ts': ['includes all enabled skills'],
      'src/agent/tools/__tests__/skill-install-tool.test.ts': ['installs an exact marketplace reference'],
    },
    unverified: '自然任务触发 Skill 安装确认和宿主自动继续后的产物。',
  },
  {
    id: 'R08',
    prompt: '查一下 North Hall 这个周日几点开门，附官方页面。',
    environment: '同一答案分别放在静态页面和需筛选的页面。',
    criteria: '静态可用 Web；交互用 Browser Use；结果、出处正确且零无关连接。',
    checks: {
      [webSearch]: ['executes authorized singles in sequence'],
      'src/agent/tools/__tests__/web.test.ts': ['extracts readable article text'],
      [browserUse]: ['forwards a typed action and returns semantic observations'],
    },
    unverified: '模型能否按页面结构切换，以及在真实固定网页执行筛选。',
  },
  {
    id: 'R09',
    prompt: '查我的 Acme Desk 账号里还有几笔待处理退款。',
    environment: '同源页面已登录。分别模拟无集成、暂不可用、用户跳过，以及仅公开页面可用。',
    criteria: '在授权范围内查询同源网页；需要登录时交用户；无法访问私有数据时标明缺口。',
    checks: {
      [connectorRecovery]: ['persists skip suppression'],
      [connectorCard]: ['lets the user skip without launching authorization'],
      [browserUse]: ['short-circuits with a structured setup error'],
      'src/browser/__tests__/browser-runtime.test.ts': ['keeps one task-bound session', 'enforces cross-domain deny'],
    },
    unverified: '同源私有查询、浏览器登录接手和跳过后的交付。现有指导对浏览器自动兜底有限制。',
  },
  {
    id: 'R10',
    prompt: '如何整理飞书里的审批记录？只解释流程。',
    environment: '将纯咨询、策略拒绝、目录暂时失败作为独立变体，失败场景有可保留的已有结果。',
    criteria: '纯咨询零变更；拒绝不绕过；临时失败与无匹配区分，并保留已有结果。',
    checks: {
      'src/agent/tools/__tests__/mcp-research-policy.test.ts': ['does not bypass a denied web tool'],
      'src/agent/external-tools/__tests__/service.test.ts': ['keeps successful provider results when another discovery source times out'],
      [webSearch]: ['keeps successful query output beside a typed permission refusal', 'reports rate-limit failures as failures'],
    },
    unverified: '真实模型纯咨询结果另见 live 结果；策略拒绝和故障只覆盖运行时探针。',
  },
  {
    id: 'R11',
    prompt: '授权后继续查我上周的工作邮件。',
    environment: '依次使用刷新、重启、重复回调、取消、重置、撤销和换账号变体。',
    criteria: '正常恢复只产生一条有效输入；旧回调无法在取消、重置、撤销或换账号后续跑。',
    checks: {
      [connectorRecovery]: ['preserves the wait through a gateway restart', 'recovers a claimed continuation after restart', 'rejects an old action after reset', 'does not resurrect a cancelled wait', 'rechecks revocation in the worker', 'retains the account after a restart interrupts selection'],
      [mcpSetup]: ['accepts a concurrent reconciliation of the same continuation', 'does not commit or resume after cancellation'],
      'web/src/features/connectors/mcp/__tests__/mcp-setup-action-bar.test.tsx': ['restores a pending sheet from the URL after reload'],
    },
    unverified: '不同集成上的所有回调和真实模型最终交付。',
  },
  {
    id: 'R12',
    prompt: '先整理活动邀请的收件人和正文，确认后帮我发送。',
    environment: '模拟正常确认、修改正文、响应丢失。',
    criteria: '未确认零提交；参数变化使旧确认失效；确认后最多提交一次；超时先查状态，未知如实显示。',
    checks: {
      [connectorRecovery]: ['binds approval to the account and resumes the same objective', 'never resends an uncertain Composio action', 'retains an unsuccessful provider response', 'claims concurrent Composio writes once'],
    },
    unverified: '通用原生 MCP 写入确认，以及超时后主动向目标服务查询状态和界面反馈。',
  },
  {
    id: 'R13',
    prompt: '把上周反馈台的工单和邮件里的客户来信按问题类别一起汇总。',
    environment: '工单已查并保存结果，邮件需要连接；使用固定的上周绝对时间范围。',
    criteria: '保持原绝对时间范围与已完成工单产物；恢复只查邮件，最后合并结果。',
    checks: {
      [connectorRecovery]: ['preserves completed and pending steps and the absolute time range'],
    },
    unverified: '真实模型是否只查第二个来源，并合并两个来源的可验证结果。',
  },
] as const;
