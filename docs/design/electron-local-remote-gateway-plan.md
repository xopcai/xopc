# Electron 兼容本地与远程 Gateway 改造方案

日期：2026-10-30；本次修订：2026-10-31

状态：P0/P1（PR #38）、S0/S1（PR #39）及 S2（PR #40，`3f86a8af2`）已合并。基于该 main 的 S3 已在新 worktree 完成纯文本远端聊天、业务提示隔离及恢复；合并前复核后949项相关测试、10组开发E2E与两轮原预算对照通过，见[S3记录](./electron-gateway-s3-report.md)。S4/S5完整产物/独立服务器/跨平台/长期验收及远端Host仍待推进，不代表完整P2a-1发布。

目标：同一份 Electron 安装包支持本地 Gateway 和远程 Gateway，并让远端 Agent 按授权使用运行 Electron 的电脑。

实施进展（2026-10-30）：已在独立 worktree 完成本轮 macOS 本地连接 P0 测量/依赖盘点与 P1 实现，见[阶段报告](./electron-connection-p0-p1-report.md)和[依赖盘点](./electron-connection-p0-inventory.md)。远程 P2、签名安装包、跨平台与长期运行门槛仍未验收。

Review 更新（2026-10-31）：已修复重启竞态、复用归属和停止未确认的处理，强化验收环境隔离/并发保护。426 项测试与两种模式的最终 E2E 通过；同脚本配对的 8 项性能比较通过，历史两次边缘超标记录保留，不能解读为所有批次或长期稳定性已保证。详见阶段报告的 review 章节和原始证据。

本次设计评审修订：P2a 拆成远端聊天（P2a-1）与本机只读预览（P2a-2）；补齐以下五项发布前置约束。PR #38 后续 CI 修复及本地验证结果见 PR，不能作为远端或安装包验收结果。

| 约束 | 必须满足的结果 | 详细位置 |
| --- | --- | --- |
| C1：聊天阶段无本机能力 | P2a-1 不登记远端 Desktop Host；远端聊天窗口不能通过 preload、IPC、菜单或自动桥接调用本机能力；主进程执行拒绝 | 4.5、8.1、10.5 A03 |
| C2：只读也独立认证 | P2a-2 开始前完成 desktop 独立设备凭据、最小 scope、本机授权和撤销；不借用 owner 凭据 | 4.2、4.4、9 P2a-2 |
| C3：上游响应不扩展信任 | 明确重定向、Cookie、缓存、下载、CSP、WS 规则；远端内容不得获得可信桌面页权限 | 4.3、10.5 A04–A05 |
| C4：切换隔离覆盖持久状态 | 请求、Cookie、持久缓存、草稿、下载和执行权按身份隔离；清理/停止未确认时中止切换 | 7.6、10.5 A07 |
| C5：安装包是真实验收对象 | 完整安装包、干净目录、真实独立 HTTPS/WSS Gateway、故障注入和升级组合都通过；开发运行不替代安装包验收 | 9 P2a-1、10.5 A01/A08–A10 |

## 1. 核心决策

1. Gateway 继续拥有 Agent、会话、记忆、自动化、模型和服务端工作区。Electron 拥有桌面 UI、本机身份、本机授权和本机执行器。
2. 本地和远程模式复用同一套 API、Realtime、Endpoint 工具协议；区别集中在连接配置和 Gateway 生命周期管理。
3. 优先保留现有本地模式：继续加载本地 Gateway 提供的 UI，保留当前同源认证、API、Realtime、启动和恢复链路。本地模式不依赖远程 profile、Shell Server 或远程凭据初始化成功。
4. 远程模式试用随安装包发布的 UI 和仅绑定 loopback 的 Desktop Shell Server，提供静态 UI 和受控 Gateway 转发。它不运行 Agent，不打开 xopc SQLite，不启动第二个 Gateway。Shell Server 是需要原型验证的设计候选，先在远程模式开关后落地；验收未通过不得扩大到本地模式。
5. 本机能力 Host 由 Electron 主进程监督，主动连接选定 Gateway；不依赖聊天页面存活，不要求电脑开放入站端口。耗时执行和大文件处理不得阻塞主进程。
6. 首版支持多个连接配置、一个活动 Gateway。切换连接是完整生命周期操作；暂不支持同一 Electron 同时向多个 Gateway 开放本机能力。
7. 明确区分连接位置、执行位置和资源位置。通过 SSH 转发访问 loopback 的 Gateway 仍然属于远程 Gateway。
8. 远程先独立完成 P2a-1 聊天链路，禁止本机能力；再在独立设备凭据、本机授权和撤销已完成的 P2a-2 开放逐项核实的只读能力。任何本机写操作、剪贴板修改、应用启动、键鼠控制和命令执行，均须通过 P2b 的执行状态、停止确认和防重复执行验收后才开放。
9. 不承诺远程模式与同机通信具有相同可用性，也不预设当前版本已经达到某个稳定性指标。目标是以实测证明本地无明显回归；远程故障时目标设备正确、状态可信、恢复可控。

## 2. 已有基础与实际缺口

以下结论来自当前仓库源代码。代码图 MCP 工具在本次会话不可用，使用文件读取与文本检索核对。

| 已有模块 | 可以复用的能力 | 当前限制 |
| --- | --- | --- |
| `electron/main.ts`、`gateway-process.ts`、`gateway/local-connection.ts` | 启动、探测、复用、停止本地 Gateway，启动失败恢复；P1 已提供 local-only 描述、epoch、归属和 port/token 适配 | 尚无远程连接管理器、持久 profile 或 Shell；页面仍加载本地 Gateway URL |
| `electron/computer/desktop-host.ts` | 签名设备身份、safeStorage、工具注册、Realtime、文件上传、ComputerBroker | HTTP/WS 地址固定 loopback，兼容检查绑定本地连接 |
| `packages/endpoint-tools-protocol` | Endpoint v2、工具描述、调用、回执、进度、结果、取消、上传授权 | 不包含通用本机目录工作区和命令执行工具；不应误认为已有离线任务恢复协议 |
| `packages/endpoint-tools-client` | HostController、Registry、权限/确认和执行生命周期；桌面文件、剪贴板、通知等工具 | 当前桌面文件工具主要是用户选择与保存文本；大文件与目录编辑需扩展 |
| `packages/realtime-protocol`、`packages/realtime-client` | 一次性 ticket、长连接、topic、游标及重连机制 | 当前服务端 ticket 路由要求协议版本严格相等，不能直接宣称支持跨协议版本互通 |
| `src/endpoint-tools/` | 注册、调用、绑定、授权、目标解析、上传、审计 | 会话绑定 endpointId；桌面 Host 每次连接生命周期生成的 endpointId 不能当长期设备身份 |
| `web/src/lib/url.ts`、`fetch.ts`、`stores/gateway-store.ts` | 同源 API、Cookie 登录、401 屏障 | API 使用 window.location.origin，认证已是 browser-session Cookie；不是简单修改 baseUrl 即可 |
| `electron/ipc/trusted-renderer.ts`、`navigation-policy.ts` | IPC 来源检查、页面导航边界 | 当前 loopback 判定不能作为新 Shell Server 唯一授权条件 |
| `electron/ipc/terminal-ipc.ts` | 本机 PTY 和终端输出 | 从 Gateway 读取 effectiveWorkspacePath 后在本机使用，隐含同机前提 |
| `electron/ipc/file-resource-path.ts`、`file-ipc.ts` | 打开、预览、编辑和监听本机文件 | Gateway 返回的 host-path 默认被当成本机路径，远程模式必须拆开 |
| `electron/browser/browser-host.ts` | 本地嵌入浏览器、独立 partition、页签与下载 | UI 浏览器 Host 不等于已接通 Agent 的 browser.control Endpoint |
| `src/gateway/hono/middleware/auth.ts`、`security/` | owner 认证、浏览器 Cookie、device token、请求签名及 scopes | Endpoint principal 注册对 device 凭据目前只兼容 mobile/Chrome 身份，不能直接注册 desktop |
| `electron.vite.config.ts`、构建脚本 | UI 与服务端构建流程 | 打包构建会跳过 renderer；远程模式新增安装包 UI 产物时必须匹配版本，并保留原本地 Gateway UI |

## 3. 运行拓扑与双模式行为

```mermaid
flowchart TB
  subgraph Desktop[用户电脑 Electron]
    UI[远程模式：安装包 UI]
    S[Desktop Shell Server]
    C[连接与凭据管理]
    H[Desktop Endpoint Host]
    E[文件 / Computer Use / 后续终端和浏览器]
    UI <-->|同源 HTTP / WS| S
    UI <-->|受控 IPC| C
    C --> S
    C --> H
    H <--> E
  end
  subgraph Selected[远端 Gateway]
    G[REST / Realtime / Endpoint Runtime]
    A[Agent / 会话 / 自动化 / 数据库]
    G <--> A
  end
  S <-->|HTTP(S) / WS(S)| G
  H <-->|HTTP(S) / WS(S)| G
```

上图仅表示新增的远程模式。本地模式仍为 Renderer → 本地 Gateway 的现有同源链路，以及 Desktop Endpoint Host → 本地 Gateway；不会为了统一拓扑增加一跳代理。后续是否统一由独立评审决定。

P2a-1 只有 UI 连接；远端 Host 不启动、不登记、不获取 ticket，也不通过 Renderer 自动创建替代 Host。P2a-2 起 UI 和设备 Host 各自建立 Realtime 连接，复用同一个 RealtimeClient 实现。UI 订阅聊天和状态；Host 注册本机工具和接收调用。不要让 UI 和 Host 同时注册重复的桌面工具。现有 EndpointToolBridge 的 main Host 分支须按模式/阶段启用，不能因远端 main Host 不可用而回退到 Renderer Host。Gateway、Host 与某个能力的健康状态分别判断；一个可选能力失败不能自动导致所有聊天请求失败。

