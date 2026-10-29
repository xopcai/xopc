# Windows Computer Use：Gateway 网络与安装包验证

日期：2026-10-25。验证对象为 Windows x64 的正式 NSIS 打包配置和生产应用入口。

最终安装包实测通过：Windows build `10.0.26200`、Electron `45.0.0`，真实 `xopc-cloud/auto` 编排与 `xopc-cloud/computer` GUI 模型。Computer 模型请求 4 次，实际输入 3 次（`setValue`、`pressKeys`、`click`）；原生条件验证 1 次，未知派发 0 次。Gateway 留存 31 条成功端点调用审计，包含发现、观察、授权等待与动作，并非 31 次输入。重启、授权保留、无输入重放和卸载检查均通过。

相关回归 553 项通过、9 项跳过；根项目类型检查、Web 构建、Electron 构建、打包 Gateway 预检及安装后依赖布局检查通过。当前安装包 Authenticode 为 `NotSigned`。

## 执行链路

`NSIS 安装 → 安装目录中的 xopc.exe → 包内 Gateway 子进程 → 正式会话 HTTP API → 真实云端聊天模型 → computer_use → 真实 Computer 模型 → realtime WebSocket → 安装包中的 Broker / Cua / UIA → 原生测试窗口 → HTTP 截图上传 → 原生条件验证 → 会话报告与释放控制`。

验证不替换安装包主入口、不注入模拟模型、不用进程内端点传输。Playwright 只通过临时开启的本机 CDP 连接应用主窗口，调用正式 preload API 为测试程序授权、读取端点状态；任务从 `/api/sessions/:conversationId/inputs` 提交，聊天模型按通常流程调用工具。测试通过原生应用自行写出的状态验证中文文字、End 键事件和唯一一次 Verify 点击。

## 检查内容

- 运行实际 NSIS 安装、检查安装后的 app.asar 和外置驱动/SDK、启动正常主进程及包内 Gateway，最后运行卸载程序。
- 核对安装后 app.asar 与本次打包 staging 的 SHA-256 一致，并运行最小运行时依赖检查。
- 桌面端完成 principal 注册和签名 WebSocket hello；本地身份仅保存加密私钥。
- 未认证 Gateway 请求返回 401；无效 realtime ticket 被 4401 关闭；2 MiB 截图请求携带无效 upload grant 时返回 `INVALID_UPLOAD_GRANT`，验证请求实际到达上传授权检查。
- 真实模型完成输入任务，使用原生窗口中的 `PASS: Windows input verified` 验证条件；报告保留实际模型请求数、已完成输入和未知派发计数。
- 密码框保持空白、只读框保持 `READ ONLY`，Verify 点击计数等于 1。
- 重启安装后的正常应用和 Gateway，核对 principal 保持、连接 ID 更新、本地授权保留、已完成输入没有重放。
- 卸载后安装目录中的 `xopc.exe` 消失；恢复测试前的当前用户协议注册。

脱敏结果见 安装后验证证据（历史产物已移入 Git 历史）。截图、会话完整内容、令牌、凭据与私钥不进入该证据文件。

## 复现

在已连接 XOPC Cloud、没有安装或运行 xopc 的 Windows x64 交互账户执行：

```powershell
pnpm run build:node
pnpm run build:web
pnpm run electron:build:artifacts
node scripts/electron-builder.mjs --win --x64
node --import tsx scripts/run-computer-windows-installed-validation.mts
```

可在最后一行追加 NSIS 安装包的绝对路径。脚本使用 `xopc-cloud/auto` 和 `xopc-cloud/computer`，产生正常模型用量；没有配置替代模型或自动回退。测试前拒绝覆盖现有安装。安装、Electron userData、配置、数据库、原生样例和临时证据均放入 `.cache/installed-windows-<uuid>/`，仅沿用现有凭据目录。

新增 `XOPC_ELECTRON_USER_DATA_DIR` 可以在单实例锁建立前指定 Electron 数据目录；原有 `XOPC_STATE_DIR` 管理 xopc 状态目录，两者需要一起隔离。验证结束会卸载临时应用并恢复原有协议注册，保留测试目录供排查。

## 修复与持续回归

- Windows 退出路径在 `taskkill` 抛异常或返回失败状态时均执行子进程终止兜底，避免残留 Gateway 占用端口。
- 将已有的 Gateway 启停、进程诊断、可信 renderer 和 Electron 路径测试纳入 `computer-desktop` Vitest 项目；退出测试明确覆盖 Unix 与 Windows，以及 Windows tree kill 的失败兜底。
- 安装包依赖检查接受绝对 app.asar 路径，可直接检查安装后的资源。

本机功能验证不等于签名分发认证。当前产物的 Authenticode 状态记录在证据中；未签名产物不能据此宣称通过 SmartScreen 信任、签名自动更新或组织部署策略。验证范围是本机 loopback Gateway、当前 Windows x64 和原生样例，不覆盖公网代理、混合 DPI、RDP、提权窗口、ARM64 或所有第三方应用。

历史产物保留说明（2026-10-29）：本页所涉已清理截图、逐次 JSON 与源码快照可从 Git 历史恢复；上文数字和失败限制保留为历史观测，不代表本次重新验收。复跑输出应指定临时目录；旧路径仅记录当次运行位置。
