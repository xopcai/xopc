# Electron 本地与远端测试说明

这份说明同时记录当前预览的可测范围及最终交付门槛。当前并非完整方案已经合入 main 的发布说明；最终合并、安装包摘要与未通过项应在完成后更新，不能用早期构建代替。

## 隔离测试环境

不要用真实用户数据验证数据库升级、删除、断线或崩溃。测试服务器使用专用工作区和凭据；本机使用全新的状态目录与 Electron userData。

macOS arm64 当前已验证预览副本：`/tmp/xopc-electron-preview-20261101/installed/xopc.app`，来自实际 DMG，整体文件摘要为 `effe3a59fa2cbed8035a9f3d6b590677ce7d69827c227053dde18304c28a8c0b`。DMG 为 `/tmp/xopc-electron-preview-20261101/xopc-preview-arm64.dmg`，SHA-256 为 `3fa5dcc22cb19f28818dc3995f6b2b66773ee1b86ebf17511786e962658730b4`。这是 Developer ID 签名、尚未公证的内部预览。它包含远端聊天与只读观察，不包含完整 P2b/P3/P4。后续代码中的执行账本/监督器尚未在该应用中接入。

在仓库终端运行隔离启动器。它创建私有目录、随机空闲 Gateway 端口和专用 token，清除继承的 xopc 路径及模型凭据；不会复用真实用户数据库或默认端口：

```sh
node scripts/launch-electron-sandbox.mjs \
  --app /tmp/xopc-electron-preview-20261101/installed/xopc.app
```

终端会打印测试目录。重启复用该目录时，显式加上 `--state /tmp/实际打印的目录 --reuse`。启动远端连接入口再加 `--remote`；该标志只打开连接页，不启动本地 Agent。目录和报告不要删除，便于核查失败。

首次使用可通过应用设置配置测试模型。不要将 key 粘贴到测试报告、截图或 issue 中。

## 本地模式

1. 默认启动，不带远端参数。确认原本地界面、聊天流式响应、会话历史与设置正常。
2. 在测试工作区读取/保存文件、打开终端和内置浏览器；未授权目录应被拒绝。
3. 退出并使用相同隔离目录重启，检查会话保留；拥有的 Gateway 能正常重启。
4. 复用外部测试 Gateway 时，退出应用不应停止它，应用也不能冒充其进程所有者执行重启。
5. 远端配置损坏或远端服务器不可用时，默认本地启动仍应正常。

## 远端聊天

退出应用后，使用相同隔离目录，给启动器加上 `--remote`。

1. 新建连接，选择直接 HTTPS 或现有 SSH 隧道。SSH 模式填本机隧道的规范 loopback origin；服务实际仍视为远端。
2. 在连接页输入专用测试 Gateway 凭据并连接。身份变化、认证失败或版本不兼容应明确拒绝；不应自动改连本地。
3. 新建会话，发送文字，检查流式响应、历史与取消。中断网络后恢复，确认没有重复提交聊天输入；结果不确定时保留恢复提示。
4. 在不同 Gateway 间切换，确认草稿、会话、订阅和身份不串用。
5. 本机状态目录不应创建远端会话数据库或远端 Agent 工作区；聊天应在服务器执行。

## 本机只读能力

1. 在远端聊天的“本机能力”入口打开连接设置，先登记此电脑。取消原生登记对话框不应创建可用设备；批准后产生独立设备身份。
2. 授权设备状态或选择截图来源；首版一次只激活其中一类。勾选聊天中的本机只读能力，再让 Agent 显式使用已授权工具。
3. 截图来源由本机选择，调用方不能改成其他窗口/显示器。每次截图必须再次确认；取消应不发送图像。测试建议先选只含合成数据的当前远端聊天窗口。
4. 显示器截图需要 OS 屏幕录制权限。未授予时应拒绝并显示恢复指引；不要为了验收绕过 OS 权限。
5. 本机停止后，设备能力立即不可用；勾选本机能力的未发送草稿应保留，不应悄悄改在服务器执行。主动取消勾选后才允许发送服务器任务。
6. 撤销设备、退出应用或切换 Gateway 后不自动恢复本机批准。服务器撤销未确认与本机已停止必须分别显示。

当前原生截图验收仍待解锁本机后完成，不能将上述检查当作已通过结果。截图实际进入模型后遵循既有会话保存策略；上传传输缓存使用短期内存帧，不等于会话中没有图像。

## 自动验证与最终合并

在仓库中使用 pnpm：

```sh
pnpm run typecheck
pnpm exec vitest run --project computer-desktop gateway-connections
pnpm exec vitest run --project integration desktop-observation-e2e desktop-screen-e2e desktop-operation-crash-e2e desktop-operation-supervisor-e2e
pnpm run electron:build
```

实际安装包的本地回归可运行：

```sh
node scripts/verify-electron-installed-local.mjs \
  --app /absolute/path/xopc.app \
  --output reports/manual-installed-local.json
```

原生截图监督器需屏幕已解锁，且实际点击原生对话框；不得用自动批准替代：

```sh
node scripts/verify-electron-desktop-enrollment.mjs \
  --app /absolute/path/xopc.app --screen \
  --output reports/manual-native-screen.json
```

报告路径须使用新名称，避免覆盖失败证据。完整功能交付前还需 J2 协议/执行权接线、J3 故障验收、P3 授权工作区与工具、P4 后台任务的专项测试。长测和性能按用户要求并行保留，不放宽原预算，不冒称已通过。

最终合并采用 rebase 到最新 origin/main 后 fast-forward，或等价的线性 PR 合并；不创建 merge commit，不强推已发布的 main。合并前检查所有门槛与 CI；主工作区的未跟踪文件先原样备份，不能覆盖或丢弃。最终 Electron 包必须在实际合并后的提交上重新构建，并附提交号、文件摘要、平台与上述测试报告。