| 行为 | 本地 Gateway | 远程 Gateway |
| --- | --- | --- |
| Gateway 启动 | 探测兼容服务；必要时启动内置子进程 | 只连接配置的服务 |
| UI 与认证 | 保留本地 Gateway UI 和现有 Cookie/IPC 流程 | 安装包 UI，经远程专用 Shell 适配 |
| 配置、数据库、会话 | 由本地 Gateway 管理现有 `~/.xopc` 等路径 | 由远端 Gateway 管理；Electron 不复制或打开远端数据库 |
| Electron 本地状态 | 连接配置、凭据引用、授权、缓存和设备身份 | 相同；按 Gateway/连接隔离 |
| 本机能力 | Endpoint Host 连接本地服务 | P2a-1 禁用；P2a-2 起独立设备身份连接远端服务 |
| Gateway 重启/升级 | 只有 Electron 自己启动的子进程可被本地监督器停止 | 服务端管理 API 或外部运维；界面明确说明目标是远程服务器 |
| Electron 退出 | 停止自己拥有的 Gateway；不终止复用的外部服务 | 断开本机端点，不停止远端 Agent |
| Gateway 不可达 | 展示恢复页并保留桌面设置入口 | 展示重连/认证/网络错误；不自动切回本地 |

连接模型建议分开记录：profileId、显示名、mode、Gateway origin、transport（direct/外部 SSH 转发）、已验证 gatewayId、凭据引用、管理所有权。

- `mode=local` 表示这台电脑上的 Gateway；`mode=remote` 表示逻辑远端服务，与 origin 是否 loopback 无关。
- `ownership=embedded`、`external-local`、`remote` 描述管理归属，不授予停止权；只有持有且核实为自启的 ChildProcess 才能停止进程。不能因为端口相同就认为 Electron 拥有该进程。
- 首版 Gateway URL 只接受 origin，不接受 userinfo、路径前缀、query 或 hash；反向代理需要把 API/WS 放在根路径。路径前缀支持另行设计。
- 直接远程连接要求 HTTPS/WSS；外部 SSH/Tailscale 等访问复用现有网络层。SSH 转发可以使用 loopback HTTP，但必须显式选择远程模式和核验远端身份。
- 不可静默忽略证书错误；不因为 UI 连接失败启动本地 Gateway 来替代远端。

## 4. 远程模式 UI 与认证方案

### 4.1 为什么选择 Desktop Shell Server

当前 UI 的普通 API、Cookie、图片、下载和 Realtime 广泛依赖同源。直接改成 file:// 页面连接远端，会同时引入跨域 Cookie、CORS、媒体认证和 WebSocket Origin 等问题。

建议在远程模式运行轻量 Shell Server：提供安装包静态 UI，将明确允许的 API/资源/WS 路径转发至活动 Gateway。UI 所见 origin 保持本地；上游凭据由主进程持有。普通浏览器和现有本地模式保持原链路。远程 Shell 启动失败时，应有独立于 Shell 的本地恢复入口，允许用户退出远程模式；不得因此阻塞下一次本地启动。

这是新增的桌面基础设施，需要完成下述边界后才能上线，不能实现成接受任意 URL 的通用代理。

### 4.2 两层认证

| 链路 | 建议认证 | 约束 |
| --- | --- | --- |
| Renderer → Shell Server | 本次 Electron 会话专用的短期本地会话 | preload 经可信 IPC 完成一次性 bootstrap，建立 HttpOnly Cookie；不把 Gateway 长期 token 返回 Renderer |
| Shell Server → Gateway | 主进程保管的 owner 管理凭据，后续可扩展受限 UI 会话 | P2a-1 仅提供所有者身份下的受限聊天界面，不开放完整管理控制台；仅按许可路由注入 Authorization，剥离 Renderer 自带认证头 |
| Endpoint Host → Gateway | P2a-1 无此连接；P2a-2 首次开放只读能力前即使用独立 desktop device 凭据 | token 与设备密钥绑定，具备最小 scope、本机授权、请求 proof、刷新和撤销；需扩展 desktop 注册校验。不得临时借用 owner 凭据，UI 的 owner 身份不得隐式替代被撤销的 Host 身份 |
| Realtime | HTTP 认证后签发一次性 ticket | UI 和 Host 各自申请 ticket；不把长期 token 放进 WS URL |
| Endpoint hello | 设备私钥签名 | 复用 nonce、signedAt、connectionInstanceId 与工具描述；hello 签名不能替代 HTTP/ticket 认证 |

Shell Server 的 `/api/browser-session` 需有明确的桌面适配：GET 返回本地已登录状态与公开会话标识；登录通过主进程更新连接凭据；DELETE 销毁本地访问会话并锁定该连接。不得将远端 `__Host-` Cookie 改名降级后透传到本地，也不得将本地 Cookie 转发给远端。浏览器直接访问 Gateway 时，现有 Cookie 流程不变。

远程模式使用新增 bootstrap/连接状态接口，不向 Renderer 返回长期凭据。本地已有 `gateway:get-credential` 和 Cookie 流程暂时保留；若未来迁移，作为单独变更验收，不与远程首发绑定。公开会话标识不能作为认证凭据使用。

### 4.3 Shell Server 必须具备的约束

- 只绑定明确的 loopback 地址和进程拥有的端口。验证精确 Host、Origin、会话和 WS upgrade；不能仅靠“请求来自 localhost”。Cookie 名和会话绑定需要考虑不同 loopback 端口之间 Cookie 不隔离。
- IPC 同时校验登记的 WebContents、发送 frame 和精确 Shell origin；不能让任意 loopback 页面或不可信 iframe 获得本机 API。
- 上游目标只能由连接管理器设置；请求只接受相对路径，防止绝对 URL、路径规范化绕过、重定向和任意主机转发。
- 移除上游 Set-Cookie、本地 Cookie 和客户端伪造的转发认证头；正确处理 Host、Origin 和 WebSocket 握手。只有验证本地请求后才能构造上游 Origin，不能全局关闭 Gateway 校验。
- 支持流式请求/响应、multipart、Range、Content-Disposition、取消和背压；不要全量缓冲截图或媒体。上游断开时终止相关请求。
- 在同源转发路径中只提供可信 API 和受控资源。不可信 HTML、用户生成站点、插件页面与预览必须使用隔离 origin/沙箱并移除桌面 preload，不能变成有本机权限的主界面。
- OAuth、分享链接等必须使用远端的公开回调/分享 origin，不能从本地 Shell Host 推断。现有浏览器会话和 Origin 校验须通过真实链路验收。
- Shell 转发必须有独立的连接池、并发、内存、队列与空闲超时上限。文件/截图流不能挤占控制消息和停止入口；关闭远程模式后连接、流、句柄和缓冲区须在规定期限内回收。
- 主进程只承担连接监督、权限和轻量 IPC。大文件处理与耗时执行放入可监督的工作进程；Shell 出现阻塞、反复崩溃或资源泄漏时先禁用远程路径，不能拖住原本地模式。具体进程边界在 P2a 原型中以压力测试确认。

以下响应与传输策略须在 P2a-1 实现前固化为可测试规则，不能把上游响应当作可信桌面页面：

| 边界 | P2a-1 规则 |
| --- | --- |
| 重定向 | 上游请求默认不自动跟随 3xx，也不把远端 Location 直接导航到 Shell 主窗口。只有列入资源规则的同一已验证上游 origin 跳转可逐跳校验，最多 3 跳；禁止跨源跳转、HTTPS 降级和转发凭据。OAuth/分享等外部导航走单独许可流程，不继承代理认证 |
| 请求和响应头 | Renderer 的 Authorization、Cookie、Host、Origin、Forwarded/X-Forwarded-* 不直接透传；主进程按许可规则构造。剥离上游 Set-Cookie 与 hop-by-hop 头，正确重建 WS upgrade 头；上游不能修改 Shell 会话、CSP 或主页面安全策略 |
| Cookie | Shell 本地会话绑定窗口、profile/epoch 与随机会话身份；Cookie 端口不隔离，须配合精确 Host/Origin 和服务端会话校验。上游 Cookie 不落本机 jar，本地 Cookie 不发上游；会话退出/切换立即失效 |
| 缓存 | 认证 API、ticket、会话 bootstrap 和敏感资源默认 no-store；静态包资产按构建摘要缓存。确需缓存的远端资源须显式列出、按已验证 Gateway 身份隔离且有尺寸/期限上限；不允许 service worker 或 CacheStorage 绕过清理 |
| 资源、下载与预览 | 允许的资源路径/方法/类型逐项列出，不使用整个 `/api/*` 放行。拒绝路径穿越、绝对 URL、MIME 混淆和将远端 HTML 当主界面执行；设置 nosniff。P2a-1 不接入本机文件选择、写盘下载、自动打开/执行文件或回传编辑；允许服务器已有附件的认证展示/流式读取。若后续开放下载，先单独验收用户确认、文件名清洗、路径边界和隔离缓存 |
| CSP 与页面权限 | Shell 仅提供安装包静态 UI，CSP 由包内策略控制；限制脚本、frame 和网络目的地，禁止远端动态脚本、远端顶层页取得 preload。用户 HTML、插件及外部站点隔离 origin/沙箱、无桌面 preload；P2a-1 未适配的预览直接禁用 |
| WebSocket | 仅代理已列出的 Realtime 路径，校验本地会话、Origin、ticket、profile/epoch；上游使用 HTTPS 对应 WSS，限制消息大小、连接数与缓冲。握手失败/重定向不降级，切换关闭两端 socket、丢弃旧消息；不顺带暴露 Endpoint/Computer/Browser 控制通道 |

首版最小路由清单需逐项标明方法、路径、请求/响应类型、认证、大小/超时和所属 UI 场景，包括会话读取/创建、输入 receipt、取消/状态查询、Realtime ticket/WS 和已支持附件资源。必须先核对实际调用，不能把本方案列举的场景当成现有路由名称。owner 凭据并不意味着开放全部设置、更新、远程管理及设备控制路由；未纳入聊天范围的页面/请求明确禁用，待独立评审扩展。

### 4.4 身份与权限隔离

