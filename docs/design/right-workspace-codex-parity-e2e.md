# 工作区 E2E、Codex 对齐与动效复核

日期：2026-10-18。结论：当前文件 / 文件树 / Sidechat 工作区的核心浏览器链路已通过真实 Gateway E2E；同时修复确认框阻塞、放大布局文件树判断和键盘焦点问题。**尚不能宣称与 Codex 全能力对齐，也不能宣称 Electron 原生验收或 60fps 性能验收完成。**

## 对比依据

Codex 侧采用本次用户提供的截图：混合文件标签、＋入口、Tools 页、Files / Side chat / Changes / Terminal / New page 卡片、地址栏、Suggested 页面，以及顶栏列表、放大和数量入口。本次工具禁止读取 Codex 原生应用，因此没有将截图无法确认的关闭语义、拖拽、状态恢复、Sidechat 生命周期、浏览器引擎或动画参数当作已观察事实。

xopc 侧依据当前 renderer 源码、真实浏览器交互、真实 Gateway API / 实时事件 / SQLite / 文件落盘，以及自动化回归。浏览器方案参见 [统一工作区与内置浏览器](./unified-workspace-and-embedded-browser.md)。

## 交互和能力对齐矩阵

| 能力 | Codex 截图所示 | xopc 当前行为 | 结论 / 差距 |
| --- | --- | --- | --- |
| 左聊天、右工作区 | 文件在工具区域展示 | 主聊天保持挂载，右侧文件与 Sidechat 共用区域 | 核心布局对齐 |
| 混合标签 | 多文件标签与＋ | 文件、Files、Sidechat、Tools 共用标签条 | 已实现；拖拽重排、固定标签暂未提供 |
| ＋起始页 | Tools、Suggested | Tools 与已有文件 / 侧聊的 Continue with | 交互结构接近；没有浏览历史推荐 |
| 文件内容 + 文件树 | 内容左、文件树右，支持过滤 | 宽度足够并排，窄栏显式打开浮层；搜索、刷新、定位 | 已实现；本轮修复放大后仍误用浮层 |
| 文件读取与源码 | Markdown、View source、Open | 复用预览插件、可编辑源码、串行自动保存、revision 冲突保护 | 已验证 Markdown / JSON / SVG；其他插件见验证边界 |
| 标签列表、放大、数量入口 | 截图可见图标 | 列表选择、放大 / 还原、数量按钮收起 | 已验证；数量按钮表达的是已打开标签数量 |
| Side chat 入口 | Tools 卡片 | 工具卡片 / 顶栏 / 选区入口，创建后原位替换 Tools 标签 | 入口结构对齐；截图不足以比较底层会话语义 |
| Sidechat 能力 | 截图未展示内部行为 | 独立草稿、模型与附件、流式响应、后台状态、停止、审批 / 澄清、过期、保存笔记与转正式聊天 | 保留原有能力；分别标注真实 E2E 与组件测试覆盖 |
| 收起与关闭 | 截图不足以确认资源语义 | 收起保留控制器和标签；关闭侧聊等待服务端成功；文件冲突阻止关闭 | 明确区分视图隐藏与资源关闭 |
| 内置浏览器 | 地址栏、前进 / 后退 / 刷新、建议网页 | 当前尚无原生网页 Tab 引擎 | **主要能力缺口**；不能用外部浏览器入口冒充内置浏览器 |
| Changes | Tools 入口 | 暂无统一 Changes 标签 | 待实现 |
| Terminal | Tools 入口 | Electron 有已有终端面板入口；未统一为同级标签 | 部分复用，桌面原生链路本轮未验收 |
| New page | Tools 入口 | 暂无同级新建页面标签 | 待实现 |
| 动效 | 静态截图无法判断时长 / 帧率 | 合成层位移 / 透明度，220ms 进入、150ms 退出 / 内容切换，快速反向续接当前姿态 | 本轮已实现并验证取消逻辑；不是对 Codex 参数的复刻 |

## 本轮修复

1. 增加可中断的工作区进入 / 退出和标签内容过渡。动画只使用 `transform` / `opacity`；不对分栏宽度做逐帧 CSS 动画，不新增动画依赖，不长期设置 `will-change`。
2. 关闭期间保留内容与控制器，退出完成后隐藏；关闭中的区域 inert，避免隐藏控件被误操作。快速重开取消退出，并从中断时的姿态继续。
3. 检测 `prefers-reduced-motion`，初始化和偏好变化均可跳过 / 取消动画。缩放拖动直接响应，不叠加过渡造成拖尾。
4. 放大后的文件树使用实际可用宽度判断并排；显式开关不再错误地使用放大前的宽度触发浮层。
5. 保存冲突后的“放弃修改”改为应用内两步确认，支持取消保留草稿；不再使用阻塞性的 `window.confirm`。
6. Files 的树内容与其他标签共用正确的 tabpanel 关联；非活动标签关闭按钮不挤入 Tab 键序列；收起工作区后焦点回到文件入口。

## 真实端到端环境

新增两个可复用脚本：

