# configure-xopc / Browser Use P0 实施与验证

日期：2026-10-24。对应[设计方案](browser-use-conversational-setup-2026-10-24.md)。

## 已实现

- 一个内置 `configure-xopc`，按场景 overview、所选连接分支、故障和验收资料渐进加载。Browser 为首个实现的场景；其他场景仅提供边界说明，不注册额外配置 Skill。
- `xopc_use` 的 `browser_setup` 模式与专用手册，读取现状、创建/恢复配置流程、准备文件、检查状态和读取验收证据。产品写入由领域服务处理，没有直接编辑本地配置文件的 Skill/脚本路径。
- 本机所有者在产品面板批准共享配置变更。设置页、普通聊天工具结果及浏览器缺失提示可进入同一流程；新配置完成后通过下一轮 Agent 调用刷新工具快照。
- 扩展加载的人工指引、打开扩展页/目录、认证端点检查、明确选择 Chrome，以及当前会话已有标签页的占用保护。
- 独立演示窗口，经过正常 `browser_use` / BrowserRuntime / 扩展控制器路径执行读取、点击、输入；后端核验动作回执、页面标识、端点、会话和结果。模型不能自报通过。
- SQLite v260 保存配置与验收流程，提供 v259 到 v260 的增量迁移；刷新/重启可重新读取。已持久化的演示会话标识仅可在匹配流程与端点内恢复或释放。
- 取消后不恢复原任务，未释放控制前不能覆盖旧 attempt；产品所有者可以直接发起受控清理。配置、Agent 工具策略或端点版本变化会使旧证据失效。
- 只有当前演示页的精确 URL 获得临时本机访问许可，不修改全局内网白名单。演示 HTML/JS 为不含用户数据的公开静态资源，配置和证据 API 仍需认证。
- 当前没有新增 Key 输入接口。本机 Chrome 不需要 Key；长期凭据安全输入属于 P1，未以密码框或现有 auth profile 冒充加密存储。

## 实施细化

- P0 直接以 `inspect` 的配置 revision 和持久化 setup 审阅计划，没有额外引入独立 planId 对象；`preview` 为只读检查，后续可以扩展计划展示。
- 产品所有者选择 Chrome 并启动演示，授权在该端点创建独立测试窗口。无需接管用户现有标签页；会话及测试标签页标识由后端真实回执固定。
- 配置状态通过可查询快照与 SWR 轮询同步；本期没有新增专用实时事件流。
- 复用现有安装服务，因此 Skill 目录没有增加不必要的脚本。额外脚本只用于可复现的开发验证。

## 自动验证

- 相关回归覆盖：配置服务与工具、BrowserRuntime、扩展驱动、Skill 加载、认证 Gateway lazy 路由、设置/对话组件、迁移与 SQLite 资产打包。
- 根 TypeScript 检查、Web TypeScript 检查、相关 ESLint，以及 Node/声明/Web 完整构建。
- Skill 通过 skill-creator 的 `quick_validate.py`；资源按实际工具门控加载，不要求 Browser 已可用。

本次相关回归为 23 个测试文件、261 项全部通过。根与 Web 类型检查、相关 ESLint、Skill 校验及完整构建通过；构建保留已有 Web 分块及动态导入提示。

## 真实 Chrome 演示

复现：

```bash
pnpm run build
pnpm exec playwright-core install chromium
pnpm exec tsx scripts/verify-browser-setup.mts
```

脚本使用临时数据库、临时 Chrome 配置和隔离扩展，不修改日常 Chrome 的标签页或 xopc 用户配置。报告默认输出到 `/tmp/xopc-browser-setup-live.json`，可使用 `XOPC_BROWSER_SETUP_REPORT` 指定路径。

机器报告（历史产物已移入 Git 历史）记录真实 Chromium 148.0.7778.96 的配置、读取、点击、输入及释放检查通过；脚本也确认演示标签页已关闭。

测试边界：使用生产 Browser 控制器与真实 Chrome CDP，但以隔离适配器替代生产端点传输。未覆盖完整的原生发现/Realtime 配对，也没有让真实语言模型自主选择与执行整个引导。安装与权限函数另有回归覆盖；脚本通过 Chromium 启动参数加载测试扩展，不能代替首次用户手动安装的体验验收。

## 生产协议与真实模型完整验收