- UI 管理登录和设备 Host 授权分别撤销。撤销设备必须断开 Host；UI 退出至少停止该活动连接上的本机能力和相关本地会话。
- 设备身份按已验证 Gateway identity 隔离保管。初次发现 gatewayId 必须来自认证成功的连接；同 URL 换成另一 Gateway 时重新确认身份，不能静默沿用授权。
- P2a-2 前扩展当前只支持 mobile/Chrome 的 device 注册分支：增加 desktop 平台与公钥归属校验，覆盖 ticket、endpoint principal、上传和撤销全链路。不可仅放宽一个 kind 判断；屏幕、窗口、剪贴板和文件读取都需要明确授权，不能因只读而豁免。
- device.self 当前覆盖较宽的 endpoint 路由族。P2a-2 前逐项检查“只允许自身”的资源归属校验，防止列举、撤销或绑定其他设备；必要时细分 scopes。尚未具备受限设备身份时，保留聊天并禁用整个远端本机能力入口。
- 会话、SWR、Realtime 游标、附件缓存、浏览器 partition、本机授权均按 Gateway/profile 命名空间隔离；清理 UI 的订阅和游标需要显式入口，现有 stopGatewayRealtime 不足以证明所有内存已清空。

### 4.5 P2a-1：远端聊天窗口的本机能力封锁

本阶段允许的 Electron 入口仅为连接管理、会话 bootstrap、公开连接状态、窗口生命周期及独立恢复入口；它们不接受任意路径、命令、设备或上游 URL。连接凭据录入与修改放在主进程控制的独立可信配置窗口，向聊天 Renderer 仅返回公开描述和结果，不复用返回 token 的本地 `gateway:get-credential`。

- 为远端聊天窗口提供受限 preload；既有本地 preload/认证接口保持原行为。主进程逐入口校验登记的 WebContents、顶层 frame、精确 origin、mode、epoch 和能力许可，不以“装了哪个 preload”或 UI 开关作为权限证明；导航/窗口销毁即撤销登记。精确来源校验是远端分支规则，不在本轮顺带改写全部本地信任逻辑。
- 远端窗口拒绝文件读取/写入/选择/监听、host-path、搜索/理解来源、本机 PTY/命令、剪贴板、Computer/截图、Browser 控制、语音采集和现有 intake 等入口；同时审计菜单、快捷键、拖放、深链、MessagePort/订阅和自动启动路径，不能经非 invoke 通道绕过。普通文本编辑不授予应用剪贴板桥接能力；系统媒体权限默认不授予该窗口。
- 不启动远端 Desktop Host、不发布工具、不申请设备执行 claim；阻止 EndpointToolBridge 的 Renderer fallback。服务器 Agent 的工具仍在服务器执行，UI 明示执行位置，不能借本地 IPC 代执行。
- 拒绝必须发生在读取本机路径、创建子进程、建立控制连接或弹出系统权限请求之前，并返回稳定的不可用原因；伪造 Renderer 调用、旧窗口/iframe 和旧 epoch 均需覆盖。
- P2a-1 不包含本机附件上传与写盘下载。先支持纯文本聊天及服务器已有资源；本机文件选择/上传按 P2a-2 的逐项授权能力另验收。禁用相关入口不得影响本地原有文件/PTY/Computer 功能。

## 5. 通信协议复用与扩展边界

### 5.1 首阶段直接复用

下表列出分阶段复用点：P2a-1 仅启用聊天 REST/Realtime 和允许的服务器资源；设备登记、Endpoint、上传和控制协议从 P2a-2 或其标注阶段开始，不能因协议已存在提前开放。

| 用途 | 复用入口/协议 | 需要调整 |
| --- | --- | --- |
| 提交输入、会话、配置、资源 | 现有 Gateway REST 与 gateway-contract、agent-stream-client | 本地直连不变；远程请求经 Shell；请求属于活动连接 epoch，旧响应不能写入新连接状态 |
| 聊天流和 Gateway 事件 | `POST /api/realtime/tickets`、`WS /api/realtime/v1/ws`、RealtimeClient/topics/cursors | 仅远程 UI WS 通过 Shell 转发，保持 upgrade 与 ticket 语义；断线 gap 继续通过现有恢复机制处理 |
| 设备登记（P2a-2 起） | `/api/endpoint-tools/principals`、签名 endpoint hello | P2a-1 禁止登记；P2a-2 前完成 desktop 受限凭据全链路 |
| 本机工具调用 | Endpoint v2 的 `tool.invoke`、`tool.received`、`tool.progress`、`tool.result`、`tool.error`、`tool.cancel`、`tool.cancelled` | 不新增“远程执行 Electron IPC”协议；工具注册保持显式、结构化 |
| 发送来源与执行设备 | EndpointTurnClaim、turn context、会话 binding、DeviceTargetResolver、grant | 保留 turn_origin 与 session_bound 的不同语义；切换/重连后清除旧 claim |
| 文件和截图上传 | uploadGrant + 现有上传 API/EndpointUploadService、frame-upload | Host 直连所选 Gateway；验证上传 grant 的相对路径、归属、期限和尺寸；禁止上传到任意第三方 URL |
| 桌面控制 | computer-control-contract、ComputerBroker、CuaComputerDriver、preview | 本地控制不变；远程 P2a-1 全禁，P2a-2 仅允许经核实无控制副作用且已授权的观察路径，键鼠/控制功能到 P2b 才开放 |
| 浏览器控制（后续） | browser-control-contract 的 `browser.control`、既有浏览器 Endpoint 路径 | 审计浏览器扩展注册/Native Messaging，补本机适配器；EmbeddedBrowserHost 不能直接当成已完成的执行器 |

UI 与 Host 使用各自 clientId；每次 Host 连接使用新的 connectionInstanceId。通用 EndpointToolProvider 当前排除了 computer/browser 工具，这些继续走各自专用控制路径，不重复注册成普通外部工具。

### 5.2 兼容性策略

1. P1 先完成 URL/连接抽象，不改变消息结构、本地默认参数和现有本地认证行为，保持 Endpoint v2 和当前 Realtime 版本。后续可靠性语义若超出现有契约，按独立 capability/协议版本协商，不强行套入旧消息。
2. 现有 assertGatewayCompatibility 将 Computer contract 不一致视为整体不兼容；改为分层检查：UI/API、Realtime、Endpoint、Computer 等各有明确结果。聊天兼容时，可以只禁用不兼容的本机能力。
3. 现有版本检查严格相等。首版支持“协议兼容的构建”，不承诺任意新旧版本兼容。旧 Gateway 缺少必要协议时明确提示升级，不能绕过校验。
4. 新 capability 只能在双方声明后启用。当前 schema 使用 strictObject，不能假设随意加字段仍向后兼容：扩展应使用独立、可协商的 API，或同步升级协议版本和两端实现。
5. 本地 UI 和远端 API 不再随同一次安装天然更新。远程发布前补齐 UI/API capability manifest 或兼容范围检查；旧 Gateway 无 manifest 时只支持验证过的版本组合。
6. 能力降级必须说明范围：例如可聊天，但 Computer Use 不可用；不能把远程不支持的操作偷偷改到本机 Gateway 执行。

### 5.3 后续才新增的能力

| 扩展 | 建议方式 | 所属阶段 |
| --- | --- | --- |
| 本机授权目录与文件读写 | 新 Endpoint 工具描述，使用 workspaceId + 相对路径；本机授权存储和目录边界检查 | P3 |
| 本机命令执行 | 结构化命令/参数、cwd 对应已授权 workspaceId、超时、输出上限与取消；保留本机最终授权 | P3 |
| 交互终端 | 沿用本地 IPC/PTTY；远程终端需独立服务端 PTY 生命周期与流协议，不能用普通工具进度假装字节流 | P3 |
| 稳定设备选择与绑定 | 以 Gateway identity + principalId 表示设备选择，再解析到当前在线 endpoint；不重用旧控制授权；兼容旧 endpointId binding | P2a 具备安全重选/失效行为；P2b 完成长久绑定与重启核实 |
| 最小执行记录与结果核实 | Gateway 操作记录与本机持久执行记录关联，区分未执行、已完成和未知；校验 Agent 更换调用 ID 的重试 | P2b，写能力开放前 |
| 离线等待与后台任务 | 新增可协商的 job/执行凭据与状态查询设计；不自动重播旧调用 | P4，不能替代 P2b 的故障处理 |
| 大文件续传 | 新 transfer capability/API，保留旧上传协议与上限 | P4 |

## 6. 本机资源、工作区与工具路由

### 6.1 资源位置必须进入模型

内部资源引用应携带 location（gateway/endpoint）、gatewayId、必要的 principalId、workspaceId/fileId 和版本信息。具体字段在 P3 契约评审中确定，首版以现有 Gateway fileId 和上传文件快照为主。

- Gateway 的 `/srv/project/a.ts` 是服务器资源；Electron 不能拿它调用本机 fs、shell.openPath、文件监听或 PTY。
- 本机 `/Users/alice/project` 对应本机授权 workspaceId；Agent 通过该设备工具访问。
- 用户挑选并上传的文件是 Gateway 上的一份快照，不自动形成双向同步或回写授权。
- 打开远端文件时，先通过认证下载到本地缓存，再由用户选择应用打开；外部修改默认只影响缓存，回传必须是显式操作，并检查源版本冲突。
- 本地同机模式可保留验证后的 host-path 快捷通道。远程模式，即使连接 URL 是 SSH loopback，也禁用直接 host-path 映射。
- 授权目录需要处理 realpath、symlink、路径穿越和 Windows 路径语义；服务端字符串不能扩展本机目录授权。

### 6.2 执行目标规则

1. Agent 自带 shell/read/write 继续作用于 Gateway 工作区。
2. 本机工具使用明确设备/workspace 目标；工具描述和执行记录显示设备名与位置。
3. file.pick、clipboard.read 等继续按现有 turn_origin 规则定位；会话绑定不能偷偷改变“读取这条消息来源设备”的含义。
4. 自动化、手机和 Telegram 来源没有桌面 turn claim，必须通过明确设备绑定或单次 grant 使用电脑，不选择“最近在线设备”代替授权。
5. 目标离线时不自动改到服务器、另一台电脑或新连接。断线后重新验证原设备身份、连接、授权和工具 revision。

### 6.3 执行依赖位置盘点