- `scripts/workspace-e2e-server.mjs`：独立临时 state、SQLite、Agent workspace、本地确定性流式模型和真实 Gateway；通过项目原 Vite 配置提供当前 UI，保留 React Compiler。运行前需有 `dist/src/cli/bin.js`。
- `scripts/workspace-e2e-cua.mjs`：接收 CUA 的 tab 与 viewport 对象，使用语义定位器执行 21 个断言。它本身不启动浏览器，不注入应用状态，不伪造文件 / Sidechat API。

运行服务：`node scripts/workspace-e2e-server.mjs`。元数据写入 `/tmp/xopc-workspace-e2e.json`，包含临时 URL 和仅供本地 fixture 使用的测试令牌。使用该 URL 登录；首次启动时跳过欢迎向导，保持英文以匹配测试文案。在新的 CUA 测试页中导入 `runWorkspaceE2e`，传入 tab 和 viewport。结束后 Ctrl+C 停止 fixture；临时状态保留便于检查。不要对正式聊天 URL 运行此脚本。

本轮使用已有编译后的 Gateway runtime 与当前源码 UI，实际经过登录、HTTP、WebSocket、Sidechat 服务和磁盘读写；并非纯 UI mock。Gateway 源码另跑文件和 Sidechat 服务回归。本地模型只返回确定性内容，`E2E_HOLD` 保持运行以测试停止，不调用付费模型。

## 通过的 E2E

可复用脚本整轮 21 / 21 通过：

| 分组 | 通过的行为 |
| --- | --- |
| 文件 | Markdown 渲染、JSON 渲染、主聊天仍可见、文件去重、编辑稿跨标签保留、引用只加入输入框不发送、图片缩放到 115% |
| 导航 | 浏览器 Back 恢复 Files、Tools 起始页、创建侧聊替换 Tools、收起保留全部标签、溢出列表选标签、Home + Enter 键盘切换 |
| Sidechat | 独立草稿保留、真实流式回复、非活动标签显示 Running、停止后恢复 idle |
| 布局 | 放大工作区内联文件树、375px 边界不溢出、375px 树浮层、返回主聊天 |

另外单独真实交互与磁盘核对通过：

- 编辑文件后切到 JSON，磁盘确实保存了浏览器输入的内容。
- 外部改写文件，再编辑旧 revision：保存冲突拦截关闭、本地草稿保留；继续编辑、取消放弃、确认放弃均可完成；重新打开读取外部版本，磁盘未被旧草稿覆盖。
- 页面刷新后登录与文件标签恢复；未保存正文不会被当作可恢复标签数据持久化。
- Sidechat 实际发送后转为正式聊天；独立聊天可以打开，父会话保留原标签，工作区互不串用。
- 文件树过滤返回文件；Escape 关闭树浮层；分栏及文件树可用键盘调宽。
- 收起工作区后键盘焦点回到文件入口。
- 可复用脚本所在测试页的控制台：未捕获 error / warning。

证据：`/tmp/xopc-workspace-e2e-results.json`、`/tmp/xopc-workspace-e2e-final.png`。额外检查中有与 21 项自动化断言重叠的步骤，不将它们相加报告为独立用例数。

## 自动化回归结果

| 检查 | 结果 |
| --- | --- |
| 范围 Web 回归 | 35 文件、176 项通过 |
| 全量 Web | 486 文件：485 通过、1 失败；2596 项：2595 通过、1 失败 |
| Gateway 文件 / Sidechat / 澄清生命周期 | 6 文件、50 项通过 |
| 动效专项 | 4 项通过：控制器保留、中断续接、仅合成属性、减少动态效果 |
| TypeScript、生产构建、ESLint | 通过；保留构建既有 chunk 体积等提示 |

全量唯一失败仍为 `web/src/features/chat/messages/__tests__/message-list-visibility.test.tsx` 的 `keeps task result follow-ups without answer text and drops empty successful outcomes`。此前已经在未修改 HEAD 的独立导出目录复现，属于现有失败；本轮未放宽该断言或修改无关消息业务。

日志：`/tmp/xopc-workspace-e2e-all-web.log`、`/tmp/xopc-workspace-e2e-final-regression.log`、`/tmp/xopc-workspace-e2e-server-tests.log`、`/tmp/xopc-workspace-e2e-motion-final.log`、`/tmp/xopc-workspace-e2e-lint-final.log`、`/tmp/xopc-workspace-e2e-build-final.log`。

## 验证边界与后续优先级

- 本轮没有 Electron 打包应用的端到端操作：系统打开、终端 PTY、原生窗口标题栏、WebContentsView 网页 / Cookie / 下载 / 权限均不能记为通过。
- PDF、Office、大表格、超大目录、多小时 Sidechat 过期、断网重连、审批 / 澄清完整人机链路未逐项跑真实浏览器 E2E；相关现有组件 / 服务回归通过不能替代这些验收。未保存内容遇到页面刷新仍有丢失边界。
- 未采集 GPU trace、长帧分布或低性能设备帧率，不能保证所有设备 60fps。已落实避免布局属性动画、取消过渡、减少动态效果；进一步应在目标 Electron 包上测滚动、拖动、快速切换与媒体加载。
- 下一阶段首先落地原生 Browser Tab 与网页生命周期，复用现有浏览器控制合同，并验收 native guest 和 DOM 弹层的遮挡 / 焦点关系；然后统一 Terminal / Changes，再补 New page、标签拖拽重排和建议网页。每项应有独立可执行的 E2E，不在 Tools 中先放无效入口。
