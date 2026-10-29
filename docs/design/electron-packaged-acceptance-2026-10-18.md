# Electron 安装包验收 — 2026-10-18

后续 Apple 公证已完成：应用与 DMG 均 Accepted，真实下载隔离、首次安装/启动与 Gatekeeper 通过，详见 [公证验收记录](./electron-notarization-acceptance-2026-10-18.md)。下文保留当时打包验收的历史状态和原始哈希。

本轮继续 原生工作区验收（见本页合并摘要），改为运行生产主进程和安装包内资源，不使用测试宿主或 Vite。

## 验收方式

- `pnpm run electron:build` 完整执行 Node、Web、Electron main/preload、Gateway、extensions、原生模块和 electron-builder 打包链。
- 从生成的 DMG 复制应用到临时安装目录，保持包内容和签名完整。
- `node scripts/packaged-workspace-e2e.mjs /absolute/path/to/xopc.app` 启动真实应用。独立 `--user-data-dir`、xopc 状态目录、随机 loopback 端口和本地流式模型避免使用个人配置。模型服务只提供确定性回复，Gateway、SQLite、IPC、PTY 和 WebContentsView 均来自安装包。
- 使用 CUA 驱动原生界面。复用浏览器检查与桌面检查的前两段，随后运行 `scripts/packaged-workspace-e2e-cua.mjs`；这些检查不依赖测试宿主专用菜单。
- Chromium trace 使用启动参数采集，保留正常生产主进程与应用菜单。

## 发现并修复

1. 窄工作区中的文件树浮层覆盖浏览器或文件预览工具栏。打开后，原文件夹按钮仍在无障碍树中，但实际位置被树内按钮遮挡；再次点击可能刷新文件树而非关闭。浮层与遮罩现在根据活动工具栏的实际高度下移，并跟随标题换行/窗口尺寸更新，保持开关可点击。回归测试覆盖可见工具栏选择和高度变化。
2. 新会话已有默认模型时，工具页后台准备文件目录与终端并发调用 materialize。独立 IndexedDB 快照可能生成不同 commandId，第二次提交得到 `Conversation already exists`。SessionManager 现在按 Gateway identity 与 conversationId 共享进行中的 materialization，在成功和失败后清理；后台目录、终端、语音消费者不再竞争创建同一个会话。回归测试使用独立快照和两个 SessionManager 验证只保存/提交/确认一次。

相关回归：18 个文件、108 项测试通过。Web 构建（含 TypeScript）与 ESLint 通过。

## 最终结果

**最终 DMG 安装副本的 84 项原生检查全部通过**。只统计最终代码的结果；前两轮用于发现问题的运行不计入最终通过数。

| 检查组 | 通过数 | 关键内容 |
| --- | ---: | --- |
| 浏览器与已有能力 | 29 | 导航、前进后退、真实刷新、多标签、表单保留、文件保存、Sidechat 草稿/流式回复/中止、关闭保护、错误恢复、权限提示、地址栏 |
| 三个入口与终端 | 19 | More 搜索/分享及焦点、Context 运行目录、Plus Tools 去重、真实 PTY、多终端、隐藏后 shell 状态、混合工具共存 |
| 动画与窗口 | 19 | 连续混合标签切换、终端开合、原生视图尺寸跟随、工作区展开/还原/收起、两类文件树开关、菜单键盘操作、原生窗口缩放/还原 |
| 新会话与跨会话 | 6 | 首次发消息前创建真实终端并执行 shell，独立工作区，主草稿与原生网页状态保留；不再出现重复创建错误 |
| 退出重启的数据 | 3 | 同一安装包和数据目录重启后恢复会话、已保存文件和聊天记录 |
| 重启后再使用工具 | 8 | 主草稿恢复，四种 Tools 入口，文件渲染，浏览器原生内容，Sidechat 流式回复，真实终端执行及混合切换 |

生产主进程日志确认 `packaged=true`、Electron 42.4.1。首轮完整构建通过，随后每次修复均重新构建 Web 并重新签名生成 DMG/ZIP，再从 DMG 复制全新安装副本验收。最终包依赖验证通过，安装副本通过 `codesign --verify --deep --strict`。本轮未向下载服务发布任何包。

最终代码相关回归：**108 项测试、18 个文件全部通过**；Web 构建（含 TypeScript）、ESLint 和 `git diff --check` 通过。此前全量 Web 测试的既有基线失败见前轮记录，本轮未重复运行全量无关测试。

## 启动、退出与动画采样