在 P2a 之前完成清单，每项写明执行位置、授权边界、依赖路径、网络设置、失效表现和对应验收用例。未明确位置的本机能力不向远程 Agent 宣布可用。

| 依赖 | 需要明确的行为 |
| --- | --- |
| MCP server 与子进程 | 当前 Gateway 配置默认在 Gateway 主机执行；使用电脑上的 MCP 需要明确本机适配和授权，不自动把命令搬到 Electron |
| Skills、脚本、python/git 等命令 | Skill 的工作目录、二进制和文件属于其执行环境；通过设备工具调用本机环境，不能只替换路径 |
| 浏览器扩展/Native Messaging | 本机安装、登记和登录态属于本机；不依赖远端 Gateway 启动时在服务器安装来完成本机接入 |
| STT/TTS、本地语音模型 | 区分本地采集/播放、本机推理与远端推理，识别模型路径、CPU/内存和音频流影响 |
| HTTP/WS 代理、DNS 与证书 | Shell 与 Host 采用明确一致的配置来源；系统代理、企业证书、代理认证和链路变更需要单独验收，不关闭 TLS 校验 |
| OAuth/深链/分享 | 服务器回调、本机回调和应用激活明确分开，不能把 Shell origin 发布给外部服务 |
| 更新与系统密钥存储 | Electron 和 Gateway 更新互不混淆；凭据解密失败时停止该远程连接并提示修复，不重建身份绕过授权 |

首版远程 Gateway 按现有单实例状态归属运行；不承诺负载均衡、无感主从切换或多实例共享运行态。若以后引入，需要单独设计 ticket、端点所有权、调用和 topic 状态的跨实例一致性。

## 7. 生命周期、断线与后台运行

连接状态按两层展示：Gateway 状态（连接/认证/协议/离线）和设备状态（注册/权限/前后台/被撤销/能力可用）。Gateway 在线而 Host 失败时，聊天仍可用。

切换活动 profile 的顺序：冻结新提交并使旧 epoch 失效 → 提示并处理运行中的本机操作 → 取消相关请求和上传 → 核实 ComputerBroker/预览/Host 停止 → 关闭旧 UI WS 和订阅 → 清理 claim、游标、缓存、审批和工作区句柄 → 撤销 Shell 会话并完成持久状态隔离 → 建立新连接与认证、核验 Gateway identity → 重建新窗口 → P2a-2 起按当前能力策略重新登记 Host → 恢复新 Gateway 的界面。P2a-1 的远端连接不启动 Host；从本地切出时仍须核实原本地执行资源已停止。

若本机执行器清理未确认，不得向新 Gateway 开放该执行器。旧请求回调必须检查 profileId/epoch，不能污染新连接。旧远端 Agent 可继续运行，但不能把其尚未完成的请求交给新 Gateway。

| 情况 | 首版行为 |
| --- | --- |
| 窗口最小化/隐藏 | Host 可保持连接；能力 availability 和权限按本机状态更新。现有需要前台的工具仍拒绝后台执行 |
| 电脑休眠或断网 | 端点离线，当前调用失败/取消或结果未知；Gateway 上不依赖该端点的任务继续 |
| 设备重连 | 重新认证、签名 hello、发布工具和新 claim；不重放旧写操作 |
| Gateway 重启 | UI topic 恢复按既有 cursor/gap 机制执行；本机工具状态单独处理 |
| token 失效/设备撤销 | 停止无限重试，清除可用 claim，停止本机操作并展示重新认证/登记入口 |
| Electron 退出 | 关闭 Host 与本地执行资源；只停止自己拥有的本地 Gateway |
| 已发送调用但结果丢失 | 标记结果未知；不能因为没收到结果就推断没执行 |

tool.received 只表示收到调用，不等于动作已完成。写入、发送、删除和点击提交不能宣称跨崩溃 exactly-once。现有审计与外部操作幂等机制可复用，但本机动作和远端记录不在一个事务中。首版采取停止自动重试并核实结果的策略。

P4 才实现明确的“等待某设备上线”任务：必须有目标设备、有效期、授权有效性、取消入口和恢复检查。普通重连机制不承担任务调度。

### 7.1 本地模式保护约束

- 远程开关默认关闭。已有安装不自动启用远程，不重写原 Gateway URL、配置、身份、工作区或数据库，也不强制重新配对。
- 无远程配置时不初始化远程 Shell、远程认证或远程迁移。远程配置损坏、证书错误、密钥解密失败、UI 产物缺失都不能成为本地启动的前置依赖。
- 本地 UI/API/Cookie/Realtime、Computer Use 默认参数保持原行为。必要的公共客户端变化逐项回归；远程超时策略通过模式/协商隔离，不全局修改本地行为。
- 本地/远程切换可以先通过受控窗口重建或应用重启落地，不把无刷新热切换列为首发要求。停止未确认时保持能力不可用，不能为了切换成功而放行。
- 用户显式退出远程并选择本地后走原链路；网络故障不能自动切回本地。关闭远程功能必须无需回滚用户数据库即可恢复本地使用。

### 7.2 超时、时钟与迟到调用

当前实现的回执窗口为 3 秒、桌面上传超时为 15 秒；hello 签名窗口为 60 秒，设备请求 proof 另有时间窗口。工具 deadlineAt、上传授权期限又依赖两台主机的墙上时钟。上述数值是当前实现事实，不是已验证的远程服务承诺。

| 预算 | 必须具备的约束 |
| --- | --- |
| 连接与认证 | DNS/TLS、HTTP、ticket/WS 握手分别可诊断；鉴权失败不无限重试；网络重试有退避和抖动 |
| 接收回执 | 到期只能表示未收到回执，不能断言电脑没收到调用；结束等待后仍须处理迟到调用风险 |
| 等待用户确认 | 与执行耗时分别记录；批准时重新检查任务、期限、连接和授权，迟到批准不可启动过期任务 |
| 执行与停止 | 本机独立计时和监督，不依赖 WS cancel 可达；不可取消操作如实报告停止结果未知 |
| 上传/下载 | 区分无进度超时与总预算，限制尺寸/并发；慢链路失败不把本机动作结果改成“未发生” |
| 心跳与断线 | 检测半开连接并废止执行权；心跳不代表工具有进展；唤醒后先重验身份和状态 |

P2a 测量并记录各预算；P2b 前冻结配置范围和验收环境。不能仅把 3 秒和 15 秒调大。测试必须覆盖“回执超时后 invoke 才到达”“结果先完成但回执丢失”以及本机审批长时间停留。

时长预算使用本机单调计时；跨机期限必须有可信服务器时间偏差估计和误差界限，或改为经协商的有界执行租约。仅从收到消息时开始一个 TTL 会放行早已过期的延迟调用，不可采用。时钟偏差或新鲜度不可确认时停止相关远程能力并提示原因，不能扩大签名窗口或忽略 deadline 来恢复连接。具体字段和协议升级在 P2b 前评审。

### 7.3 写操作执行状态与最小记录（P2b 前置）

Gateway 与本机必须关联稳定的 operationId/意图、Gateway identity、设备 principalId、连接/授权代次、参数摘要、工具 revision 和调用尝试。invocationId 是一次传输尝试，不能单独承担跨重连去重。持久执行记录只存有界元数据和必要结果摘要，不存凭据、完整剪贴板或敏感文件内容。

| 状态 | 含义与允许的恢复 |
| --- | --- |
| 待接收/已接收 | 只表明调度/回执状态，不证明动作发生；执行前仍要验证有效执行权 |
| 已拒绝且确认未执行 | 可在新的有效授权下重新发起；不能将普通异常归为此状态 |
| 执行中 | 已开始外部操作；记录执行权和本机监督信息 |
| 已成功 | 有可信完成证据；相同意图重试应返回既有结果或状态，不能再次执行 |
| 结果未知 | 可能已产生副作用；阻止自动重复写入，进入核实/人工恢复 |

本机在开始外部动作前持久记录意图，完成后记录结果；记录失败则拒绝开始新的写动作。崩溃发生在副作用与结果落盘之间时仍须标记未知，不能宣称 exactly-once。该记录与现有 Gateway capability_operations/调用审计关联，不新增第二份会话 transcript 权威存储。

去重需覆盖网络重发和 Agent 更换 toolCallId/endpoint 后重新尝试同一意图。参数摘要只能辅助检测，不能把用户有意再次操作误判为重复。不能只依靠提示词禁止重试；未核实的相关写操作须在调度/执行层受阻，用户明确确认新意图后才能继续。

当前通用 EndpointToolProvider 已使用外部操作记录和 manual 恢复，但 computer/browser 专用控制路径仍须逐一核对。P2b 前必须展示三条路径的操作记录、未知状态传播、恢复与拒绝重复执行证据。

新增状态/状态查询/执行租约若不能由既有契约完整表达，新增协商能力或升级协议；不得修改 tool.received、tool.cancelled 的旧语义后继续声称旧客户端兼容。

### 7.4 停止确认、执行权和资源隔离

停止分为 stop_requested（请求停止）、stop_confirmed（已核实本机执行器停止）、stop_unknown（不能确认）。现有 HostController 的 AbortSignal 和 tool.cancelled 不能作为底层进程/原生动作已停的证明。断网也可使用的本地停止入口、本机 watchdog 和驱动清理核实，是远程写能力的发布前置条件。

本机执行权至少绑定 Gateway identity、设备、会话、操作及授权/连接代次。保留 ComputerBroker 的 busy、owner、session、generation 检查；相同 Gateway 的多个 Agent、会话和自动化也不能同时控制同一桌面。停止、撤销、重启或控制目标变化后废止旧执行权；用户介入时按既有控制模型暂停并重新观察/授权，不能继续消费旧截图产生的动作。

目录操作和 PTY 以后分别定义并发和锁范围；禁止持有桌面全局锁等待长文件上传。新 Gateway 或新会话不能接管未确认停止的执行器。临时 endpointId 变化不迁移旧控制授权；设备选择可按稳定 principalId 恢复，但执行权必须重新校验。

### 7.5 可观测性与故障恢复

