# Electron P0 依赖与执行位置盘点

日期：2026-10-30。范围：本地 Gateway 连接抽象前的代码盘点；远程桌面能力尚未实现。关联方案：`electron-local-remote-gateway-plan.md`。

## 运行边界

| 入口/模块 | 当前执行位置与依赖 | P1 处理 | 后续远程约束/验证 |
| --- | --- | --- | --- |
| `electron/main.ts` | Electron 主进程；初始化本地配置、DesktopHost、IPC、窗口、托盘和快捷键 | 保留顺序与本地 UI URL；地址经本地连接工具生成 | 远程启动不得初始化本地 Agent 数据；远程资产损坏不能阻止本地启动 |
| `electron/gateway-process.ts` | Electron 启动子进程或复用已经认证且兼容的本机服务 | 保留 `{port,token}` 接口；抽离本地连接描述、origin 和所有权元数据 | 只停止自己持有的 ChildProcess；不能因 loopback 就视作本地服务 |
| `electron/ensure-gateway-config.ts` | 本机 `~/.xopc` 或环境指定路径；Zod 初始化，代理配置继承 | 不修改配置路径、默认值或初始化逻辑 | 远程 profile 与本地路径分开 |
| `electron/gateway-compatibility.ts` | 本地 HTTP + bearer；Computer/Endpoint/Realtime 严格校验 | 仅复用 origin 生成器；不放宽兼容性和 5 秒预算 | 分能力降级另行交付；旧协议不可假定支持新字段 |
| `web/src/stores/gateway-store.ts`、`lib/fetch.ts`、`lib/url.ts` | Gateway UI 同源 Cookie、401 屏障 | 不修改 | 远程 bootstrap/Shell 必须单独验收 |
| `web/src/features/gateway/gateway-realtime.ts` | Renderer 同源 WS、ticket、topic、游标 | 不修改 | 切换清理所有订阅/游标；不是简单修改 baseUrl |
| `electron/computer/desktop-host.ts` | Electron 本机身份/safeStorage、Node WS、原生 CUA 驱动 | 只复用本地 origin；身份文件、重连和权限保持 | 稳定设备身份、签名时间、审批、停止和调用结果核实前置 |
| `electron/computer/frame-upload.ts` | 本机字节上传到 Gateway；15 秒超时与临时 uploadGrant | 不修改 | 慢上传不得改判动作未执行；新上传预算另行验证 |
| `src/computer/broker.ts` | 本机执行器会话、owner、busy、generation、驱动清理 | 不修改 | 控制并发、离线停止、停止结果未知须覆盖 |
| `electron/ipc/trusted-renderer.ts`、`navigation-policy.ts` | 本地 UI/IPC 信任、导航 | 不修改原有授权策略 | 远程 Shell 采用精确 origin/WebContents/frame；不能扩大 localhost 信任范围 |
| `electron/ipc/file-resource-path.ts`、`file-ipc.ts` | Gateway host-path 当作本机路径；本机 fs、打开/编辑/监听 | 仅统一本地 origin，不改变路径语义 | 远程禁用直通 host-path；使用受控下载缓存/显式回传 |
| `electron/ipc/search-ipc.ts`、`understanding-sources-ipc.ts` | 本机授权根目录、本机发现/索引与应用来源 | 不修改 | 首版远程逐项禁用未适配入口，不搜索服务器路径 |
| `electron/ipc/terminal-ipc.ts` | 从本地 Gateway 取 effectiveWorkspacePath，使用 node-pty 启动本机 shell | 仅统一本地 origin；PTY 生命周期与目录判定不变 | 远程返回目录不能当本机 cwd；本机 workspace 授权另行交付 |
| `electron/browser/browser-host.ts` | 本机 WebContentsView、独立 partition、下载与页签 | 不修改 | UI 浏览器不等于 Agent browser.control；扩展和控制适配另行实现 |
| `src/browser/providers/browser-ext-install.ts`、`src/browser/native-messaging-host.ts` | 安装与 Native Messaging 发生于运行 Gateway 的主机 | 不修改 | 远端安装不能完成本机浏览器接入；必须明确本机安装/登记入口 |
| `src/agent/mcp/config.ts`、`native-mcp.ts`、`transport.ts` | Gateway 配置投影到 pi；MCP 进程和网络请求属于 Gateway 主机 | 不修改 | 本机 MCP 需要显式设备适配；不可自动迁移命令/凭据 |
| `src/agent/skills/` 与 Agent 工具 | Skill 脚本、工作目录、python/git 等依赖 Gateway 运行环境 | 不修改 | 本机执行通过明确的 Endpoint 工具；提示词不能代替位置路由 |
| `src/voice/`、`electron/voice-input-hotkey.ts` | 本机录音/快捷键与 Gateway 语音服务分层 | 不修改 | 逐项声明本地/服务器推理、模型路径、音频流和资源预算 |
| `src/auth/oauth/`、桌面深链 | Provider/OAuth 服务在 Gateway；应用激活和本机浏览器在电脑 | 不修改 | 核实公网回调/本机回调，不发布 Shell loopback URL |
| `electron/main.ts` 代理解析、`src/config/` 网络设置 | Electron 系统代理用于子进程环境；WS 客户端另有行为 | 保留默认来源 | HTTPS/WS、企业证书、代理认证必须真实验证，不忽略 TLS 错误 |
| `electron/auto-updater.ts`、`ipc/updater-ipc.ts` | 更新本机 Electron 安装包 | 不修改、不触发更新 | 服务端更新独立；UI 清晰标识更新位置 |
| `electron/tunnel-main.ts`、`tunnel-tray-status.ts` | 明确保存嵌入服务 port/token 的本地隧道管理 | 不修改；不泛化成远程管理接口 | SSH loopback 仍属远程；自动隧道生命周期另行设计 |
| `electron/quit-impact.ts` | 通过当前本地连接查询是否有阻塞任务 | 仅统一本地 origin；保留 800ms 预算与提示行为 | 远程 Agent 继续运行不代表电脑可以忽略本机执行清理 |
| `src/storage/sqlite/` | Gateway 拥有会话、配置、调用与身份数据；Electron 也有现有本地初始化访问路径 | 不改变 DB/迁移/transcript 写入 | 最小本机操作记录不是第二份会话库；保留支持版本迁移链 |
| `electron.vite.config.ts`、打包脚本 | 当前打包跳过 renderer；UI 来自 Gateway 静态目录 | P1 保留构建产物与加载方式 | 远程 UI 必须独立纳入安装包；缺失时仅禁用远程 |