后续已使用 `scripts/verify-browser-setup-production.mts` 跑通真实模型完整流程，补齐上面隔离适配器验证的边界。生产链路机器报告（历史产物已移入 Git 历史）仅保存不含凭据的结果；完整对话和排障日志保留在本机临时目录，不提交。

- 从原句“帮我配置 Browser Use”开始，通过生产会话输入 API 调用真实 `qwen3.8-flash`，共 17 次模型请求，全部 HTTP 200。没有脚本化模型回复或控制传输适配器。
- 实际 `skill_view` 顺序为统一 `SKILL.md` → Browser overview → Chrome extension → acceptance，没有加载其他场景。配置工具与 `browser_use` 通过正常 `tool_search` 渐进发现。
- 在真实 Web 产品面板完成本机所有者批准、扩展文件和原生宿主准备、明确选择 Chrome、开始验收；验收按钮在同一聊天中启动后续真实模型轮次。
- 原扩展侧栏的 Connect local Gateway 调用 Chrome native messaging，完成绑定设备密钥的生产配对、令牌刷新、HTTP 签名认证与生产 Gateway Realtime 注册。Gateway 从源码 CLI 生产入口启动；UI 和原扩展使用构建产物。
- 真实模型按顺序调用 `navigate`、`click`、`fill`、`close`，没有 Browser 工具错误；后端 `configured/read/clicked/filled/released` 全部为 true，状态 completed 且证据未过期。
- 模型读取后端 `verification_report` 并完成最终用户回复；确认演示标签页关闭、没有遗留新增调试目标。测试工具自身已有的 CDP 连接以启动验收前的基线排除。

本轮修复：

1. 引导读取工具原先也被延迟隐藏，模型可能无法开始读取 Skill。将 `skill_view`、`skills_list`、`tool_manual` 作为轻量引导工具预先声明，业务工具继续按需加载；加强引用内的精确工具发现指引。
2. 扩展没有跟上设备请求签名协议。补齐刷新请求与签名的 `requestProofVersion`，校验签名响应版本，对 HTTP 请求的正文、目标、凭据与约定头部进行签名。
3. 浏览器 WebSocket 无法设置 upgrade 自定义头。在 Realtime hello 中传递相同的密钥签名证明，Gateway 仍执行票据绑定、签名和防重放校验；没有无签名降级路径。原生客户端可继续使用 upgrade header。
4. 启用 Browser 后旧聊天缓存了未启用时的工具列表。将 Browser/Computer/Phone 的启用开关纳入 Agent 工具快照版本，下一轮自动重建，避免要求用户新开聊天。

复现（macOS；从安全环境注入 `DASHSCOPE_API_KEY`，不把密钥写入命令或仓库）：

```bash
pnpm -C packages/browser-ext run build
pnpm -C web exec vite build --outDir /tmp/xopc-browser-production-ui
pnpm exec playwright-core install chromium
XOPC_BROWSER_PRODUCTION_UI_ROOT=/tmp/xopc-browser-production-ui pnpm exec tsx scripts/verify-browser-setup-production.mts
```

模型可通过 `XOPC_BROWSER_SETUP_MODEL` 更换；`XOPC_BROWSER_PAIRING_ONLY=1` 可单独排查生产配对，不调用模型。报告默认位于 `/tmp/xopc-browser-production/result.json`。脚本使用临时 HOME、数据库、配置、技能快照与 Chrome profile，不修改日常 xopc 状态或 Chrome profile。