分别记录 UI、Shell、Gateway、Endpoint Host、Computer/文件等能力的健康状态。日志通过 requestId、profileId/epoch、gatewayId、principalId、connectionInstanceId、operationId 和 invocationId 关联；长期凭据、ticket、私钥和完整个人内容不得进入日志。

记录连接建立/恢复耗时、时钟偏差、回执/执行/上传耗时、未知结果、停止未确认、队列与资源用量。只有数据表明可选能力可恢复时才重建该能力；重试次数和频率有界，不做整个应用无限重启。普通网络离线、鉴权失败、协议不兼容和执行器故障须展示不同恢复入口。

### 7.6 切换与持久状态隔离（P2a-1 必须完成）

远端数据命名空间至少包含 profileId 和认证后核验的 gatewayId；运行期请求再绑定 epoch。origin、端口或显示名不能代替身份。同一 URL 返回新 gatewayId 时先锁定连接并提示确认，旧凭据、草稿、授权和缓存不能自动迁移。尚未验证身份的连接只持有隔离的临时 bootstrap 状态，不加载历史远端数据。

| 状态/资源 | 隔离与切换动作 |
| --- | --- |
| Cookie 与 Electron session/partition | 远端使用独立 session/partition，与本地默认 partition 分开；撤销旧 Shell 会话、关闭页面和 sockets，按准确存储键清理认证状态。不全局清 Cookie，不清原本地登录态 |
| HTTP/内存缓存、SWR、Realtime | 停止请求、重连和订阅，清理游标、错误和内存数据；回调必须核对 epoch，迟到响应不得写入新 store。新连接不能继承旧 ticket、receipt 或恢复游标 |
| localStorage/IndexedDB/CacheStorage/service worker | 盘点实际使用者，远端全部有身份命名空间和清理入口；Shell 不注册 service worker，清理遗留注册。连接状态/业务缓存不得落入现有本地键；主题/语言等明确列出的无业务公共偏好可共享 |
| 草稿、当前会话、附件与待提交输入 | 草稿可按身份保留供用户返回原连接后恢复，不能带到新 Gateway；未确认的 POST 不自动重发。旧会话 ID、上传引用、文件选择和审批不能复用 |
| 下载与文件缓存 | P2a-1 不创建写盘下载任务；仍须取消旧资源读取并关闭流。后续任务和临时文件按身份隔离、执行配额/期限清理，不能让旧回调写入新连接目录 |
| 本机授权、控制资源与进程 | 切换前停止并核实原连接的执行资源、句柄和订阅；废止授权代次。不停止外部复用 Gateway，不自动终止服务器 Agent；原本地子进程仅按既有自有句柄规则处理 |

切换协调器只有在旧会话撤销、存储隔离与资源清理都确认后，才激活新连接。清理失败或执行器 stop_unknown 时进入受阻恢复状态：不创建可用的新聊天窗口/执行权，不自动回切或继续使用已失效旧会话；允许重试清理、诊断或退出。不得把指针已更新或窗口已关当作清理成功。

A→B→本地及应用重启/升级后，都验证磁盘状态；回到 A 仅恢复 A 的允许数据，重新认证/核验身份，不恢复旧授权或未确认提交。本地存储保持原布局，远端关闭或目录损坏不触发本地数据迁移。

## 8. 模块改动清单

下列新增路径为建议名称，尚未创建；实现时可按现有目录约定调整。

| 模块 | 需要修改/新增的内容 | 阶段 |
| --- | --- | --- |
| `electron/main.ts`、`gateway-process.ts` | 拆分连接选择与本地监督器；区分进程所有权；统一 startup/recovery/quit；远程不初始化本地 Agent 数据 | P1–P2 |
| 已有 `electron/gateway/local-connection.ts`；新 `connection-manager.ts`、`profiles.ts`、`credentials.ts` | P1 local-only 适配保留；P2a-1 新增远端 origin、身份、凭据、epoch、单活动连接和隔离存储，不提前宣称 P1 已实现远端模型 | P1 已完成；P2a-1 待实施 |
| 新 `electron/shell/server.ts`、`gateway-proxy.ts` | 仅远程模式：静态 UI、bootstrap/会话、受控 HTTP/WS/资源转发、流与取消、独立恢复与资源上限 | P2a |
| `electron/preload.ts`、`web/src/types/electron.d.ts` | 新增远程连接/状态/bootstrap IPC；保留本地原认证接口 | P1–P2a |
| `electron/ipc/trusted-renderer.ts`、`loopback-url.ts`、`navigation-policy.ts` | 远程新增精确 origin + WebContents/frame 信任；预览/外部页隔离；本地旧路径回归 | P2a |
| `electron/gateway-compatibility.ts`、`scripts/verify-electron-gateway-compatibility.mjs` | URL 泛化，按能力分层检查，增加远端版本组合验收 | P1–P2 |
| `electron/computer/desktop-host.ts`、`frame-upload.ts` | P1 保留本地 origin 适配；P2a-1 仅增加远端不启动门禁；P2a-2 起通用连接、HTTPS→WSS、隔离身份和撤销/超时 | P1 / P2a-1 门禁 / P2a-2 |
| 后续拆分 `electron/endpoint/` | 身份、传输、权限、文件、命令等适配器；耗时操作放工作进程，不让重构阻塞 MVP | P3 |
| `web/src/stores/gateway-store.ts`、`lib/fetch.ts`、`lib/url.ts` | 保留本地/浏览器 Cookie；新增远程 bootstrap；命名空间与401/离线区分 | P2a |
| `web/src/features/gateway/`、`stores/gateway-realtime-store.ts` | 仅远程 Shell WS；切换销毁订阅、游标和错误状态，可先重建窗口；保留 topic 恢复 | P2a |
| `web/src/features/endpoint-tools/` | 复用 main Host 分支；清理旧 claim；现有设备管理中显示 Gateway 与执行目标；避免重复 Host | P2–P3 |
| `web/src/features/electron/`、shell/settings/i18n | 连接配置页、模式/位置标签、远程恢复页；本地权限设置与远端 Gateway 设置分开 | P2 |
| `electron/ipc/file-resource-path.ts`、`file-ipc.ts`、`search-ipc.ts`、`understanding-sources-ipc.ts` | 审计所有同机路径假设；远端资源先禁用不成立的操作，再补下载缓存/本机授权目录 | P2–P3 |
| `electron/ipc/terminal-ipc.ts` | 本地模式保留；远程模式禁止使用远端 workspace 启动本地 PTY；P3 增加本机目录映射 | P2–P3 |
| `electron/browser/`、`src/browser/`、`packages/browser-ext/` | 明确服务端浏览器、本机扩展和嵌入浏览器；适配 browser.control 和本地扩展连接 | P3 |
| `electron/ipc/system-settings-ipc.ts`、托盘/更新/语音唤醒等 | 本机系统设置独立于 Gateway；远程状态、后台能力和更新目标明确 | P2–P3 |
| `src/gateway/hono/routes/endpoint-tools.ts`、认证/设备注册/请求 proof/scopes | desktop device 身份登记、受限凭据、归属、撤销和上传；禁止越权管理其他设备 | P2a-2 前完成；P2b 扩展写能力 |
| `src/gateway/hono/routes/endpoint-compatibility.ts`、gateway-contract | UI/API manifest、可选 capability、兼容诊断；保留旧字段语义 | P2 |
| `src/endpoint-tools/target-resolver.ts`、`binding-service.ts`、`grant-service.ts`、`capability-catalog.ts` | 来源与执行设备语义、只读白名单；稳定绑定、离线行为和授权失效前移 | P2a–P2b；P3 扩展 |
| `src/agent/external-tools/endpoint-provider.ts`、computer/browser 专用路径 | P2b 核对并补齐各路径的未知结果/去重与恢复；P3 增加新工具；保留专用控制和操作记录 | P2b–P3 |
| `packages/endpoint-tools-protocol`、`endpoint-tools-client`、control contracts | 既有通信复用；只读过滤、时限/执行权、取消语义和状态核实必要时协商新契约；目录等后续扩展 | P2a–P4 |
| `src/endpoint-tools/invocation-service.ts`、`auth.ts`、`src/capabilities/runtime/external-operations.ts`、本机执行记录 | 迟到回执/调用、时钟偏差、操作状态核实与新调用 ID 重试；关联最小持久记录 | P2a 测量；P2b 写能力前完成 |
| `src/computer/broker.ts`、本机执行器监督 | 保留现有 busy/owner/session/generation；独立 watchdog、停止确认、清理隔离和离线紧急停止 | P2b；P3 各执行器扩展 |
| `src/storage/sqlite/` 设备/绑定/调用仓储 | 新字段或状态确有需要时升级；保留所有支持安装版本的完整迁移链和备份语义 | P2b–P4 |
| `electron.vite.config.ts`、`package.json`、`scripts/electron-builder*`、`prepare-electron-pack-dir.mjs` | P1 原包回归；P2a 新增远程 UI 产物，保留本地 Gateway UI/包；校验 asar 与独立启动 | P1–P2a |
| `docs/gateway/remote.md`、`docs/network.md` 和中英文对应页 | 桌面远程连接、SSH 语义、能力授权、版本兼容和排障 | P2 |

任何新增/移动 Gateway 认证路由都必须同步 lazy-bundles matcher 与正负 mapping 测试，并通过真实、带认证的 Gateway 入口验证。

### 8.1 P2a-1 模块任务与改造边界

以下为本阶段最小任务包；新文件名称可调整，职责与拒绝边界不能省略。所有项目均未实施，不代表已有远端能力。

