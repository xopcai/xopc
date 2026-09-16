# Computer Use 技术方案：xopc × xopc-platform

状态：Proposed / 待评审，尚未实现。

日期：2026-09-16。

代码核查基线：xopc `9f584b98a150740fdc14915336e8ea48ea6bae48`；xopc-platform `cc698e5b177b9bae01e4707cc002e397979739fb`。核查包括当时工作区；已有的无关未提交改动不属于本方案。

本文中的新配置、接口、目录和数据表均为拟议设计，不表示当前版本已经支持。开源驱动与云模型经过文档和部分源码核查，尚未进行本机桌面实测、付费模型评测或打包认证。

## 1. 结论与设计原则

目标是在现有 xopc 内提供高质量、可观察、可停止、可验证的 Computer Use，覆盖用户授权的桌面应用及跨应用任务。产品质量以真实任务成功率和安全边界衡量，不以鼠标动画、工具调用成功或单项 grounding 分数衡量。

核心决策：

1. **一个任务循环**：任务、计划、上下文和最终结果继续由 xopc Agent 管理；GUI 模型是单步动作预测器，不另建完整 Agent。
2. **BYOK 与平台模型并列**：本地 xopc 可以直接调用用户模型服务，无需平台账号；平台网关是可选模型入口。
3. **执行归端、授权归端**：目标设备上的 Desktop Broker 持有系统权限、执行锁、授权和紧急停止；云端不能单方面授予桌面权限。
4. **复用现有通信**：复用 endpoint-tools 和 realtime，增加可信桌面契约，不建设新的远控协议。
5. **只引入一个生产驱动**：优先验证 Cua Driver，通过自有薄适配层使用；不引入 Cua Agent、Fleet 和云桌面全栈。open-computer-use 只作对照验证。
6. **结构化优先**：业务 API / MCP → 浏览器 DOM → 桌面 Accessibility / UIA → 截图坐标；路径选择始终服从同一任务授权。
7. **逐步闭环**：每次最多一个有副作用的动作，随后观察和验证；不盲跑坐标序列。
8. **图像短期使用**：截图不进入普通附件库、默认聊天 transcript、记忆或训练数据；使用短期内存数据通道。
9. **不静默扩大范围**：不得静默换设备、换模型供应商、从 BYOK 切平台计费、从后台切前台或从 GUI 切任意命令执行。
10. **小规模上线**：先完成本地有人监督的桌面闭环，再扩展组织治理、远程调度和隔离云桌面。全程不自部署模型推理。

架构面向 macOS 与 Windows；首个发布平台由目标用户分布决定。没有用户分布数据时，默认先在当前 macOS 环境做工程验证，但不据此推断 Windows 可以忽略。

## 2. 当前代码基础与真实缺口

| 领域 | 已核查的实现 | 需要补齐 |
|---|---|---|
| 浏览器 | `src/browser/` 已有 BrowserRuntime、Driver、ref/revision 和审批 | 保留，不合并重写成通用桌面运行时 |
| Agent 工具 | `src/agent/tools/factory.ts`、浏览器工具封装 | 注册 `computer_use`；任务级生命周期与暂停 |
| 端点通信 | `packages/endpoint-tools-protocol` v2；`src/endpoint-tools` | 增加可信桌面契约、设备独占、执行授权 |
| 端点宿主 | `web/src/features/endpoint-tools/endpoint-tool-bridge.tsx` 在 React effect 中创建 desktop host | 桌面 host 生命周期移至 Electron 主进程；Web host 仍留在 Web |
| 端点返回 | 通用 external-tools provider 把 JSON 和文件转为文本 | 桌面控制只能经专用工具封装，不直接暴露通用调用入口 |
| 图片传输 | endpoint 上传服务直接写文件；realtime 客户端帧上限 256 KiB | 复用上传授权，新增服务器决定的临时内存存储策略；WS 只传元数据 |
| 凭据 | Provider/ModelRegistry、CredentialResolver；配置/环境变量/认证档案 | 明确模型连接身份，增加安全凭据引用，禁止错误跨连接复用 |
| 会话 | SQLite transcript 为权威；已有 `suspended` 和连接/澄清恢复路径 | 复用暂停基础，增加 computer approval/takeover 原因；不另建聊天历史 |
| 平台 | 模型网关、租户、预算、策略、Fleet 协议 | GUI 模型元数据及适配；实际桌面 runner 接入尚需实现 |
| 托管执行 | platform discovery 中 `managedRuntime=false`、`traceUpload=false` | 不把已存在的 Fleet 协议当作云桌面产品 |

重要区别：descriptor revision 表示工具契约版本；observation revision 表示界面观察版本；二者不能互相替代。

依据：

- [Endpoint tools 现有设计](./endpoint-tools.md)
- [端点宿主](../../../web/src/features/endpoint-tools/endpoint-tool-bridge.tsx)
- [端点调用](../../../src/endpoint-tools/invocation-service.ts)
- [上传存储](../../../src/endpoint-tools/upload-service.ts)
- [通用工具返回](../../../src/agent/external-tools/endpoint-provider.ts)
- [realtime 限额](../../../packages/realtime-protocol/src/index.ts)
- [平台交付边界](../../../../xopc-platform/docs/implementation/staged-delivery.md)

## 3. 首发范围与非目标

### 3.1 首发必须支持

- 本地 Desktop + 本地 Gateway，用户在线监督。
- 个人 BYOK 与平台模型；允许主模型与 GUI 模型分别选择。
- 单任务跨多个已授权应用；每台设备同时只有一个 GUI 执行者。
- 窗口观察、语义定位、坐标点击、文字输入、组合键、滚动；拖拽只在验证过的平台/应用组合启用。
- 会话授权、敏感动作审批、暂停、停止、人工接管、重新观察后恢复。
- 中文输入、IME、Retina/DPI、多显示器坐标以及网络/进程故障的明确处理。
- 最终结果验证、脱敏事件、预算和失败分类。

### 3.2 首发不做

- 自部署、微调或训练模型；模型服务仍由云厂商提供。
- 手机 GUI、无人在场的个人电脑定时任务、多租户共享同一个用户桌面。
- 云桌面池、WebRTC/TURN、完整桌面视频流、自动录屏。
- 通用多 Agent 编排、另一个任务调度平台、任意模型输出代码执行。
- 自动操作验证码、密码管理器、支付确认、系统提权或安全设置。
- 对任意应用承诺后台执行、事务回滚、exactly-once 副作用或绝对防提示注入。

远程 Gateway + 本地 Desktop 是协议可扩展方向，但不是首个发布前提。开启时必须单独说明截图、语义信息及密钥实际经过哪些机器。

## 4. 总体架构与信任边界

```text
用户 / Chat UI
       │
       ▼
xopc Gateway + 现有 Agent
       ├── 已有文件 / API / MCP 工具（任务授权约束内）
       ├── browser_use → 现有 BrowserRuntime
       └── computer_use → ComputerRuntime
                              ├── ModelAdapter → Provider Runtime
                              │                    ├── BYOK → 用户服务
                              │                    └── Platform → 国内云模型
                              └── endpoint-tools v2
                                       │
                              Electron Main / Desktop Broker
                                       ├── 本地授权与执行锁
                                       ├── 紧急停止 / 输入仲裁
                                       └── DriverAdapter → Cua Driver → OS

平台：身份 / 策略 / 预算 / 模型服务 / 允许上传的脱敏审计
```

边界原则：

- 模型及其输出不可信；任何动作都必须经过 schema、目标、授权和执行前校验。
- 浏览器页面、AX 文本、文档、截图和第三方 MCP 返回均为不可信任务数据。
- Gateway 可以申请执行，但 Desktop Broker 才能决定是否向本机注入输入。
- Renderer 只展示状态、发起用户请求，不能持有驱动连接、主密钥或构造有效执行授权。
- 本地 Broker 不是操作系统安全沙箱；同一用户权限下的恶意本地进程不属于它可完全隔离的对象。
- 两个产品仓库共享逻辑契约，不要求相互依赖源码；客户端提供协议版本，平台提供可选能力元数据。

## 5. 组件职责与代码布局