- 冷启动内置 Gateway 就绪 **3,791 ms**；同一数据目录重启就绪 **2,048 ms**。这是服务就绪时间，非保证的端到端首帧指标。
- 原生退出操作后确认主进程退出，独立 Gateway 端口停止响应；再次启动后正常完成全部工具复测。
- 对最终代码的连续标签切换、终端开合、文件树开关、工作区开合与原生窗口缩放操作单独圈定 Chromium trace 时间段，排除启动阶段。
- 13,457 个渲染线程任务：p95 **0.781 ms**，最大 **10.977 ms**，超过 50 ms 的任务 **0**。
- 动画帧回调 p95 **0.631 ms**；Layout p95 **0.315 ms**；Paint p95 **0.197 ms**。
- 样本未发现长任务或视图残留/遮挡异常。这些采样不等于保证固定帧率或零掉帧。

## 产物与复现

- DMG：`dist/release/xopc-0.0.392-arm64.dmg`
- ZIP：`dist/release/xopc-0.0.392-arm64.zip`
- DMG SHA-256：`653d886e420182abf09d4c147e83af0e12f9db22c07f04dafde649771070dfd5`
- 汇总：`/tmp/xopc-packaged-acceptance-results.json`
- 分组结果：`/tmp/xopc-packaged-{browser,desktop,motion,new-session,relaunch,relaunch-tools}-results.json`
- 退出记录：`/tmp/xopc-packaged-exit-results.json`
- 动画窗口：`/tmp/xopc-packaged-motion-window.json`；指标：`/tmp/xopc-packaged-motion-metrics.json`；原始 trace 路径见汇总。
- 截图：`/tmp/xopc-packaged-native-final.png`（首次运行）；`/tmp/xopc-packaged-relaunch-final.png`（重启后混合工具）。
- 构建日志：`/tmp/xopc-packaged-build.log`、`/tmp/xopc-packaged-final-build.log`；回归日志：`/tmp/xopc-packaged-regression.log`。

复现顺序：启动 `scripts/browser-e2e-site.mjs`；启动 `scripts/packaged-workspace-e2e.mjs`；通过 CUA 运行浏览器套件、桌面套件（`motion: false`）、`runPackagedWorkspaceMotion` 和 `runNativeNewSessionTerminal`；原生退出并确认 PID 消失；运行 `scripts/relaunch-packaged-workspace-e2e.mjs`，通过 CUA 运行 `verifyPackagedRelaunch` 与 `runPackagedRelaunchTools`。动画时间窗口使用 macOS `mach_absolute_time` 转为微秒，对齐 Chromium trace 的 TimeTicks；`scripts/analyze-packaged-motion-trace.py` 按行提取该时间段的渲染事件，避免整份 trace 占用过多内存。

## 范围与边界

- 本轮验收平台为 **macOS Apple Silicon / arm64**。不代表 Windows、Linux 或 Intel Mac 安装包已验收。
- Developer ID 签名完整性通过；打包日志提示未配置公证凭据，**本次没有 Apple notarization**，不据此声称已通过下载隔离后的 Gatekeeper 公证验收。未绕过系统安全提示。
- 浏览器表单/历史与 PTY 进程保活覆盖应用运行期间的工具/会话切换。退出进程后，原生网页与 shell 进程会释放；本轮未增加跨进程恢复网页历史或 PTY 的新能力。
- 本地模型返回确定性流式文本，未模拟后台记忆/理解的结构化输出；由此产生的后台提取警告不属于此次工具交互结果。验收不涵盖后台记忆质量、发布更新与系统权限授予。

## 合并保留的前序集成验证

较早浏览器21项、原生测试宿主70项（28浏览器/33工作区/9新草稿）与本页最终DMG84项存在重叠，不相加。测试宿主使用独立ad-hoc签名Electron身份、真实生产preload/IPC/WebContentsView/PTY及隔离认证Gateway；完整包结果以本页84项为准。缺少模型的新草稿先校验model再保存materialize命令，错误后保留可编辑草稿和原地Retry terminal；不能留下空模型pending命令阻止恢复。

浏览器前序验证保留：外部文件改写导致revision冲突时保留本地稿，取消/确认放弃不覆盖外部版本；引用只加草稿不发送；Sidechat后台流式、停止和晋升正式聊天；375px窄栏、标签键盘操作/焦点恢复、刷新恢复文件标签。未保存正文/本地附件不作为持久标签内容。图表/Office/大目录、多小时Sidechat、完整审批/澄清和弱网未逐项由该21项套件验收。Codex对比仅据用户静态截图，不作实时行为或动画参数复刻声明。

测试宿主70项动画样本6716渲染任务，P95 1.342ms、最大25.564ms，非生产保证；最终DMG采样见本页。前序全量Web存在已在未改HEAD复现的message-list-visibility.test.tsx既有失败（keeps task result follow-ups without answer text and drops empty successful outcomes），没有放宽断言。测试宿主复跑入口保留scripts/workspace-e2e-server.mjs、browser-e2e-site.mjs、build-browser-e2e.mjs、start-workspace-desktop-e2e.mjs及workspace-desktop-e2e-cua.mjs；应使用独立fixture，不能对日常窗口运行。原生浏览器契约见[统一工作区方案](unified-workspace-and-embedded-browser.md)。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