| 任务 | 模块与交付 | 本地保护/本阶段排除项 | 对应验收 |
| --- | --- | --- | --- |
| M1：连接与存储 | 新 `electron/gateway/connection-manager.ts`、`profiles.ts`、`credentials.ts`、存储隔离协调模块；定义状态机、origin 校验、Gateway 身份核验、epoch、系统安全存储引用、一次切换与恢复 | 复用 P1 `local-connection.ts` 作为本地适配器，不让其接受远端 origin；本地默认、不迁移原配置。凭据无法安全保存时拒绝持久化并提示，不明文回退 | A01/A02/A07 |
| M2：启动与窗口 | `electron/main.ts`、`gateway-process.ts`、启动/恢复/导航模块；先选择 mode，本地走原入口，远端延迟加载 Shell；独立连接配置/恢复窗口，远端窗口绑定 partition、epoch 和受限 preload | 远端不调用本地 Gateway 启动、共享 workspace 初始化或 SQLite 打开；本地不依赖远端资产/配置/密钥。自有停止权限仍取自 ChildProcess | A01/A03/A07/A08 |
| M3：Shell 与转发 | 新 `electron/shell/server.ts`、`gateway-proxy.ts`、路由规则/本地会话模块；包内 UI、一次性 bootstrap、Cookie 适配、允许的 HTTP/WS/资源、取消/背压/配额、主进程监督 | 无通用代理、Agent、SQLite 或会话数据库副本；不透传管理全路由，不接本机下载/上传。不变更本地同源 API/Cookie | A02/A04/A05/A06/A09 |
| M4：IPC 与能力策略 | `electron/preload.ts` 及新增远端受限 preload、`ipc/trusted-renderer.ts`、`navigation-policy.ts`、`web/src/types/electron.d.ts`；主进程按窗口/mode/epoch 执行入口许可；列全 invoke/send/port/订阅和菜单/拖放/深链路径 | 保留本地接口；拒绝远端文件/PTY/Computer/Browser/语音/剪贴板等。`desktop-host.ts` 和 Web EndpointToolBridge 仅加远端不启动/不 fallback 的门禁，不泛化 Host 连接或开放设备工具 | A03/A07 |
| M5：聊天 UI 与恢复 | `web/src/stores/gateway-store.ts`、`gateway-realtime-store.ts`、`lib/fetch.ts`、`lib/url.ts`、`features/gateway/`、`features/chat/`、Electron 连接设置与 i18n；公开 bootstrap、命名空间、401/网络/兼容错误、receipt/游标恢复、服务器执行位置提示 | 普通浏览器和本地 Cookie 流程不变；远端禁用本机工具、路径打开、设备绑定和未纳入代理范围页面。取消仅表示取消请求状态，不虚报远端 Agent 已停止；不自动重发输入 | A02/A03/A06/A07/A09 |
| M6：兼容与身份 | `electron/gateway-compatibility.ts`、验证脚本、`packages/gateway-contract` 和 Gateway 对应兼容路由（确需时）；列出聊天 REST/Realtime 能力及已验证版本组合、认证后身份来源；诊断 Computer 不兼容但聊天可用 | 新增分层结果用于远端，不趁机改变本地 strict 兼容行为。无身份或必要契约的旧 Gateway 明确拒绝/提示升级；不增加 desktop 注册/执行路由 | A02/A09/A10 |
| M7：打包与证据 | `electron.vite.config.ts`、构建/pack-dir/builder 脚本、独立远端安装包 E2E；保留本地 Gateway UI，新增明确定位的远端静态 UI/受限 preload、版本与摘要清单 | 不复用 P0/P1 的开发 symlink 或测试资源路径环境变量冒充包内资源；不要求本地启动时成功读取远端产物 | A01/A08/A10 |

M1 状态机至少区分未选择、连接中、认证/身份核验、兼容检查、就绪、离线重试、需用户恢复、切换清理、清理受阻；提交仅在当前 epoch 的已就绪状态放行。永久认证/身份/协议失败进入需用户恢复，网络故障才有界退避；Shell 和 Gateway 状态分别报告。协议沿用现有 REST、输入 receipt、Realtime ticket/topic/cursor，Shell 不另造聊天流协议或把中断后的 POST 当成可安全重试。

M6 在实现前核对当前是否有可复用的认证后稳定 gatewayId；若没有，先设计最小持久实例身份与认证读取契约并补安全/升级验收，不用 URL、TLS 证书、构建版本或 endpointId 冒充身份。确需 Gateway 状态变更时单独评审迁移；P2a-1 不借此变更 transcript/会话权威存储或打开本机数据库。

## 9. 修订后的实施阶段

依赖顺序：P0 基线 → P1 连接抽象 → P2a-1 远端聊天 → P2a-2 独立设备认证与本机只读预览 → P2b 可靠执行与写能力 → P3 工作区/开发 → P4 后台任务。P2a-1 可独立验收，不依赖 Host 实现。可选的本地链路统一单独立项，不是前述阶段依赖。所有阶段都以本地回归门槛为前置；阶段未验收不得通过放宽授权、截止时间或结果判定进入下一阶段。

### P0：设计、现状基线与依赖盘点

本轮 macOS 本地连接范围的测量与盘点已完成，原始数据和覆盖限制见阶段报告；完整跨平台/发布验证仍按下述要求推进。

- 在固定机器、安装包、配置和测试数据上记录当前版本的本地启动、恢复、核心操作成功率、资源和延迟基线；记录提交与产物摘要。
- 完成第 6.3 节的执行位置盘点，列明远程首版支持、禁用和待适配项。
- 固定验收工作负载、网络故障模型、超时/停止预算、平台与版本组合。指标要求在测量前冻结，不能为通过而事后放宽。
- 产物：本方案、基线报告、能力清单、故障用例与模块任务；不改数据库归属和 transcript 写入路径。

退出条件：基线可复跑，测量口径、误差和环境明确；未确定的预算或模块负责人列为待办，不能声称已具备发布条件。

### P1：连接抽象，保留本地执行路径

- 已交付 local-only 的 mode、origin、固定 local profileId、epoch 和进程归属描述；保留兼容现有 port/token 使用方的适配边界。真实 Gateway identity、远端 profile 与连接管理器属于 P2a-1，不能视为 P1 已完成。
- 本地仍加载原 Gateway UI，保留现有 Cookie、Realtime、IPC 和默认超时；不引入 Shell Server 作为本地依赖。
- 只做连接接口和 Host 地址泛化所需的最小修改，不同时改设备身份、协议字段、数据库和工作区语义。
- 当前接口显式拒绝远端 mode/origin；后续 P2a-1 引入的远程开关默认关闭，并验证配置损坏、远程资产缺失、凭据错误时，本地模式仍可独立启动。

退出条件：通过第 10 节本地基线与故障回归；原本地数据和会话保持可用，外部复用的 Gateway 不被停止。P1 可独立发布和回退，不以 P2a 已存在为条件。

### P2a-1：远端聊天完整链路，内部技术预览

交付范围：连接配置/安全凭据、身份核验、远端专用 Shell 和包内 UI、受限聊天 REST/Realtime/服务器资源、断线恢复、切换与回退。直接 HTTPS/WSS 和显式配置的外部 SSH loopback 两条路径均验收；不内置 SSH 凭据/隧道管理。远端 owner 会话只用于已允许的聊天路由；不提供远端更新/重启等完整管理控制台。

明确排除：远端 Desktop Host、设备登记/配对、本机只读或写工具、文件选择/上传、写盘下载、PTY、Computer/Browser 控制、语音、后台任务与离线提交队列。用户输入导致的 Agent/数据库/服务器工具写操作仍在远端，不属于本机执行授权。历史会话若含本机工具或 host-path，展示不可用状态而不触发本机动作。

按下表依次实施；每步形成独立可评审变更，完成对应检查再进入下一步。只修改共同模块时也须覆盖本地调用方，不把最终 E2E 当作唯一门槛。

| 步骤 | 模块/具体工作 | 阶段检查与产物 |
| --- | --- | --- |
| S0：冻结范围与基线 | 核对合并后的 P1、IPC/自动 Host 全入口、聊天 API/资源/WS 实际清单；固定 gatewayId 来源、支持版本/平台、预算、故障点与回退路径 | 路由/IPC 许可表、状态转移表、版本矩阵、指标预算；同包同环境新建/复用本地基线。未完成不开始远端入口 |
| S1：先隔离再接网 | M1/M2/M4：远端独立配置与凭据、受限窗口/preload、主进程能力拒绝、无 Host/Renderer fallback 门禁；远端开关默认关闭 | 模式/身份/epoch/来源与所有本机通道拒绝测试；未实现 Shell 时只显示独立恢复页；本地新建/复用/IPC/退出重启回归 |
| S2：Shell 和认证 | M3/M6：包内 UI、loopback 与会话 bootstrap、上游认证/身份/兼容检查；路由与响应信任、WS upgrade、取消/背压及资源限额 | 真实认证 Gateway 集成，A02–A05；认证/证书错误和 Shell 崩溃可恢复。本机能力仍全禁；需新增认证路由则同步 lazy-bundle 正负映射和真实入口测试 |
| S3：聊天与隔离切换 | M5/M1：会话与文本输入、receipt/run 状态、Realtime/gap 恢复、服务器资源读取；A→B→本地的窗口重建和磁盘隔离 | A06/A07/A09，流中断后不重发输入、不重复气泡；未确认输入显示待核实；明确本机能力不可用；清理失败则阻止新连接 |
| S4：真实产物与完整 E2E | M7：构建完整 Node/Web/main/preload/远端 UI，校验包内资源；在支持平台干净目录安装，对独立服务器验证 | A01–A10，全程无开发目录、测试资源映射或额外本地 Gateway/SQLite；测试产物与待发布产物摘要一致；保留所有失败与通过记录 |
| S5：故障、持续运行与回退 | 执行第 10 节的网络、证书、版本、切换、配额、进程故障与 24 小时运行；演练关闭远端/恢复本地及支持的升级/降级 | 原始指标、正确性检查、清理/恢复时限、版本/平台矩阵和回退证据；预算不达标不得通过。经阶段评审才进入 P2a-2 |

退出条件：第 10.5 节逐项通过；真实安装包能连独立 HTTPS/WSS Gateway 完成聊天/恢复，SSH loopback 仍按远端处理；无法经任何聊天窗口入口调用本机能力；本地原路径全回归且性能预算通过；不产生本机会话数据库副本或额外 Gateway。开发 Electron 通过只能记作开发验证，不计安装包通过。未完成平台或 24 小时测试须明确限制交付范围，不能宣布全部 P2a-1 验收完成。

### P2a-2：独立设备认证与本机只读预览

