# Apple 公证与首次安装验收 — 2026-10-18

延续 [打包后验收](./electron-packaged-acceptance-2026-10-18.md)，使用同一份通过 84 项原生验收的 macOS arm64 0.0.392 应用代码，不重新编译应用。

## 修复与流程

此前 `electron-builder.mjs` 没有读取仓库 `.env.local` 中的签名/公证设置；旧 `electron-sign-local.mjs` 还向仓库父目录寻找配置并绕开当前隔离打包流程。新增共享设置读取器，只读取签名相关键，兼容 XOPC 前缀，优先采用显式 CI 环境设置，不输出密码。两个入口统一接入；4 项配置回归测试通过。DMG 默认显式签名。

1. 对原始签名应用 ZIP 提交 Apple 公证。
2. Apple Accepted 后装订 `.app` 票据，并验证票据与签名。
3. 以装订后的 `.app` 重新生成并签名 DMG；ZIP 也重新归档，避免 electron-builder 的旧归档缓存漏掉票据。
4. 对签名 DMG 再提交 Apple 公证，Accepted 后装订 DMG 票据。
5. 票据装订完成后重新生成 DMG/ZIP 的 blockmap 与 `latest-mac.yml` 的哈希/大小，避免更新元数据引用装订前的字节。
6. 从本地验收页通过 Chrome 正常下载最终 DMG，检查系统写入的 quarantine 标记。验证 Gatekeeper 和安装应用；通过 LaunchServices 在全新数据目录首次启动，保留隔离标记。

流程参考 Apple 官方 [自定义公证工作流](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow) 与 [软件分发打包说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)。

## 最终结果

**公证、票据装订、首次安装和启动验收全部通过。**

| 项目 | 结果 |
| --- | --- |
| 应用公证 | Apple `Accepted`；任务 `3b6621a0-4aa0-4222-9a77-f04835511a04`；`issues: null` |
| DMG 公证 | Apple `Accepted`；任务 `7ca84cd0-86b4-43c6-a9e6-4780ad4621da`；`issues: null` |
| 两层票据 | `.app` 与 `.dmg` 均成功 staple，且 `stapler validate` 通过 |
| 签名 | DMG 及安装应用 `codesign --verify` 通过，应用包括 `--deep --strict` |
| Gatekeeper | 系统 `assessments enabled`；DMG 与安装应用的 `--ignore-cache --no-cache` 评估均 accepted，来源 `Notarized Developer ID` |
| 分发策略 | 安装应用 `syspolicy_check distribution --json` 通过 |
| ZIP 与更新 | 最终 ZIP 解压后应用票据验证通过；DMG/ZIP 哈希、大小、blockmap 和 `latest-mac.yml` 均一致 |
| 新增回归 | 2 个测试文件、5 项测试通过；脚本 ESLint 与 `git diff --check` 通过 |
| 公证后原生复测 | 48 项全部通过：浏览器/文件/Sidechat 29 项，三个入口/真实终端/混合切换 19 项 |

## 真实下载和首次安装

使用独立 Chrome 原生窗口下载本机验收服务提供的最终 DMG。下载文件的 SHA-256 与最终发行 DMG 一致。Chrome 自动写入 `com.apple.quarantine`：

- 下载 DMG：`0281;6ad44225;Chrome;0DB67A38-C194-4C20-B4F6-81BC7BD43E9B`
- Finder 复制后的应用、首次启动前：`0381;6ad44225;Chrome;0DB67A38-C194-4C20-B4F6-81BC7BD43E9B`
- 首次启动、正常确认 Open 后：`03c1;6ad44225;Chrome;0DB67A38-C194-4C20-B4F6-81BC7BD43E9B`

通过 Finder 打开下载 DMG，正常显示安装窗口，复制应用到此前为空的独立目录 `/tmp/xopc-notarized-install-3y86o8ow/xopc.app`，没有替换用户已安装的应用。安装应用保留下载隔离记录。

通过 macOS LaunchServices（`open -a`）启动该副本，使用全新 Electron/xopc 状态目录。系统首次打开确认明确显示：**Apple checked it for malicious software and none was detected.** 通过正常 Open 按钮继续，未使用 Open Anyway、未关闭 Gatekeeper、未删除或改写隔离属性、未绕过安全警告。

总计约 38 秒的首次启动等待包含系统确认的等待与取证时间，不作为性能指标。确认后应用正常进入欢迎引导和聊天界面，内置 Gateway 服务可用；选择 Skip for now，未授权任何个人数据来源。随后完成 48 项原生功能复测。退出后实际应用 PID 与内置 Gateway 均停止。

安装应用的 `app.asar` SHA-256 与前一轮通过 84 项验收的构建一致；本轮更改签名/公证脚本与验证工具，没有重新编译产品代码。

## 最终产物与证据

- 公证 DMG：`dist/release/xopc-0.0.392-arm64.dmg`
- 包含已装订应用的 ZIP：`dist/release/xopc-0.0.392-arm64.zip`
- 最终 DMG SHA-256：`27d98ad8b567e9f6bfc67a88802f5297602e53dc6a41333fb21ee25974adc23f`
- 总汇：`/tmp/xopc-notarization-acceptance-results.json`
- Apple 应用/DMG审核日志：`/tmp/xopc-notary-app-log.json`、`/tmp/xopc-notary-dmg-log.json`
- 票据记录：`/tmp/xopc-notary-app-staple.log`、`/tmp/xopc-notary-dmg-staple.log`、`/tmp/xopc-notary-zip-ticket.log`
- 10 项系统检查：`/tmp/xopc-notary-gatekeeper-results.json`
- 真实下载、哈希及隔离记录：`/tmp/xopc-notarized-download-results.json`、`/tmp/xopc-notary-installed-quarantine.json`
- 48 项原生检查：`/tmp/xopc-notary-browser-results.json`、`/tmp/xopc-notary-desktop-results.json`
- 截图：`/tmp/xopc-notary-dmg-window.png`、`/tmp/xopc-notary-gatekeeper-first-open.png`、`/tmp/xopc-notary-first-launch.png`

## 复现与范围

1. 正常构建使用 `pnpm run electron:build`；主入口与 `electron-sign-local.mjs` 现在读取仓库 `.env.local` 中的签名设置。CI 显式环境配置优先，不打印密码。
2. 对已有产物公证，使用 `node scripts/notarize-electron-artifact.mjs submit artifact.zip result.json`，通过 `info` 查询任务，Accepted 后 `xcrun stapler staple path/to/xopc.app`。
3. 从已装订应用生成签名 DMG，确认归档未使用旧缓存；对 DMG 再提交公证，Accepted 后 staple DMG。不要在提交后重新签名或修改代码。
4. 最后运行 `node scripts/refresh-electron-mac-artifacts.mjs`，再运行 `node scripts/verify-notarized-mac-artifact.mjs path/to/release.dmg path/to/installed.app`。
5. 本轮实际下载由 `scripts/notarized-dmg-download-e2e.mjs` 提供。所有 Finder/Chrome 输入均通过 CUA，首次运行使用 `XOPC_E2E_LAUNCH_SERVICES=1 node scripts/packaged-workspace-e2e.mjs path/to/installed.app`。

验收环境为这台 macOS Apple Silicon 开发机上的新安装目录和全新应用数据目录，**不是全新 macOS 设备或虚拟机**。已通过真实下载隔离、系统首次运行确认和无缓存 Gatekeeper 检查；不据此宣称在另一台干净 Mac 上或断网环境中完成验收。未向公开下载站发布本次产物。