## P0 测量规约

- 使用生产 Electron main/preload 构建与真实、独立配置的 Gateway 子进程；不连接日常实例。每次独立 state/userData/workspace/端口/随机 token。
- 本轮固定 macOS/arm64、Node 26.12.1。记录提交、构建 SHA、系统版本、成功/失败样本与时间；开发 Electron 运行时不得标为已签名安装包验收。
- 新启动与复用各 30 次。每类首个实例测量 config/session 各 100 次 Cookie 同源访问，其余实例至少一次；记录 UI ready、退出时间和进程树资源快照。
- UI ready 定义为生产页面加载、preload 可用、Cookie bootstrap 后 config 成功；另外要求真实 DesktopHost 完成签名 Endpoint 注册。不是单纯等待端口或 `/health`。
- 验证裸请求被拒绝、Cookie 接口可用、子进程随 Electron 退出、复用服务在退出后仍可认证访问。
- 接口/启动/退出正确性要求全部通过；P1 相对 P0 启动、接口 P95 和 RSS 默认容差 5%。固定样本较小且机器存在其他任务，低延迟噪声绝对容差预先设为 5ms，启动为 100ms，RSS 为 32MiB。使用 `max(相对容差,绝对容差)` 比较，不删除失败样本。
- CPU 仅记录进程树快照，不能据此证明稳态 CPU 或持续运行无泄漏。打包安装、Windows、原生权限与真实键鼠副作用、实际远端服务器不在该自动化的覆盖范围，必须在报告保留待验收状态。
- E2E 脚本：`node scripts/verify-electron-local-connection.mjs --runs 30 --operations 100 --output reports/p0-local-baseline.json`。报告输出到 ignored reports；可审阅摘要另外保存到本目录。
- Electron 非打包构建需要显式指定 schema 资源目录；脚本仅在隔离测试环境设置 `XOPC_SQLITE_ASSET_ROOT` 指向仓库资源，不改变产品启动代码。
- review 后：测量入口移除继承的 `XOPC_*`、`PI_*`、`ELECTRON_*`、凭据与 `NODE_OPTIONS`，显式指定临时凭据目录和本 worktree 的静态 UI。共享开发布局由独占锁保护；已有链接须指向本 worktree 的 dist，普通目录和错误链接不能被覆盖，锁竞争时不能覆盖另一个运行的报告。
- review 后的报告增加 Electron main/preload 完整构建摘要与 worktree dirty 标记，结束时再次校验构建未变化；历史 P0 仅有入口摘要，不能追溯补造完整包摘要。
- 完整功能 E2E 额外覆盖自有 Gateway 重启后的聊天持久化、Host 重连，以及复用外部服务时拒绝重启且服务继续可用。连接替换、并发重启和强制停止未确认通过独立生命周期回归测试验证。

## P1 允许与禁止的变更

允许：本地连接模型、地址生成、描述快照、兼容旧调用方的适配；补充真实服务/桌面验证；以 ChildProcess 引用继续管理所有权。

禁止：Shell Server、远程 profile 持久化/认证/执行、UI Cookie 替换、schema/数据库迁移、远程写工具、改变权限/重试/超时、自动配置日常实例。远程 mode/origin 的输入应显式拒绝，避免接口抽象意外开放未经验证的功能。

P0 的 macOS 本地连接测量与依赖盘点完成后可推进本轮 P1；完整跨平台/安装包/真实远端稳定性门槛仍按主方案执行，不能由本轮有限范围报告替代。