- 在第一个只读能力开放前完成 desktop pairing/access token、公钥绑定、最小 scopes、proof、资源归属、刷新/撤销、身份变化失效及本机授权；不使用 owner 临时兼容路径。UI 登录和 Host 授权可分别撤销，已撤销 Host 不能由 owner 自动重建。
- Host 登记、设备选择与能力状态独立于聊天；根据实际副作用逐项核实设备信息、用户确认的文件选择/上传和截图/观察。屏幕、窗口、文件与剪贴板读取都属于隐私边界，未授权不得采集或上传。
- 观察路径若会启动/准备应用、改变窗口或隐含控制授权，保持禁用；file.save、clipboard.write、通知/应用启动、键鼠、命令和任意工作区读取均不注册、不宣布、不执行。Gateway 和本机双侧白名单；不直接开放既有完整 preload。
- 明确稳定设备选择、Gateway identity 归属和重启安全失效；测量时钟/网络预算，覆盖撤销、离线、端点替换、半开连接、迟到调用/批准和上传边界。只读能力失败或不兼容时聊天继续。

退出条件：独立凭据/越权/撤销全链路及逐能力授权验收通过；真实服务器验证只读白名单不可绕过、无隐含控制副作用；继续通过 P2a-1 聊天、本地基线和安装包/持续运行验收。未完成独立设备认证时仅保留 P2a-1，不以内部预览为由放宽。

### P2b：执行可靠性与写能力

以下条件全部完成后，才开放首批本机写操作及远程正式发布：

- 继承并复验 P2a-2 的独立设备认证、scope/归属、刷新、撤销和重新登记；写能力需新增明确 scope/授权，不能因只读已授权而自动扩权。UI owner 登录不能绕过 Host 撤销。
- 实现第 7.2–7.4 节的有界时限、最小持久执行记录、结果未知、状态核实、防重复执行、停止确认、本机 watchdog 和离线紧急停止。
- 通用 Endpoint 与 Computer/浏览器专用路径分别验证，不能只覆盖一条工具路径。任何尚未达到要求的能力继续禁用。
- 稳定设备绑定解析到当前端点，兼容旧绑定；设备重启、端点替换、Gateway 恢复后重新验证身份和执行权，不恢复旧批准。
- 先开放少量写工具，逐个完成故障验收，再开放键鼠控制；不以“连接成功”作为能力整体上线条件。
- 本阶段目标闭环：远程聊天 → 本机选文件 → 远端分析 → 本机保存文本；Computer Use 控制作为单独能力通过同样门槛后开放。

退出条件：通过全部写操作故障用例、独立凭据与越权用例、本地基线、版本矩阵及持续运行/灰度门槛。停止未确认、动作结果未知必须可见并阻止未核实重试。任一正确性红线失败即禁止发布，不用成功率平均值抵消。

### P3：本机工作区、终端与浏览器

- 在 P2b 执行与授权模型上增加目录读写、搜索和结构化命令，定义各能力并发、锁范围、输出限制和子进程树清理。
- 区分本机/服务器终端；本机 PTY 复用现有实现，服务器 PTY 若无可复用实现则单独交付，不把文件系统位置猜测作为映射。
- 增加远端文件缓存、显式回传和版本冲突处理；不自动同步整个仓库。
- 分别接通本机扩展和嵌入浏览器，保留本机登录态与独立 partition，复用 browser.control 契约并验证副作用记录。
- 适配 MCP/Skills 等依赖位置；未适配能力保持明确不可用。手机/渠道任务通过绑定和 grant 定位电脑。

退出条件：同名/同路径、symlink、Windows 路径、多人会话并发、授权撤销、子进程残留和浏览器控制目标变化均通过；每个新增写能力执行 P2b 的故障测试，不继承未经验证的“稳定”结论。

### P4：后台任务与传输优化

- 加入有目标设备、有效期、取消和授权复核的等待任务；区分前台与后台许可，不全局取消前台要求。
- 在 P2b 已有执行记录/核实基础上增加恢复调度，不自动重放未知结果。
- 根据网络测量优化动作批次、截图压缩、流式背压和可选续传，明确资源限制。
- 独立无 UI Host 另行评审；当前仍要求 Electron 进程运行。

退出条件：休眠/唤醒、长时间离线、过期/取消、凭据撤销、进程崩溃和服务器重启均不会执行过期或旧授权动作；资源和控制响应指标通过。

### 可选后续：是否统一本地 UI 与 Shell 链路

只有远程 Shell 达到持续运行和实际灰度要求，且证据显示统一能带来明确收益时才评审。单独设置开关、迁移和回退路径，并重新执行完整本地基线、打包、认证、媒体与 IPC 验收。不得将“代码统一”作为打破本地兼容的理由。

## 10. 稳定性验收标准与发布门槛

### 10.1 指标口径与正确性红线

以下是计划验收要求，不是当前实现测量结果。耗时/资源绝对值取决于 P0 的固定环境；预算尚未填写或未达标时，验收状态必须为待完成。

| 类别 | 验收要求 |
| --- | --- |
| 本地兼容 | 既有核心场景与故障用例全通过，默认运行路径不变；远程关闭/损坏时可独立使用本地模式 |
| 正确性红线 | 验收样本中跨 Gateway/设备执行、未授权执行、未知结果误报成功、旧批准继续执行、无依据自动重复副作用均为 0；一次出现即阻止发布，这不等于证明未来永不发生 |
| 本地性能 | 同机同数据对比：启动就绪、核心交互 P95、稳态内存/CPU均记录原始值与分布。默认允许的相对劣化上限为 5%；低于测量噪声时按 P0 预定绝对容差判断。需要调整预算须先评审，不能事后放宽 |
| 恢复时限 | 每种故障在 P0/P2a 冻结检测、停止、资源回收和网络恢复后的重连预算，全部实测通过；永久认证/协议错误转为需要用户操作，不能无限重试 |
| 执行停止 | 本地停止入口不依赖远端在线；预算内确认停止，或明确进入 stop_unknown 并隔离执行器，不能把 abort 回执当成停止证明 |
| 资源有界 | 连接、队列、进程、句柄、上传缓冲、缓存/日志均有配置上限；达到上限可拒绝/背压且不影响停止入口；重复工作负载无持续增长趋势 |
| 可诊断 | 每个失败可区分网络、认证、协议、权限和执行器原因；调用可关联到两端记录，不输出敏感凭据和内容 |

P0 基线至少包含新启动和已有服务复用各 30 次，以及足量核心操作样本以报告 P95（每个计时场景至少 100 次）。失败不得从统计中删除；资源采集包含相同预热和空闲窗口。各支持的桌面平台分别报告，不用一台机器的均值代表所有平台。

### 10.2 必测矩阵

| 维度 | 必须覆盖的组合或故障 | 预期行为 |
| --- | --- | --- |
| 本地启动 | 新安装、已有配置、CLI Gateway 复用、自启动子进程、端口冲突 | 保留原恢复行为与所有权，用户数据可用 |
| 远程隔离 | 功能关闭、profile 损坏、凭据无法解密、远程 UI 缺失、Shell 启动失败 | 不修改/阻塞本地配置与启动，存在独立恢复入口 |
| 网络 | HTTPS、SSH loopback、连接延迟/抖动、丢包、黑洞、半开 WS、断网、换网络 | 状态在预算内变化，停止依赖本机监督；无自动切换目标 |
| 时钟 | 正常、正负偏移超过工具期限、接近/超过签名窗口、运行中校时、休眠唤醒 | 拒绝不可信期限或明确诊断，不跳过验签；过期动作不启动 |
| 消息顺序 | 回执丢失、超时后 invoke 到达、迟到结果、断线重发、新调用 ID 重试同意图 | 未执行/成功/未知判定正确，不盲目重复副作用 |
| 取消与崩溃 | 批准前后、开始动作前后、完成后落盘前、返回结果前；Gateway/Host/驱动分别崩溃 | 记录保守恢复；停止确认与未知区分，旧执行权失效 |
| 认证 | token 过期/撤销/刷新失败、Gateway identity 改变、proof 重放、他设备资源访问 | 受限设备不可越权，不使用 owner 静默重建 Host |
| 版本 | 相同协议、缺 capability、旧 UI/API、不匹配 Computer contract | 按能力禁用/提示升级，普通浏览器和本地不回归 |
| 资源 | 不同文件系统、同名路径、Range、媒体、限速上传、下载/上传取消 | 不误用远端 host-path，不失控缓冲，不占住控制资源 |
| 执行权 | 多会话/Agent/自动化、重复 Electron 实例、用户介入、目标窗口变化 | 同一资源所有权明确，旧动作失效或拒绝，不错误接管 |
| 切换 | profile A→B→本地，旧响应/审批返回，停止失败 | 隔离缓存/claim/执行权；必要时拒绝切换或重建窗口，不带入旧操作 |
| 依赖 | MCP、Skills、Native Messaging、语音、代理、证书、OAuth、密钥存储 | 执行位置明确；能力不可用不拖垮整个连接 |
| 打包更新 | macOS/Windows 安装包、新旧 Gateway 版本、Electron 更新、服务端更新 | 本地包保留，远程 UI 独立存在，更新目标明确，数据保留 |

延迟测试至少包括 50/200/1000 ms RTT；丢包包括 1%/5%，并分别测试 10 秒和 60 秒的双向黑洞。单向“调用可达但结果不可达”必须覆盖。使用有序的 HTTP/WS 语义，丢包在网络层注入；迟到/重复应用消息另用受控故障点注入。高故障负载允许请求失败，但不允许违反正确性红线；可用性、失败率和恢复时间单独报告。

### 10.3 测试层次与持续运行