只新增一个共享契约包，其余是现有进程内模块，不新增微服务。

```text
packages/computer-control-contract/src/
  index.ts                     # Zod schemas and public types

src/computer/
  runtime.ts                   # Session and single-step orchestration
  model-adapter.ts              # GUI prediction interface
  adapters/gui-plus.ts          # First model profile
  adapters/structured-tools.ts  # Explicit generic-model opt-in
  policy.ts                    # Gateway-side scope and risk checks
  verification.ts              # Action and goal evidence
  frame-store.ts               # Ephemeral frame storage implementation
  readiness.ts                 # Driver, model, permissions, endpoint checks

src/agent/tools/computer-use-tool.ts
src/gateway/hono/routes/computer.ts
src/storage/sqlite/computer-repository.ts

electron/computer/
  broker.ts                    # Authoritative local state
  endpoint-host.ts             # Main-process endpoint integration
  driver.ts                    # Thin execution interface
  cua-driver.ts                # Private driver connection
  consent.ts                   # Trusted local approval surface
  input-arbiter.ts              # Device lock and human interference

web/src/features/computer/
  settings / task-panel / approval-card / capability-state
```

布局只是模块责任划分，不要求第一天创建大量空文件。模型只有一个时无需引入动态插件系统；驱动只有一个时也无需建立通用驱动市场。

### 5.1 Cua 接入方式

- PoC 使用独立 `cua-driver mcp`，仅在受控环境测试。
- 正式版由签名 xopc Desktop 按 upstream embedded-host 约定管理私有 driver 生命周期；通过同一个适配层调用其受支持的私有 MCP 或 SDK 接口，具体发行方式由签名/TCC 验证决定。
- 不连接用户机器上来源不明的共享 daemon，不把完整 Cua MCP 工具目录直接提供给 Agent。
- 不开启 unrestricted，不自动开放 Cua 的浏览器接管、shell、文件等无关能力。
- 包装公开操作白名单；控制持有键/鼠标按键的生命周期；驱动更新只能在空闲时发生。
- 必须证明 driver stop/cancel 的实际效果；若上游取消仅停止等待，需要 broker 中止私有 worker 并清理输入，验证前不得宣称停止达标。

Cua 提供独立 MCP/SDK 以及宿主权限说明，但这不是 xopc 集成已完成的证明。[Cua Driver](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)

## 6. BYOK、模型路由和凭据

### 6.1 三种模式

| 模式 | 连接与密钥位置 | 图像流向 | 发布范围 |
|---|---|---|---|
| 个人 BYOK | 当前 xopc 运行端 | 当前运行端 → 用户指定服务 | 首发 |
| 平台托管 | xopc 持平台令牌；厂商密钥留在平台 | 当前运行端 → 平台 → 指定厂商 | 首发 |
| 企业 BYOK | 企业管理的网关/secret store | 企业批准的链路 | 后续 |

BYOK 不要求平台注册、不消耗平台模型余额；本地能力授权不会因密钥来源降低。软件商业授权与模型费用是独立产品问题，本方案不预设软件收费策略。

当运行端是远程服务器时，BYOK 密钥属于该运行端，不会因控制台在本机浏览器打开而变成本地密钥。若用户要求密钥和截图都不进入远程 Gateway，必须使用本地执行/推理路由；首发不增加第二个“端侧模型代理”来隐式满足这一要求。

### 6.2 沿用 Provider 注册机制

逻辑上分离：

- Connection：唯一连接 ID、厂商种类、baseUrl、协议、credentialRef、凭据版本、所有者。
- Model：该连接上的 model ID、输入能力、上下文等。
- GUI profile：对应模型版本的 prompt、输出解析和坐标规则。

优先让现有自定义 provider ID 承担 Connection ID，不新增平行的 GUI connection 数据库。用户同一厂商配置两把 Key/两个地址时使用不同连接 ID。厂商种类是预设元数据，不作为凭据唯一索引。

GUI 首发仅处理 API Key 或平台令牌，不把任意第三方订阅 OAuth 视作可调用同等 API。

本地 `models.json` 的自定义模型定义和 catalog 类型需要增加同一个可选 `computerUse` 元数据块（profileId/profileVersion）；GUI 设置页只是编辑/选择这份定义。不存在元数据时，只有用户显式选择已内置的通用 profile 并通过测试才允许使用。用户或远端声明“已验证”不等于 xopc 官方任务评测通过，UI 分别展示声明来源与本地测试结果。

拟议配置片段（合并进现有配置，不是完整可运行文件）：

```json
{
  "agents": {
    "defaults": {
      "models": {
        "computerUse": {
          "primary": "my-dashscope/gui-plus-2026-02-26",
          "fallbacks": []
        }
      },
      "tools": {
        "computer_use": { "mode": "ask", "maxCallsPerTurn": 80 }
      }
    }
  },
  "computer": {
    "enabled": false,
    "driver": "cua",
    "maxActionsPerSession": 80,
    "maxModelRequestsPerSession": 120,
    "maxSessionDurationMs": 900000,
    "idleGrantTtlMs": 300000,
    "frameTtlMs": 120000
  }
}
```

新增 `models.computerUse` 走现有 defaults → agent override 两层解析，override 为 `null` 表示取消专用路由并恢复继承主模型。不是第三套 preset/继承系统。`vision` intent 继续服务普通图像理解，不把 GUI 操作混入已有 vision 路由。

未配置 computerUse 时继承主模型，但必须通过能力检查；不支持时进入 `MODEL_NOT_CAPABLE`，引导选择模型，不能静默选平台模型。GUI fallback 默认空；显式配置的 fallback 仍须匹配已批准的数据目的地和计费来源。

`mode=allow` 只免除普通工具询问，不能免除本地桌面授权、数据流披露和敏感操作审批。

### 6.3 运行时冻结模型绑定

首次授权时冻结 `ResolvedComputerModelBinding`：connectionId、modelId、profileId/profileVersion、规范化目标 origin、凭据引用及版本、费用来源、配置 revision。

- GUI 模型和可能接收界面摘要的主模型都列入数据去向授权。
- 凭据只在请求前解析，不进入模型上下文、工具参数或 endpoint 消息。
- 运行中改地址、换供应商、换配置、撤销凭据，停止后续请求并重新授权；不读一半新配置一半旧配置。
- 不把 GUI 供应商切换藏在通用 Provider fallback 中；ComputerRuntime 显式控制候选。
- 主模型发生通用 fallback 时同样检查其是否将收到 GUI 衍生内容；未授权则暂停。

### 6.4 GUI ModelAdapter

```ts
interface GuiModelAdapter {
  readonly profileId: string;
  readonly version: number;
  predict(input: GuiPredictionInput, signal: AbortSignal): Promise<GuiProposal>;
}

type GuiProposal =
  | { kind: 'action'; action: ComputerAction }
  | { kind: 'complete'; summary: string }
  | { kind: 'needsUser'; reason: string };
```

`predict` 是一次有界预测，不拥有任务队列、用户授权或独立工具循环。输入是当前子目标、必要任务约束、当前观察和有限历史。默认保留最多两张当前任务图像及最近八步的短结构化记录；会话结束清除。