安装边界：Chrome 通过启动参数加载原扩展，没有自动操作人工 Load unpacked 文件选择器。Chromium 使用指定 `user-data-dir` 查找 NativeMessagingHosts，因此测试将产品生成的宿主 manifest 原样复制到隔离 profile 对应目录；宿主、配对和 Realtime 均运行原生产代码。此路径规则见 [Chromium 路径实现](https://chromium.googlesource.com/chromium/src/+/HEAD/chrome/common/chrome_paths.cc)。

本轮最终回归覆盖 15 个文件、173 项：含引导工具发现、同一聊天工具刷新、HTTP/CONNECT 签名契约、刷新签名、浏览器 hello 正确/缺失/错误票据证明、配置服务、真实认证路由、运行时和释放、设置面板。根与扩展 TypeScript 检查、受 ESLint 管理的相关文件、扩展生产构建和 Skill 校验通过。

## 已有安装修复、权限拒绝与中断恢复（XOPC Cloud）

按后续指定，本轮全部真实模型调用使用 **xopc-cloud / openai-codex/gpt-5.6-sol**。恢复流程机器报告（历史产物已移入 Git 历史）记录 50 次真实模型请求，全部成功，Browser 工具错误为 0。三个恢复场景均沿用从“帮我配置 Browser Use”开始的同一个 conversationId，生产配对和 Realtime 传输没有适配替身。

| 场景 | 实际故障与用户动作 | 验收结果 |
| --- | --- | --- |
| 已有安装修复 | 首次验收后删除产品安装目录中的 background.js；Chrome 的原扩展仍保持正常配对。用户在原对话要求修复，并在产品面板批准。 | 模型按需读取 troubleshooting，检测文件损坏；产品恢复文件，保留原配对端点，再完成读取、点击、填写和释放。 |
| 权限拒绝后继续 | 所有者通过认证的 Agent 设置 API 将 browser_use 改为 deny；在真实面板尝试开始验收，随后明确告诉模型暂不授权。之后由所有者改回 allow。 | 拒绝时没有创建演示会话，模型解释权限边界，没有改权限或替换待办配置；重新授权后在原对话恢复同一配置。 |
| 中断与进程重启 | 等待真实 navigate 产生读取回执后，在下次模型请求前暂停转发，通过生产 abort API 停止运行；刷新页面并重启真实 Gateway，再连接原 Realtime 端点。 | 数据库中的 setupId、attemptId 和原对话保留。模型先 observe 取得新引用，执行剩余 click/fill/close；原 attempt 成功完成，没有重新 navigate 或重复已通过操作。 |

三条路径最终 `configured/read/clicked/filled/released` 全部为 true，证据非 stale；演示标签页关闭，没有遗留新增调试目标。权限设置变更通过真实所有者 API 完成；不将该项测试声称为 Agent 编辑器中每个权限控件的点击验收。

本轮直接修复：

- `inspect` 补充真实安装健康度与 Agent 工具权限，避免把历史验收成功当成安装文件仍然完整。
- Skill 说明按保存的 checks 恢复，只执行未完成步骤；已存在测试页时先 observe，超时或停止时先释放再重新验收。后端拒绝重放已经通过的点击和填写。
- 重复 `tool_search` 原先仅返回“没有匹配”，模型将已加载工具误认为不可用。现在对明确检索的已加载工具返回“Already loaded，可直接调用”，并保留原发现权限边界。
- 对话面板在验收进行中也允许所有者直接释放控制；权限拒绝文案可在刷新后恢复，并提供助手权限设置入口。
- 权限或策略变化使证据 stale 后，确认释放即可创建新的待审阅计划，避免“重新开始”不断返回旧 stale 流程。此边界与权限被拒后直接清理由回归测试覆盖。

复现：先按上文构建 Web/扩展并安装测试 Chromium，在本机已有有效 XOPC Cloud 登录的情况下执行：

```bash
XOPC_BROWSER_RECOVERY=1 XOPC_BROWSER_PRODUCTION_UI_ROOT=/tmp/xopc-browser-production-ui pnpm exec tsx scripts/verify-browser-setup-production.mts
```

报告默认输出 `/tmp/xopc-browser-recovery/result.json`。模型注册使用隔离的本地 relay 名称，转发时固定实际 Cloud 模型 ID；relay 不替换模型回复或工具选择。Cloud OAuth 仅用于真实请求，临近到期时通过正常凭据服务续期，不写入测试配置或证据。测试的配置、数据库、安装文件与 Chrome profile 仍全部隔离。

本轮最终相关回归为 15 个文件、179 项通过；根与 Web 类型检查、相关 ESLint、Web 生产构建及 Skill 校验通过。新增覆盖包括重复工具发现、损坏安装检查、部分进度恢复、新页面引用、重复写入拒绝、权限被拒后的所有者清理，以及 stale 流程替换。

## Chrome 原生控制撤销与系统启动受阻

本轮继续使用 **xopc-cloud / openai-codex/gpt-5.6-sol**，在有界面的真实 Chromium 148 中进行原生 UI 操作。机器报告（历史产物已移入 Git 历史）保留阶段、动作、预期拒绝及适用范围，不包含登录令牌或配对邀请。

### Chrome 原生 UI 实测

1. 从“帮我配置 Browser Use”开始，使用同一对话的产品配置面板准备、配对并开始测试。真实模型 navigate 成功后暂停下一次模型请求。
2. 通过 macOS 原生辅助功能 UI，在 Chrome 显示的 `"xopc" started debugging this browser` 提示条上实际点击 **Cancel**。没有通过脚本合成 onDetach 事件代替此步骤。
3. Chrome 真实触发 `canceled_by_user`；扩展保存停止状态。模型后续 click 收到预期的 `BROWSER_CONTROL_REVOKED`，未产生点击或输入成功回执，没有静默重连。
4. 模型说明尚未通过并关闭测试会话；后端确认 released，旧演示标签关闭。刷新扩展页面后停止提示仍在，清理不等于重新授权。
5. 通过原生 UI 实际点击扩展的 **Resume browser control**。回到原对话重新检查，在同一配置流程开始新的 attempt；不复用旧检查。
6. 真实模型完成 navigate/click/fill/close 和后端 verification_report。五项检查全部通过，最终回复已完成；演示标签关闭，无新增调试目标残留。

发现并修复了取消后扩展会自动再次 attach 的问题：停止状态现在保存在 Chrome local storage，拦截跨标签页的后续控制，只有扩展页面的显式恢复入口可以清除；close 清理仍可使用。补充了独立的拒绝引导、恢复按钮、原生宿主受阻提示、对应 Skill permissions reference，以及清理后仍保留权限撤销原因的后端状态。

### 系统侧实测及适用范围

测试将隔离的、由 xopc 管理的原生宿主 executable 改为不可执行，Chrome 通过生产 native messaging 真实启动时被操作系统拒绝。界面显示本机连接程序无法启动；真实模型在用户说暂时保持拒绝后只检查并解释，连接和配对均未建立。之后通过原对话面板的修复操作恢复管理文件，再用原扩展连接完成生产配对与 Realtime 验收。

原生宿主 doctor 现在检查 POSIX 执行权限，避免仅凭文件存在就宣称安装正常。修复只恢复 xopc 自己管理的宿主，不调整系统安全策略。

**本轮没有观察到 Gatekeeper 或 TCC 权限弹窗。** 本机 Chrome 扩展路径使用 Chrome debugger / native messaging，不调用 macOS 屏幕录制、辅助功能或 Apple Events Automation；这些系统授权对本路径不适用。系统 `EACCES` 测试是实际启动受阻错误恢复，不标记为系统弹窗验收通过。若真实系统安全弹窗出现，Skill 要求由用户自行审阅决定，不移除 quarantine 或关闭保护。Chrome debugger 取消事件与 native messaging 路径分别见 [Chrome debugger 文档](https://developer.chrome.com/docs/extensions/reference/api/debugger)及 [Native messaging 文档](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)。

### 复现和验证

```bash
pnpm -C packages/browser-ext run build
pnpm -C web exec vite build --outDir /tmp/xopc-browser-permissions-ui
XOPC_BROWSER_NATIVE_PERMISSIONS=1 XOPC_BROWSER_PRODUCTION_UI_ROOT=/tmp/xopc-browser-permissions-ui pnpm exec tsx scripts/verify-browser-setup-production.mts
```

脚本使用已有 Cloud OAuth，并创建隔离 HOME、Gateway、安装目录和 Chrome profile。看到 `cancel_chrome_debugging` 时，在对应测试 Chrome 的调试提示条点击 Cancel；看到 `resume_chrome_control` 后，在扩展点击 Resume browser control。脚本只等待和验证这两个原生 UI 动作，不自动替用户授权。报告位于 `/tmp/xopc-browser-native-permissions/result.json`。

本次包含 Skill 目录的 32 次主对话请求均成功；共观察到 39 次模型请求完成，结束时另有 1 次无工具的后台请求未观察到完成。用户最终回复已结束。Browser 出现 1 次预期的控制撤销拒绝，其余操作无异常。相关回归 19 个文件、204 项通过；根、Web 与扩展类型检查、Web/扩展生产构建和 Skill 校验通过。

## 剩余人工与跨平台验收

仍需人工记录首次安装文件选择器、不同平台的安装体验，以及在确实出现 Gatekeeper／TCC 等系统安全弹窗时的用户决策过程。当前已覆盖 Agent 工具策略拒绝、Chrome 原生调试提示条撤销，以及系统原生宿主执行受阻；不将其泛化为所有浏览器或系统权限弹窗均已验收。

macOS、Windows、Linux 的首次安装体验应分别记录。本轮真实 Chrome 测试在 macOS 上完成，不据此承诺其他平台均已完成实机验收。P1 的远程配对、Playwright 与远程服务安全凭据流程仍按设计后续实现。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