- 模块测试：连接/执行状态机、时钟、租约、去重、权限、代理流、路径、取消与资源上限。
- 集成测试：必须走真实 Gateway 的 lazy-bundle、认证、ticket/WS、Endpoint、上传和操作记录；单测路由函数不代替可达性验证。
- 端到端：使用“真实 Electron 安装包 + 独立服务器 + 不同文件系统”；不能只在同机或 mock 上模拟远程。只读和写能力分别验收。
- 持续运行：P2a-1、P2a-2 各至少 24 小时，P2b 至少 72 小时的固定场景循环，包含空闲、聊天、资源读取、断线恢复、休眠/唤醒；上传在 P2a-2 开放后加入。平台分别采样资源、进程、句柄、失败率和恢复时限，任何泄漏或正确性红线失败须修复重测。
- 灰度：P2b 先在明确的试用设备和版本组合运行至少一周，保存可复核的非敏感故障记录；正确性缺陷立即关闭相关远程能力。持续时间只是最低观察窗口，不是稳定性保证。

只读阶段通过不能替代写操作验收；写入文件通过不能替代键鼠/浏览器提交/命令执行的验收。没有失败证据不等于没有缺陷，报告必须列明样本、环境、未覆盖项和已知限制。

### 10.4 发布、回退与证据

每阶段提交基线对比、故障矩阵结果、版本/产物摘要、超时和资源预算、遗留问题及回退演练记录。按变更范围执行 Vitest、类型检查和真实打包；数据库变更须保留项目支持版本的升级链、备份与迁移回归，不能提升最低版本来简化本次工作。

本地默认和远程显式开关保持独立。可按能力关闭写工具/Computer Use 或关闭整个远程模式，关闭后旧调用和执行权必须被废止。回退不复制远端数据库、不让两个 Gateway 写同一 SQLite；若发生不可逆迁移，必须按已测试的恢复方案处理，不能假定安装旧包即可回退。

正式发布不以“所有阶段代码合并”为标准：任一本地回归或正确性红线失败、执行停止未有可信处理、预算/持续运行未完成、回退未演练，均阻止发布。

### 10.5 P2a-1 专项验收清单

本表全部为待执行验收，不是已通过结果。远端 E2E 使用真实 Electron 安装包、独立主机/文件系统的 Gateway 与有效证书；模型流可使用明确标注的确定性 fixture 以稳定断言，但至少补一条实际配置的远端 Agent/模型链路。记录服务器是否与生产配置存在差异；mock 不能替代 TLS、认证、SQLite、HTTP/WS 和窗口/IPC 实际路径。

| 编号 | 场景与注入 | 必须观察到的结果与证据 |
| --- | --- | --- |
| A01 本地零侵入 | 原安装升级和干净安装；自启/CLI 服务复用；远端关闭、profile 损坏、密钥不可解、Shell 失败/卡住、远端 UI 缺失 | 均能显式选择本地走原 UI/Cookie/Realtime/IPC；聊天/文件/PTY/Computer、退出与自有重启通过，复用服务不被停止。记录进程树、数据库归属、配置摘要及 P0/P1 同口径性能；本地启动不依赖远端初始化 |
| A02 认证与身份 | HTTPS/WSS、SSH loopback；401/凭据撤销；同 origin 更换 gatewayId；临时未验证身份；凭据存储失败 | 长期 token 只由主进程配置/保管，不出现在聊天 Renderer、IPC 返回值、URL、日志或持久业务 store；每次就绪前核验身份。撤销/身份变化锁定连接且不无限重试、不沿用旧授权/数据；SSH 不获本地权限 |
| A03 本机能力封锁 | 远端顶层页、iframe、旧窗口/epoch、任意 localhost 页；伪造所有已盘点 invoke/send/MessagePort/订阅；菜单/快捷键/拖放/深链、自动 Host fallback | 主进程在副作用前拒绝；没有文件读取/写入/选择、PTY 子进程、剪贴板访问、截图/控制、浏览器执行、语音权限或 intake 取数。Gateway 无来自该远端连接的 Desktop Host 登记/claim/工具；历史本机工具消息和 host-path 不能触发本机动作；本地同项操作仍通过 |
| A04 代理/响应信任 | 任意 URL、编码路径绕过、伪造 Host/Origin/认证头、其他本地端口；跨源/降级/循环重定向；Set-Cookie、恶意 HTML/MIME、外部预览与脚本 | 未授权请求在转发前拒绝；受控上游凭据不泄漏、不跟随不许可重定向；Shell Cookie/CSP 不被上游改写。只有包内 UI 运行桌面 preload，远端内容无法继承本机权限；未许可管理/更新/设备路由被拒绝 |
| A05 WS 与流资源 | 缺本地会话/错 Origin/重复或过期 ticket、任意 WS 路径；超大帧、慢消费者、限速资源读取/Range、多连接及断流 | 保留现有 ticket 一次性语义与 Realtime 消息结构；只开放聊天 WS。达到限额拒绝/背压，缓冲有界，无全量积压；取消关闭上下游资源，不把失败转成成功，不阻塞连接恢复入口 |
| A06 聊天完整性 | 创建/选择/重开会话，提交输入、receipt、流式文本、状态/取消；POST 已接收但响应丢失，WS gap、Gateway 重启 | 已确认输入/回复持久化在服务器，恢复通过 receipt/会话/run 状态和 cursor/gap 拉取核实；不重复提交、不重复气泡。无法核实的输入显示结果待确认，禁止自动 POST 重发；新 epoch 不接收旧响应；取消未确认不显示已停止 |
| A07 切换与磁盘隔离 | A→B→本地→A；两服务具有相同会话 ID/文件名；迟到请求、待发输入/草稿、旧游标/Cookie；休眠/重启/升级；注入清理失败、本地执行器停止未确认 | A 数据、草稿、认证、缓存/下载引用不出现在 B 或本地；共享偏好仅限明示清单。检查实际 partition、localStorage/IndexedDB/CacheStorage 和缓存目录，不能只查内存。失败时中止激活新连接并展示受阻恢复；不接管执行器、不自动回切、不恢复旧执行权 |
| A08 安装包资源 | macOS/Windows 的实际交付包，签名/平台策略与发布渠道一致；无仓库/开发服务/预热缓存；缺远端资产、损坏资产或版本不符 | 包含可定位的本地 Gateway UI、远端静态 UI、main/preload、Gateway/SQL 等所需资源；不依赖开发 symlink、`XOPC_SQLITE_ASSET_ROOT` 或脚本注入资源目录。完整包独立启动，摘要/manifest 对应测试版本；远端资产失败有独立恢复入口，本地仍可用。缺资产用例使用明确标记的故障产物 |
| A09 网络/证书/版本 | 第 10.2 节 RTT/丢包/黑洞矩阵，流中断、半开 WS、换网/唤醒；过期/主机名错误/不受信任证书；缺 manifest/不匹配 REST 或 Realtime、仅 Computer 不匹配 | 网络恢复后有界重连且不重发输入，失败阶段可诊断；证书错误硬失败且不提供跳过验证。聊天必要契约不兼容则阻止提交、提示升级；只缺可选本机契约时聊天正常且本机能力保持禁用；不会新建本地 Gateway 冒充远端 |
| A10 运行/升级/回退 | 第 10.3 节 24 小时循环；连接切换/重连至少 100 次；当前及声明支持的旧 Gateway 组合、Electron 升级/受支持回退；关闭远端、损坏远端存储恢复本地 | 无崩溃、错误目标、数据串用和本机能力逃逸；连接/队列/缓存/进程/句柄有界，无持续泄漏趋势。关闭后旧请求/会话失效，用户数据保留且本地回归通过。未验证版本明确拒绝/标注；不承诺跨不可逆迁移直接装旧包回退 |

验收预算在 S0 固定并与报告一同保存。以下是远端路径的初始设计目标，尚非实测承诺；S0 可依据原型/网络测量提出修订并先评审冻结，正式验收后不得为使样本通过临时放宽。本地超时/重试不随此表调整。

| 指标 | P2a-1 初始目标与测量边界 |
| --- | --- |
| 连接失败可诊断 | DNS/TLS、认证 HTTP、WS 握手各有独立且不超过 15 秒的尝试预算；日志标明阶段。超过后进入离线/需恢复，而非一直显示加载中 |
| 离线与恢复 | 声明的故障测试环境内，半开/黑洞 45 秒内显示离线；网络稳定恢复后 30 秒内重新认证/核验并恢复聊天订阅或给出确定失败原因。凭据/身份/协议硬错误立即停止自动重试 |
| 重试 | 网络重试指数退避加抖动，间隔上限 30 秒、连续最多 10 次后由用户手动恢复；POST 输入不在自动重试范围。恢复按钮不绕过身份/证书检查 |
| 取消、关闭与切换 | 用户取消后 5 秒内关闭本地相关代理流；普通切换/退出 15 秒内完成清理或明确进入受阻恢复，不假报完成。该预算不意味着服务器 Agent 已停止；停止核实沿用独立状态 |
| 流与资源 | 资源无进度 30 秒后中止；正常聊天等待按现有 run 状态判断，不因模型思考无文本误判执行未发生。S0 冻结 HTTP/WS 并发、队列、帧/消息大小、缓存与缓冲字节上限，并测试上限及超限，未填写不得验收 |
| 正常功能与本地性能 | 无故障脚本每个固定场景至少 100 次，预期全部通过；本地新建/复用各至少 30 次，按 10.1/P0 预定 5% 或绝对容差逐项比较。远端故障成功率另报，不拿平均数抵消正确性红线 |

每项记录平台/系统/包版本与摘要、Gateway 身份和构建/协议版本、网络/时间条件、样本数、实际预算/原始耗时、状态转移、非敏感关联日志、失败与重跑原因。任一 A01–A10 缺证据或失败，仍为未验收；不能用 PR #38 的本地开发 E2E、单次远端连接成功或未发生错误替代。

## 11. 首个可评审实现批次与边界

S2 已随 PR #40 合并。当前按明确授权在新 worktree 完成 S3 的纯文本聊天、receipt核实、Realtime/gap恢复、加密草稿/待核实记录隔离与窗口重建切换；不启动远端Host或本机能力，不改变原本地认证、Gateway监督或会话数据库。验收证据见 S3 记录；S4安装包/独立服务器/平台矩阵及S5长期运行仍须独立完成。

本方案不引入新的 Agent 副本，不改变 transcript 权威写入路径，不自动同步工作区。完整离线调度可以后置，但执行未知、停止确认与防重复副作用必须在远程写能力开放前完成。