首个适配对象为百炼 `gui-plus-2026-02-26`；使用版本化提示词、严格提取动作 JSON、坐标转换、动作枚举检查和终止/人工协助映射。不执行模型输出的 Python/JS，也不把 `terminate(success)` 直接当作任务成功。[百炼官方接口](https://help.aliyun.com/zh/model-studio/gui-automation)

同一模型可同时担当主模型和 GUI 预测模型，但一次 GUI 预测仍是私有的短请求，不能把完整聊天历史每步发送一遍。

通用多模态模型可选 `structured-tools-v1` profile，通过单个受限动作 schema 输出；只有通过图像、结构化输出及坐标测试后才启用。只支持图片输入不足以认定可用。

Profile 由客户端版本化代码实现，远端 catalog 只能引用已知 profile ID，不能下发可执行解析代码或任意 system prompt。平台和客户端不支持的 profile 版本必须明确拒绝。

### 6.5 凭据存储与自定义地址

- 扩展现有 CredentialResolver，以 credentialRef 接入 OS 凭据库/环境变量/部署 Secret；不单独维护 `computer_api_key`。
- Desktop 默认使用系统保护的存储；若采用 Electron safeStorage，必须检测实际后端，Linux `basic_text` 等弱保护情形不允许静默保存。
- CLI/headless 优先环境变量或 secret file 引用；现有明文档案是兼容来源，UI 标识并提供显式迁移，不宣称现状已加密。
- 迁移采用“新存储写入并读回验证 → 用户确认 → 原档案移除密钥”，不一次性重写用户全部认证配置。
- 在签名宿主与 Gateway 子进程之间复用受保护的本地凭据解析桥；不向模型暴露任意 secret lookup 工具。
- 设置 UI 只在输入时短暂接触原始 Key，不持久化到 localStorage、IndexedDB、状态日志或遥测；保存后只返回 masked metadata。
- 修改 baseUrl 时要求显式确认密钥重新绑定；禁止跨 origin 重定向携带认证头，禁止绕过 TLS 验证。
- HTTPS 为生产默认；企业内网地址允许显式管理员配置。平台代请求必须复用并补强现有 provider URL 出站策略，防止访问元数据服务、环回和未授权私网；本地受信代理允许单独的明确 opt-in。
- Key/额度测试不截图；使用合成图片验证视觉输入和动作协议，测试会产生小额 API 用量，UI 先说明。

## 7. 核心契约

### 7.1 身份与所有权

SessionOwner 来自已认证运行上下文，包含 conversationId、agentId、runId、endpoint principal、endpointId；connected 模式再含 organization/workspace/principal。模型参数不能声明或覆盖这些身份。

Broker 在当前连接上将 session 与已验证的 Gateway 身份绑定。`sessionId` 只是标识，不是授权凭据；桌面 grant 不因模型猜中 sessionId 而成立。

每次 broker 启动生成新的 `brokerEpoch`。断连/接管/撤销产生新的 `controlGeneration`，所有旧观察、迟到预测和未执行动作失效。

### 7.2 观察与坐标

```ts
interface ComputerObservation {
  observationId: string;
  sessionId: string;
  targetId: string;
  brokerEpoch: string;
  controlGeneration: number;
  revision: number;
  capturedAt: number;
  target: {
    applicationIdentity: string;
    processInstanceId: string;
    windowId: string;
    geometryRevision: string;
  };
  semantic?: { nodes: ComputerNode[]; truncated: boolean };
  frame?: {
    fileId: string;
    mimeType: 'image/png' | 'image/jpeg';
    width: number;
    height: number;
    sha256: string;
    imageToWindow: [number, number, number, number, number, number];
  };
  capabilities: ComputerCapabilities;
}
```

这是一组关键字段示意；实现时所有类型由共享 Zod schema 导出。

- applicationIdentity 使用可验证的 bundle ID/可执行文件身份；processInstanceId 包含启动实例信息，不能只依赖可复用 PID。
- 窗口截图是默认观察范围；不默认捕获整块桌面。文件选择框等新窗口必须重新识别并纳入允许的子窗口范围。
- 内部坐标统一为**实际交给模型的图像像素**，原点左上角；模型的 0–1、0–1000 或绝对坐标只在 adapter 处转换。
- `imageToWindow` 是包含缩放、裁剪和 padding 的仿射变换；driver 再把窗口坐标转为 OS 坐标。截图压缩不改变几何；裁剪/缩放必须更新变换。
- AX refs 仅在当前 observation/revision 内有效。不能跨应用、跨窗口或跨会话复用。
- 动作前检查窗口身份、布局 revision、授权、输入 generation；过期或无法证明目标稳定时重拍，不仅依赖图像哈希。
- 多显示器、负坐标、显示器拔插和 DPI 变化在 driver adapter 层处理；无法可靠映射的组合返回 unsupported。

### 7.3 动作与结果

```ts
type ComputerAction =
  | { type: 'click'; target: ElementTarget | PixelTarget; button: 'left' | 'right'; count: 1 | 2 }
  | { type: 'setValue'; target: ElementTarget; value: string }
  | { type: 'typeText'; target: ElementTarget; text: string }
  | { type: 'pressKeys'; keys: string[] }
  | { type: 'scroll'; target: ElementTarget | PixelTarget; dx: number; dy: number }
  | { type: 'drag'; from: PixelTarget; to: PixelTarget }
  | { type: 'wait'; durationMs: number };

interface ActionEnvelope {
  actionId: string;
  sessionId: string;
  targetId: string;
  observationId: string;
  brokerEpoch: string;
  controlGeneration: number;
  grantId: string;
  deadlineAt: number;
  action: ComputerAction;
}

interface ActionReceipt {
  actionId: string;
  dispatch: 'notStarted' | 'started' | 'completed' | 'unknown';
  outcome: 'applied' | 'notApplied' | 'unknown';
  verification: 'semantic' | 'artifact' | 'visual' | 'none';
  observationId?: string;
  errorCode?: string;
}
```

`typeText` 必须存在当前可编辑目标；必要时先通过观察解析当前 focused element。拿不到可靠 ref 的 canvas 输入必须作为已批准的像素/前台特例扩展，不能向未知焦点盲输。输入完整保留空白、换行和 Unicode，不自动 trim，不把末尾换行自动解释为提交；提交是独立动作。

键盘组合按白名单映射，禁止裸 keyDown 留在外部接口。拖拽是一个有界手势并在 finally 释放按键，不承诺中途停止能撤销已经发生的副作用。

不把 unsupported 动作近似替换成另一种副作用：例如三击不能静默变双击，水平滚动不能变垂直滚动。只有目标 driver 确实支持且通过用例验证的动作才能出现在有效 action space 中。

driver 返回成功只证明调用完成。无法验证控件变化时 `outcome=unknown`；完整业务目标另由 verifier 判断，不能用一个通用 `verified=true` 掩盖不同证据强度。

## 8. Agent 工具与端点执行接口

### 8.1 Agent 可见的 `computer_use`

一个工具，动作分为：

| 操作 | 用途 | 限制 |
|---|---|---|
| `open` | 请求目标设备和应用授权 | 目标只是请求，由本地用户批准；无授权不截图 |
| `observe` | 获取当前授权窗口的有限语义摘要 | 默认不把截图返回主 Agent |
| `act` | 对当前 AX/UIA ref 做明确语义操作 | 不允许任意 native handle、命令或脚本 |
| `step` | 对当前子目标进行一次 GUI 模型预测并最多执行一个动作 | Actor 预测像素动作也走相同校验 |
| `close` | 清理当前桌面会话 | 不能借此把业务任务标记成功 |

设备选择和可发现应用列表来自 UI/已授权清单，不对未授权模型公开整机运行应用和窗口标题。sessionId、owner、grantId 的可信绑定由工具封装注入，公开 schema 不允许模型传 `approved=true`、替换 owner 或指定驱动启动参数。

`open` 遇到需要用户授权时返回结构化 pending 并暂停当前 Agent run，不让 endpoint RPC 持续等待几分钟，也不让模型重复请求授权。

### 8.2 内部 endpoint 契约

注册一个内部工具 `desktop.computer.control`，命令为 open/status/observe/act/release 等有界操作。Descriptor：

- kind=desktop，sensitivity=personal，effect=write；这是整组能力的保守上界。
- policyId=`computer.session-scoped`，maxConcurrency=1，idempotent=false，supportsCancellation=true。
- resultKinds=`json,file`；file 只承载服务器批准的临时观察图像。
- confirmation=never 表示不走现有“每个 endpoint 调用弹窗”，绝不表示不需要授权；必须通过 broker 的 session/action 授权。
- requiresForeground=false 只表示 xopc UI 不必一直在前台；目标应用是否允许后台操作由 action delivery policy 单独控制。

在服务端 trusted policy 中对名称、输入输出 schema、字段和版本精确校验。未知工具默认拒绝。EndpointToolProvider 的 search、describe、execute 三条路径都必须屏蔽该内部工具，和 browser.control 一样只允许 ComputerRuntime 包装调用。

复用 endpoint v2 消息结构和 revision 协商，不因新增工具修改协议大版本。旧 Gateway 不认识新 policy 时明确显示“需要升级”，不降级为普通桌面工具。

### 8.3 Desktop host 迁移

- Desktop 的连接、身份、tool registry 和 broker 生命周期由 Electron 主进程持有；Web 模式仍由 React host 管理。
- 现有 Desktop 工具逐步迁至同一个 main-process host，避免同一设备出现两个同时注册的 desktop host。
- Preload 只暴露 setup/status/pause/stop/用户决策等窄接口；不暴露 raw driver call、shell 或任意工具执行。
- 校验 IPC sender、主 frame、来源、schema 和请求关联；远程页面不得获得 approve 或 credential access 能力。
- 授权首选主进程原生对话框或打包的本地可信授权窗口；远程 Gateway UI 的按钮不能单独授予本机高风险控制权。
- 窗口关闭、renderer 崩溃或 UI 不可见：首发默认暂停，不继续暗中操作。重新打开后需用户恢复。

## 9. 单步执行流程

1. 从真实 run context 解析 owner、绑定设备、有效配置及模型来源。
2. 检查 task mode、预算、数据去向授权、模型/驱动 readiness。
3. Broker 检查 grant 和设备独占；读取当前授权窗口状态。
4. 上传观察图像至当前运行端临时内存存储，附带坐标与窗口身份；WS 返回小型元数据。
5. 若是 `act`，校验语义动作；若是 `step`，一次调用 GUI ModelAdapter 得到 proposal。
6. Runtime 校验输出、风险、观察引用与范围；Broker 在实际执行前再次校验。需要审批则暂停，不能先执行再补审批。
7. Broker 记录 actionId 的执行状态，最多执行一个动作，等待可中止的 UI settle。
8. 重新观察，优先检查实际控件值、页面状态或独立文件结果；无法确认就返回 unknown。
9. 写入不含截图和原始输入的动作元数据，给主 Agent 返回最小必要摘要。
10. 主 Agent 根据结果继续子目标、请求用户或验证整个任务完成。

原始截图与 Actor 原始响应只存在于 ComputerRuntime 的私有短期上下文，不能直接作为普通 Agent tool image content 返回，否则现有 transcript 写入链会把它们持久化。对用户原本在聊天里输入的文本仍遵循现有聊天保留规则，不承诺自动清除已有聊天内容。

主 Agent 所见界面文本、文件路径和业务摘要仍可能敏感，也要受数据去向和保留规则控制；“不传截图”不等于“不传界面数据”。

## 10. 授权、审批与任务暂停

### 10.1 三层授权

| 层次 | 授权内容 | 权威位置 |
|---|---|---|
| 系统权限 | Accessibility、Screen Recording 等 | OS，用户在系统 UI 操作 |
| 会话授权 | 哪台设备、哪些应用、前后台模式、数据去向、有效期 | Desktop Broker |
| 动作审批 | 对外发送、删除覆盖、未知副作用等具体动作 | 本地用户决策，由 Broker 消费 |

系统权限不是业务授权；平台组织允许也不等于用户允许控制当前桌面。授权有效集合取企业策略、用户选择、工具策略和 driver 能力的交集。

本地 grant 记录 owner、brokerEpoch、允许目标、delivery mode、授权模型绑定、有效期和控制 generation。grant ID 通过已认证的端点链路关联，令牌不在聊天、日志、URL query 或普通 API 列表中暴露。

授权浏览器应用不自动代表允许所有网站：需要限制网站的任务还绑定 allowed origins，优先交给已有 browser runtime。原生 GUI 路径只有在能可靠读取当前页面来源时才执行该约束；不能验证来源时拒绝，不宣称 app allowlist 等价于域名隔离。文件读写范围同样不因桌面授权自动扩大。

### 10.2 风险分类

- 读取：仍受应用与数据出站授权限制。
- 已知可恢复编辑：当前文档输入、已验证的字段填写等，可在会话范围内执行。
- 外部副作用：发送、发布、提交业务单据、覆盖文件等，必须按具体效果审批。
- 高敏感：支付、系统提权、密码管理器、验证码、安全配置等，首发交给用户操作，不通过放宽一次 approval 执行。
- 未知：无法确认按钮、快捷键或坐标含义时，按需要人工确认处理，不按“普通 click”自动放行。

风险不能只看动作名、按钮文案正则或模型给出的 confidence。Accessibility role、上下文、已批准子目标可提供线索，但通用 GUI 无法证明所有副作用；未验证的应用/控件采用更严格审批，并在产品支持清单中说明。

审批展示具体应用、目标、动作预览和预期效果，不显示笼统的“允许 computer_use”。审批绑定 actionId、规范化动作摘要、目标身份、观察 revision 和 generation，短时有效、单次消费。布局/内容或收件人变化使审批失效。批准后先复核再执行，不自动重用旧坐标。

审批持有的是具体操作允许权，不是可无限复用的批准 token。Browser/API 路径执行同一业务效果时，必须遵守对应连接器的审批，不能用 Computer Use 的会话授权替代。

### 10.3 恢复现有 Agent run

复用已有 `suspended` 状态及澄清/连接恢复流程，新增原因 `computer_approval`、`computer_takeover`、`computer_setup`；不要在当前实现中把显示卡片误认为真正暂停。

需要在 embedded turn 和 Gateway 结束状态聚合处识别 computer pending：

1. 工具结果持久化脱敏 pending 引用。
2. 通过现有挂起机制退出当前 turn，不将 run 标为成功，不继续自动生成其他动作。
3. 用户决策由本地 Broker 校验并保留，本地 IPC 通知 UI；这里不新增 endpoint v2 未定义的任意事件类型。
4. 用户点击继续后走现有 session input 路径恢复；同一 decisionId 只能产生一次恢复输入。
5. 新 runId 通过可信上下文重新绑定 computer session，增加控制 generation；预算仍属于原 computer session，不随 run 重置。
6. 恢复后重新观察，不重放此前模型输出。若审批目标仍完全有效，只允许消费其绑定的具体动作；否则重新审批。

一次决策失败或超时只结束这次 pending，不把客户端断开当作默认批准。

## 11. 执行状态机、互斥和停止

### 11.1 会话状态

```text
pending_authorization ──用户批准──> ready ──执行一步──> running
          │                        ▲                   │
          └──拒绝/超时──> closed    └────步骤完成───────┘

ready / running ──审批或登录──> awaiting_user
ready / running ──暂停、干预、断连──> paused
awaiting_user / paused ──显式继续并重拍──> ready
任何状态 ──停止、撤销、过期、任务结束──> closed
```

会话 closed 有明确 reason（completed/cancelled/denied/expired/error），但 completed 只说明桌面子会话关闭；整个任务成功必须另有结果验证。

图像、授权和设备锁以 Broker/Runtime 的活跃内存状态为准；SQLite 是恢复线索和审计，不是重启后继续控制桌面的依据。

### 11.2 独占与输入仲裁

- 一台用户桌面首发仅有一个 GUI lease，由本地 Broker 持有，不能仅用某个工具的 maxConcurrency 代替。
- 同一个 run 的 GUI 操作串行。多个 parallel tool calls 到来时，最多接受一个，其他返回 `DEVICE_BUSY`，不排长期队列。
- 本机可能有多个 xopc 实例时，通过单用户 broker socket/进程锁保证同一桌面只有一个 xopc 控制者；不依赖 gateway 内存 Map 达成跨进程互斥。
- 无关应用的真实用户活动不必打断可靠的后台语义动作；前台独占模式下用户移动鼠标、键入或切走目标窗口则暂停。
- 用户修改当前被控窗口，即使是后台模式，也使观察失效。无法可靠区分输入来源时保守暂停。
- 浏览器工具若控制同一个用户原生窗口/标签页，应通过共享 target ownership 串行协作；独立隔离的 headless 浏览器不占物理桌面锁。
- “不抢鼠标”仅对已验证的后台动作成立；平台能力、窗口遮挡或焦点条件不满足时拒绝，不能自动切前台。

若 driver 为 Unicode 输入临时使用剪贴板，必须在用户许可的策略下执行；仅在剪贴板仍为本次写入值时恢复原值，不能覆盖期间用户新复制的内容。不能可靠完成保存/恢复的路径拒绝或请求人工，不把整个剪贴板作为观察数据上传。组合键与输入法的 fallback 必须单独测试，不承诺后台 IME 普遍可用。

### 11.3 停止路径

本地热键、托盘和可信控制面板均直接调用 Broker stop，路径不经过模型、平台或 renderer 的任务请求队列。

顺序：关闭输入 gate → 增加 generation/撤销 grant → 丢弃尚未执行的动作 → 中止 Actor/endpoint 请求 → 取消/终止私有 driver worker → 尽力释放 held keys/buttons → 确认 quiescent → 释放设备锁 → 更新 UI/审计。

`tool.cancelled` 只证明上层调用已取消，不能证明原生输入停止。Broker 未确认 quiescent 前禁止分配新 lease；必要时将驱动置为 degraded，要求重启。已发往 OS 的不可中断动作可能完成，不能宣传停止会回滚副作用。

建议验收目标：用户本地触发停止后，P95 在 1 秒内阻止新增输入 dispatch。模型 HTTP 请求是否马上结束不影响该保证。

### 11.4 崩溃、断连和休眠

- 端点连接断开立即关闭本地输入 gate；静默半开连接使用现有实时链路心跳及本地 watchdog，建议 10 秒无活性进入 paused。有效期间仍执行逐动作 deadline 检查。
- 上述 watchdog 是专用 driver 控制会话的本地安全定时器，不是 endpoint interactive handler 中的后台任务轮询。
- Gateway 重启、Broker 重启或 driver 崩溃：失效所有相关 grant，记录未完成动作 outcome=unknown，要求重新授权/观察。
- 系统休眠、锁屏或切换用户：暂停并清除短期帧；不自动解锁，不在唤醒后自动续跑。
- UI 关闭或崩溃：首发暂停。未来“后台任务”必须另走持久 job transport 与明确无人值守授权。

## 12. 幂等、重试与失败恢复

GUI 副作用无法普遍 exactly-once。本设计提供：同一 brokerEpoch/controlGeneration 内，同 actionId 至多开始执行一次；跨重启结果不确定时不自动重放。

- Runtime 在调用前生成稳定 actionId。同一次传输重试复用它，不生成新 actionId。
- Broker 原子登记 `started`；重复 ID 参数一致返回已有 receipt/执行中状态，参数不一致返回冲突。
- 每个 generation 最多 80 个动作，保留全部 actionId 状态直到该 generation 关闭；不在活跃 session 中用 LRU 淘汰去重项。
- 超时、断连或 5xx 发生在输入发出之后，进入 unknown。先观察收件箱/页面结果/文件等证据，不能直接重复提交。
- 模型预测重试本身不产生 GUI 副作用，但可能重复计费。它也受总时间、次数与预算限制。
- `setValue` 等看似可重入的操作也必须先检查现状；不把所有输入事件标记为 idempotent。
- Driver 失败不能自动切另一个 driver，避免不同坐标/输入行为扩大风险。

| 错误 | 自动处理 | 用户可见结果 |
|---|---|---|
| `MODEL_AUTH_FAILED` / 额度不足 | 不切计费来源 | 更新 Key/额度或显式切模型 |
| `MODEL_RATE_LIMITED` / 可重试网络错误 | 遵守 Retry-After，至多两次，计入 deadline | 超限暂停 |
| `MODEL_OUTPUT_INVALID` | 至多一次有界纠错；仍非法则停止此步 | 模型不兼容或需切换 |
| `OBSERVATION_STALE` | 重新观察并重新预测，最多两次 | 持续变化则请求协助 |
| `TARGET_CHANGED` / 用户干预 | 不复用坐标 | paused |
| `BACKGROUND_UNAVAILABLE` | 不隐式转前台 | 请求前台独占许可 |
| `ACTION_OUTCOME_UNKNOWN` | 不重放，只查询状态 | 需要确认/恢复 |
| `DEVICE_BUSY` | 不自动抢占、不长期排队 | 显示当前任务 |
| `PERMISSION_REVOKED` | 关闭 gate | 权限引导 |
| `FRAME_EXPIRED` / 内存不足 | 重拍或背压；不读旧帧 | 暂停或重新观察 |
| 连续三步无进展 | 不继续点击同位置 | 重新规划或请求用户 |

无进展检测组合使用 action signature、语义变化和结果证据；图像哈希会受动画、时钟影响，不能单独作为完成/进展判断。

## 13. 截图传输、隐私和保留

### 13.1 复用 HTTP 上传，不扩大 WS 帧

当前 realtime 入站帧限额为 256 KiB，禁止把 base64 截图放进 tool.result JSON 或扩大全局帧大小来规避。

修改 EndpointUploadService，使服务端 trusted tool policy 决定 storage profile：

- 现有工具继续 `durable-file`，保留当前行为。
- `desktop.computer.control` 观察结果使用 `ephemeral-image`，只存内存。
- grant 仍由 InvocationService 签发，限定 invocation/endpoint/有效期/尺寸；增加内部 session owner 范围，不接受客户端选择 storage mode。
- 复用现有 `/api/endpoint-tools/invocations/:invocationId/files`，但读取请求体前先验证 grant，并使用该 grant 的真实限额，而不是统一 25 MiB。
- 返回现有 file 元数据形状，由专用 ComputerRuntime 消费；不能通过通用文件下载/附件 API 暴露临时帧。
- 扩展现有 storage interface 为 discriminated storage，而非伪造文件 path；durable 路径的行为必须回归测试。

### 13.2 图像限制

建议初始上限，需在 PoC 中根据准确率调整：

- 单帧编码后 ≤5 MiB；解码像素 ≤16 MP；PNG/JPEG MIME 与实际文件头一致。
- 每会话最多保留两张原始观察帧及有界的模型转换副本；每会话编码图像缓冲上限 32 MiB。
- Gateway 全局编码图像缓冲上限 128 MiB；超限拒绝/背压，不删除正在使用的帧。清除无需保留的旧帧后重试。
- 编码预算不等于进程 RSS。解码/转换单独控制并发和 scratch memory：首发每进程一个转换任务，scratch 预算 128 MiB；16 MP 的单 RGBA 位图约 64 MiB，转换不能无限复制或保留解码缓存。Broker 捕获进程也要独立做峰值内存验收。
- TTL 默认 120 秒，运行中的读取用有界 pin；step 总 deadline 结束必须释放，不能无限续期。
- 上传 URL token 不进 query/log；HTTPS、no-store；本地 loopback 情形依然需要已有认证与 grant。
- MIME 检测、像素数、读取超时、解码器资源上限和并发都需限制，防止压缩炸弹及慢请求。

图片处理不固定强制低分辨率。默认窗口图像，必要时使用局部高分辨率裁剪；每次转换保留坐标映射。被遮罩区域禁止定位执行，避免模型在不可见内容上猜测点击。

### 13.3 数据生命周期

| 数据 | 默认存储 | 生命周期/披露 |
|---|---|---|
| 原始窗口图像 | Broker/Gateway 内存 | 当前两帧、TTL、停止后清除 |
| Actor 提示词与原始响应 | 请求内存 | 仅当前短期上下文，不进入普通日志 |
| AX 全树/输入明文 | 当前调用内存 | 最小化提取，不默认落盘 |
| Chat 中必要摘要 | 现有 transcript | 按聊天设置保留；用户知情 |
| 动作元数据 | SQLite | 默认 30 天可配，停止不删除审计 |
| 用户主动保存的结果 | 正常文件/附件 | 按用户文件规则 |
| 调试轨迹 | 默认关闭 | 显式授权、有界、脱敏、独立删除 |
| 厂商接收的数据 | 厂商服务 | 按厂商条款和企业配置；不能保证供应商零留存 |

关闭会话只能删除 xopc 控制范围内的短期数据，不能撤回已发给供应商的请求。应用崩溃转储、操作系统交换区也不是“内存模式”可以完全消除的风险；禁止主动采集含原始内存的支持包。

同意 GUI 模型上传截图不自动允许上传平台遥测。BYOK 模式默认不向平台发送 Computer Use 使用轨迹；connected 组织要求的脱敏审计单独披露。

## 14. 安全威胁模型与不可承诺项

| 威胁 | 控制措施 | 残余边界 |
|---|---|---|
| 页面/文档提示注入 | 数据与指令分层、应用 allowlist、敏感动作审批、禁止扩大范围 | 无法仅靠 prompt 消除语义诱导 |
| 模型伪造 owner/授权 | 上下文注入身份，本地 grant 校验 | 不抵抗已攻陷的本地可信宿主 |
| 窗口替换/PID 复用 | 进程实例、窗口身份、revision、执行前核查 | 执行与 UI 变化仍存在 TOCTOU 窗口 |
| 任意代码/工具绕过 | Computer task mode 的工具 allowlist；禁用 raw driver MCP、exec 和动态工具安装 | 同用户权限的外部恶意程序不在隔离范围 |
| BYOK 密钥泄露 | 系统保护、引用、日志脱敏、origin 绑定 | 运行端本身必须可信 |
| 跨租户图像/会话读取 | owner 校验、独立 runtime、每资源授权，不凭 UUID 放行 | 个人 Gateway 不能自动升级成多租户服务 |
| 恶意 renderer/远程 UI | 主进程控制、窄 IPC、本地可信审批 | Electron 宿主漏洞需要独立安全维护 |
| 驱动更新/依赖污染 | 锁版本、校验和、签名、公证、SBOM、回滚 | 不保证上游永久兼容 |

### 14.1 Computer task mode

任务进入受控桌面模式时，明确冻结可用工具集合。保留已审计的业务连接器、受限工作区文件操作及 browser/computer 工具；不允许任意 shell、脚本执行、工具安装、配置/凭据读取或把 Cua 重新注册为原始 MCP 绕过代理。

文件能力检查 realpath/symlink 与允许根目录，排除凭据、浏览器 profile 等敏感路径。主模型与 GUI actor 都受同一 run capability envelope 约束。

已有 coding 会话若持有广泛命令执行能力，必须明确标为高信任模式，不能沿用受限桌面模式的安全承诺。首发默认切换为受控模式，或让用户新建受限任务；拒绝仅通过 system prompt 假装隔离。

### 14.2 原生平台边界

- macOS 使用稳定签名宿主归属 TCC 权限，验证安装、升级后权限是否仍有效。
- Windows 运行于用户已登录交互 session；不绕过 UAC，不宣称 Session 0/锁屏可控。
- Linux 后续按 X11/具体 Wayland compositor 分别验证，不能用统一 Linux 开关推定支持。
- 对使用私有 API 的后台注入能力单独标记、可禁用、单独回归；失败时明确拒绝，不静默降级全局输入。
- Cua 的共享 daemon session 授权不能被当作多租户隔离保证；采用 xopc 私有宿主和本地 grant。[相关源码边界](https://github.com/trycua/cua/blob/main/libs/cua-driver/rust/crates/cua-driver-core/src/session_authorization.rs)

## 15. 持久化、审计与恢复

不新增第二套任务、聊天或消息数据库。Gateway 继续使用现有 `xopc.db`；Broker 的真实授权、锁和 action 去重是本进程/epoch 有效状态，重启后全部失效。

拟议两张表：

| 表 | 主要字段 | 不存储 |
|---|---|---|
| `computer_sessions` | id、conversationId、agentId、当前/初始 runId、endpointId、state、reason、model binding 元数据、计数预算、created/closedAt | grant secret、Key、截图、原始目标文档 |
| `computer_actions` | actionId、sessionId、ordinal、action type、target identity、observationId、dispatch/outcome/verification、错误码、耗时、tokens、价格版本、timestamps | 输入文字、完整 AX 树、原始模型响应 |

约束：唯一 `(sessionId, ordinal)` 和 `actionId`；动作状态只前进，不因迟到 result 把 cancelled/unknown 擅自改成已验证成功。迟到实际执行证据可作为独立 reconciliation 信息记录，不恢复权限。

Gateway 在发送动作前写 planned 元数据；receipt 更新实际状态。Broker 内存登记 started 才能调用驱动。任一进程崩溃可能留下不完整链路，恢复时标 unknown 并重新观察，不能声称跨进程原子提交。

Session transcript 仍经现有 embedded turn append 链写入；工具返回只保留最小摘要/引用，禁止另加 turn-end saveMessages。重启后的模型上下文包含“上次结果不确定，先观察”，不从 SQLite 自动恢复可执行 grant。

日志统一使用 `createLogger('ComputerRuntime')` / `ComputerBroker` 等稳定前缀，记录 conversationId/runId/sessionId/actionId/endpointId、phase、耗时、错误码。禁止记录 Key、image base64、输入文本和 URL query。

现有 endpoint 审计会记录参数哈希，不等于内容匿名化：低熵值仍可能被猜测。计算机动作审计优先使用带运行端密钥的摘要或直接只保留 actionId/类型；不要将含业务值的通用哈希转发到平台作为“已脱敏数据”。

## 16. Gateway API 与实时事件

以下是新增本地控制/展示 API，不是新的远控执行协议：

| API | 用途 |
|---|---|
| `GET /api/computer/readiness` | 设备/驱动/权限/模型 readiness，返回结构化问题 |
| `GET /api/computer/sessions/:id` | 当前会话状态与脱敏步骤 |
| `POST /api/computer/sessions/:id/pause` | 请求暂停，幂等 |
| `POST /api/computer/sessions/:id/resume` | 用户显式恢复，重新校验授权 |
| `POST /api/computer/sessions/:id/stop` | 远程 UI 的停止入口；本地紧急停止不依赖此 API |
| `GET /api/computer/sessions/:id/frames/:frameId` | 有权限 UI 的瞬时预览，no-store，帧过期返回 410 |

用户决策走本地可信 consent IPC；Gateway 通过已有 endpoint 请求/结果链执行内部 `status`，读取 Broker 已存决策，作为恢复的权威确认，不能只靠任意 Web client 的 `approved:true`。本地 UI 在得到 IPC 通知后允许用户点继续，Gateway 校验 Broker 状态后再提交去重的恢复输入。不新增孤立的 approval 推送协议，也不把已结束 invocation 的 progress 消息充当授权。

每条路由检查已认证主体对 conversation/session/endpoint 的访问权；frameId 不是 bearer credential。远程预览属于数据披露范围，必须先授权。设置、模型连接测试尽量复用现有配置/Provider API，不另开一套 BYOK 表单后端。

事件经现有 run realtime topic：

- `computer.session.updated`
- `computer.action.started`
- `computer.action.completed`
- `computer.approval.required`
- `computer.takeover.required`
- `computer.observation.available`

事件带 sessionId、ordinal 和 state revision，不带原始图像或输入。订阅恢复读取状态快照后按 revision 合并；不依赖 WS 恰好收到最后一个事件。

新路由必须同步更新 `src/gateway/hono/routes/lazy-bundles.ts` 和匹配测试，并通过真正带认证的 Gateway 路径验证；直接测试 route module 不足以验收。

## 17. xopc-platform 的职责与改动

### 17.1 首发只做模型控制面

平台不持有鼠标控制权，不签发个人电脑授权，不要求个人 BYOK 把密钥上传平台。

模型网关需要：

1. Catalog 增加可选 `computerUse` 元数据：profileId、profileVersion、validatedModelVersion、输入约束、区域、验证状态。验证状态区分 protocol-compatible 与 task-evaluated。
2. 基于已有 chat/responses 通道传图像和文本；保持 base64 data URL 的既有边界，不为 GUI 开放任意 URL 抓取。
3. 对所需供应商参数做显式、类型化映射（例如思考开关）；不允许任意 extra_body 穿透绕过协议校验。
4. XML/text 动作响应保持为模型内容，由 xopc ModelAdapter 解释；网关不执行动作，不复制 GUI loop。
5. 图像请求遵守大小、超时、租户预算和出站地址限制；关闭包含 prompt/image 的调试采样。
6. 用量事件区分 planner 与 GUI actor。平台计费使用真实上游用量，不能重复扣本地预测估算；未知用量需标未知。
7. 模型降级/路由不可将屏幕数据发往未批准的供应商或区域。GUI 绑定要求明确 deployment/version，别名升级需要回归门槛和披露。

平台必须让客户端识别真实路由的受信 deployment ID、供应商/区域集合和 policy revision；对 Computer Use 请求实施该绑定，不能只展示一个平台域名却在背后任意跨厂商 fallback。不支持此约束的模型别名不能进入首发受控 GUI 模型目录。

候选文件：`apps/model-gateway/src/model-capabilities.ts`、`canonical-protocol.ts`、`openai-chat-request.ts`、`pi-ai-upstream.ts`、`provider-catalog.ts` 及对应测试。

### 17.2 后续组织治理

复用已有 workspace policy、预算和审计，不再建立一套 computer RBAC。新增配置仅限：是否允许 Computer Use、允许设备/应用/模型来源、是否允许 BYOK、数据区域、是否允许前台独占、审计保留。

组织管理的运行端要验证策略版本/有效期；离线采用有限期缓存，过期停止新增控制。管理员撤销对离线设备不是瞬时可达，必须在产品中声明离线授权最大存活期。个人 standalone 不受平台不可用影响；托管模型不可达则停在模型调用处。

企业 BYOK 要在独立评审中明确组织/工作区 secret 所有权、加密主密钥轮换、权限、预算和出站策略。现有个人 provider connection 的特定 OAuth 流程不能直接当作通用企业 API Key 托管实现。

### 17.3 远程任务与云桌面

接入 Fleet 时需真正把 worker handler 接到 xopc Agent，并补全进度序号、恢复和取消，而非仅调用现有 started/terminal helper。任务等待本地授权属于 waiting，不是运行成功或无限租约占用。

云桌面作为后续独立 executor 类型：每租户/任务独立环境、网络与文件策略、凭据注入、清理、配额及基础设施生命周期。可以采购国内云桌面服务，不必自建，但不改变“模型推理由云服务提供”的约束。

在真实托管 executor 上线前，继续保持 discovery 的 `managedRuntime=false`。审计上传服务未实现前也保持 `traceUpload=false`，不能只改 capability 标识。

## 18. 产品交互与设置

### 18.1 设置页

新增 `/settings/agent-computer`，包含：

- 当前设备及 Gateway 位置；是否为本地链路。
- Driver 安装版本、签名、系统权限状态和诊断。
- 模型来源：继承主模型 / 已配置 BYOK 连接 / 平台模型。
- 准确的服务地址、区域、计费来源、Key 保存位置和支持等级。
- 合成图测试；尚未通过的自定义模型显示“未验证”，不能显示“已认证”。
- 短期图像与日志策略说明；调试采集默认关闭。

不新建独立 Credentials 页面；复用现有凭据中心和 Provider 选择。应用 allowlist 在首次授权时选择，后续设置可撤销，撤销立即影响进行中的会话。

### 18.2 任务面板

展示当前应用、后台/前台模式、步骤、人类可读状态、最近观察预览、耗时和用量。首发用步骤缩略图，不做连续直播。停止按钮固定可见，且有脱离页面的托盘/热键备用。

UI 状态区分：连接失败、系统权限缺失、模型不可用、正在操作、等待审批、等待接管、已暂停、结果不确定、已完成。不得将 timeout 显示成普通成功。

使用现有语义样式、Skeleton、PopoverSelect；复杂审批面板固定外部尺寸、内部滚动；不另起设计系统。

### 18.3 结果交付

结束摘要至少包括完成/未完成项、验证证据、产物位置、是否仍待用户提交，以及模型用量。只有视觉证据时注明限制。不能声称“已发送”而实际只是填好了草稿。

## 19. 默认资源与性能预算

以下均为初始设计值，不是上游服务 SLA 或实测结果：

| 项目 | 默认值 | 说明 |
|---|---|---|
| 单设备 GUI 并发 | 1 | 授权、驱动、原生输入共享锁 |
| 每 session 动作预算 | 80 | 跨恢复累计；达到后需要显式追加预算 |
| 每 session 模型请求预算 | 120 | 包含纠错和重试；失败不免费重置计数 |
| 总 session 时长 | 15 分钟 | 挂起时计总授权时长，计算费用仍按实际请求 |
| 空闲 grant 时长 | 5 分钟 | 到期后重授权，不自动续期 |
| 观察/截图 deadline | 10 秒 | 到期不得使用半成品 |
| 原生动作 deadline | 10 秒 | 超时副作用按 unknown 处理 |
| 单次模型请求 | 45 秒 | 重试必须受整个 step deadline 约束 |
| step 总 deadline | 120 秒 | 最多一个副作用动作；审批不占用这个等待窗口 |
| GUI endpoint 单调用 | 20 秒 | 只做有界本地操作，模型调用留在 Runtime |
| 本地安全 watchdog | 10 秒 | 静默断连失效；显式断连立即暂停 |
| 无进展阈值 | 3 步 | 请求重新规划/用户协助 |

timeout 从外到内递减，确保外层不会长期失去控制。等待 UI 变化优先监听/短轮询条件，禁止用固定长 sleep 替代状态检查。

优化顺序：减少不必要动作和全屏截图 → 减少发送的历史 → 使用结构化元素 → 减少重复预测 → 再考虑模型切换。不得为了延迟跳过执行前校验和关键结果验证。

BYOK 费用用已知的用户价格配置估算并标记价格版本；未知时展示 tokens 和“费用未知”。成本评估分母为成功任务数，包含失败重试费用。

## 20. 测试、评测与发布门槛

### 20.1 分层测试

1. 契约测试：strict schema、未知字段、错误协议/profile、owner 注入、input/output 上限。
2. 单元测试：每种模型动作解析、Unicode、坐标变换、ref 过期、审批消费、幂等、成本统计、frame TTL。
3. 性质测试：随机窗口位置/DPI/裁剪的往返坐标误差；超界/NaN/Infinity；随机事件顺序不允许 revoked → executable。
4. 集成测试：Gateway 认证 + lazy route + endpoint v2 + transient upload + Broker；无模型即可测。
5. 原生 E2E：目标应用实际状态、非目标窗口输入泄漏、焦点/鼠标副作用、IME、截图权限与签名升级。
6. 模型回归：固定合成/授权截图及子目标，对比解析有效率、定位、动作合法性；与真实任务评测分开。
7. 端到端：真实应用与最终结果，不把 fixture 自报状态当作第三方应用通过证明。

必须包含的故障注入：模型晚返回后用户已停止、点击提交后丢失响应、driver 挂起、Gateway/Broker 重启、断网半开、renderer crash、重复 approve/resume、设备改绑、锁屏/唤醒、撤销 TCC、窗口关闭后复用 PID、修改 baseUrl、跨租户 frameId、超限图片、供应商 429/401、通用工具绕过。

### 20.2 首轮任务集

建议 60 个任务 × 3 次独立运行：20 个浏览器/原生对话框任务，25 个桌面编辑任务，15 个跨应用任务。覆盖实际面向的 WPS、飞书、浏览器及企业软件；操作真实外部系统时使用测试账号和可清理数据。

每任务固定初始状态、应用版本、OS、分辨率、目标结果、允许人工帮助、最多步骤和费用上限。保存脱敏结果；原始录屏只有单独明确授权时采集。

与 Codex 做同环境、同任务、同预算规则的配对比较，记录其版本/日期。无法复现的演示不纳入分母。开源基准作为补充，不将不同 OSWorld 设置或不同模型版本分数直接混排。

### 20.3 指标

| 指标 | 统计要求 |
|---|---|
| 无人工帮助成功率 | 按应用/任务类别分层；同时报告分子分母和区间 |
| 辅助完成率 | 登录/验证码等预设帮助与额外纠错分别统计 |
| 错误宣告成功 | 必须通过独立结果验收识别 |
| 未授权/错误窗口副作用 | 单独列严重事件，不能被平均成功率掩盖 |
| 停止响应 | 测本地 gate/原生 dispatch，不只测 UI 按钮变化 |
| 用时 | P50/P95，包含重试与人工等待的口径分别列出 |
| 成本 | 每个成功任务总模型成本，标注未知价格 |
| 可恢复性 | 故障后安全恢复/请求协助比例，不奖励盲重试 |

首轮 beta 建议门槛：声明支持的任务成功率 ≥90%；安全测试零未授权输入、零已知重复提交；停止阻止新增输入 P95 ≤1 秒；所有 unknown 均被正确显示；持久存储、日志、支持包中没有未经允许的截图/Key/Actor 输入。

90% 是产品目标而非统计认证，少量任务零安全事故也不能证明风险为零。若未达标，缩小支持应用/动作范围或保留人工审批，不以降低安全门槛换取完成率。

## 21. 分阶段实施与验收包

### P0：可行性与驱动选择

交付：受控验证程序、两种驱动的对照记录、一个 GUI 云模型的 BYOK 调用、坐标/中文输入/停止/签名测试、原始任务集。

通过条件：证明目标应用真实可控、输入不泄漏、可停止、模型动作格式稳定、Cua 私有宿主可打包。模型 API 账户/Key 由用户提供，不代开通付费服务。PoC 只能使用受控测试数据，不能先开放个人主桌面再补安全。

如果 Cua 无法通过宿主或停止门槛，再评估 open-computer-use；选择依据是验收结果，不是提前维护两个生产后端。

### P1：首个本地 beta

按依赖顺序拆分：

| 实施包 | 主要工作 | 验收 |
|---|---|---|
| A. 共享契约 | computer-control-contract、状态/错误/坐标 schemas | 契约与性质测试 |
| B. 主进程宿主 | Desktop host 迁移、Cua adapter、IPC、签名/TCC | renderer 刷新不失控、用户停止生效 |
| C. 授权与执行 | grant、设备锁、generation、action 去重、风险策略 | 越权/重复/迟到结果均拒绝 |
| D. 图像内存链路 | upload storage profile、限额、TTL、预览所有权 | 无截图落盘、越权不可读、内存有界 |
| E. 模型与 BYOK | 配置解析、凭据引用、GUI profile、预算 | 无平台账号可用，密钥/路由不混用 |
| F. Agent 闭环 | computer_use、单步 loop、验证、suspended/resume、受控工具集 | 可安全完成和恢复端到端任务 |
| G. 产品界面 | setup、任务面板、审批/接管、诊断、国际化 | 完整首次使用与故障体验 |
| H. 发布 | 支持矩阵、E2E、签名包、锁版本、回滚 | 目标平台/应用达到 beta 门槛 |

B/C/D 是安全基础，不能为了先演示而跳过。E 可以与驱动验证在工程上独立开发，但最终必须在同一运行链验收。

### P2：平台模型与组织接入

为首发平台托管模式补齐 GUI catalog、参数映射、用量与数据路由；个人 BYOK 不依赖这条路径。随后加入组织策略、治理审计和企业 BYOK。按 workspace 做灰度，客户端与 model profile/driver 版本配套回归。

产品发布可以先交付 P1 的个人 BYOK beta；若首发承诺同时提供平台模型，则 P2 中模型网关部分是同一发布的前置门槛，不能作为尚未实现的功能宣传。

### P3：多平台与远程执行

扩展第二个 OS 的支持矩阵；再接远程 Gateway/Fleet 和隔离 executor。每项单独验收，不把 Linux/移动端协议枚举当作功能已支持。

### 版本与回滚

- Computer Use 默认关闭；按用户/组织/OS/应用范围启用。
- Driver 二进制 pin 具体版本与校验和，发布记录同时关联 adapter、profile 和任务集版本。
- 运行中不更新 driver 或 model profile。灰度失败停止新会话，活跃会话按原版本结束或安全关闭。
- 保留可用的上一签名版本与适配代码；平台模型不可用不自动切 BYOK/其他供应商。
- 数据迁移遵循现有 SQLite 迁移编号与备份流程，实施时选下一可用编号，不在设计中固定。

## 22. 开源方案采用边界

| 项目 | 本方案定位 | 不采用的部分 |
|---|---|---|
| Cua Driver | 第一生产驱动验证候选 | Agent、Fleet、默认共享 daemon、无关工具 |
| open-computer-use | PoC 对照和局部实现参考 | 不直接继承其安全承诺；不默认开启私有 SPI |
| UI-TARS / Desktop | 模型动作适配和 UX 参考 | 不替换 xopc Agent / Electron 产品 |
| Mobile-Agent / GUI-Owl | 国内托管模型路线与跨平台研究参考 | 不嵌套多 Agent 编排 |
| OpenCUA | 评测与轨迹方法；未来有合适托管再考虑模型 | 自部署推理/训练 |
| ShowUI | 未来有明确定位成本收益再评估 | 首发增加专用小模型服务 |
| UFO | Windows UIA/API 混合操作参考 | Galaxy/DAG 调度全栈 |
| Bytebot | 容器桌面 UX 参考，核查时仓库已归档 | 新产品核心依赖 |
| OOTB | 实验参考 | 生产远控和权限边界 |

采用前检查具体版本 LICENSE、权重 license、第三方依赖、打包资源、签名和商标。MIT/Apache 的仓库标签不能替代依赖审计；不复制来源不清的官方私有素材或依赖逆向得到的闭源资产。

## 23. 待验证项与决策默认值

| 问题 | 当前默认 | 何时改变 |
|---|---|---|
| 第一发布 OS | macOS 工程验证；发布按用户分布 | 产品确认目标用户后 |
| 驱动 | Cua Driver | P0 签名/可靠性/停止门槛不通过 |
| GUI 模型 | GUI-Plus 托管 API | 实测质量、延迟、成本或供应条件不达标 |
| UI-TARS 托管 | 第二供应商候选，不承诺具体 API 可用 | 验证账号开通、型号和生命周期后 |
| BYOK | 首发必选能力 | 不取消；企业可通过组织策略限制 |
| 图像长期保留 | 关闭 | 仅用户明确开启调试/导出 |
| 后台操作 | 仅允许已验证 action/app 组合 | 支持矩阵扩展后 |
| 无人值守 | 首发关闭 | 独立 job/隔离环境/授权评审完成后 |
| 本机多个 Gateway | 一个桌面 Broker 控制者 | 有真实多工作区需求再扩展仲裁 |

本设计不依赖以上未决项才能开始 P0；上线范围和“达到 Codex 质量”的结论则必须等待实测。预计工期应在 P0 完成后依据现有团队人数、签名发布条件和目标 OS 估算，避免把原生兼容性工作虚化成固定天数。

## 24. 参考资料

仓库代码是当前实现证据；外部资料是候选能力证据，不是本项目已通过验证的结果。

- [Cua Driver 独立接入与权限归属](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)
- [Cua 平台支持矩阵](https://cua.ai/docs/reference/cua-driver/platform-support)
- [Cua 会话授权实现](https://github.com/trycua/cua/blob/main/libs/cua-driver/rust/crates/cua-driver-core/src/session_authorization.rs)
- [open-computer-use 安全边界](https://github.com/iFurySt/open-codex-computer-use/blob/main/docs/SECURITY.md)
- [open-computer-use 架构](https://github.com/iFurySt/open-codex-computer-use/blob/main/docs/ARCHITECTURE.md)
- [百炼 GUI-Plus](https://help.aliyun.com/zh/model-studio/gui-automation)
- [Mobile-Agent](https://github.com/X-PLUG/MobileAgent)
- [UI-TARS](https://github.com/bytedance/UI-TARS)
- [UI-TARS Desktop](https://github.com/bytedance/UI-TARS-desktop)
- [OpenCUA](https://github.com/xlang-ai/OpenCUA)
- [ShowUI](https://github.com/showlab/ShowUI)
- [UFO](https://github.com/microsoft/UFO)
- [Bytebot](https://github.com/bytebot-ai/bytebot)
- [Computer Use OOTB](https://github.com/showlab/computer_use_ootb)

最终持有的核心资产是：薄而稳定的执行契约、可信授权与恢复规则、可复现的真实任务评测。模型与驱动可以替换，这三项应由 xopc 自己掌握。
