# Chrome 浏览器扩展

xopc Chrome 扩展在浏览器侧栏中提供精简但完整的聊天体验，并可在你明确授权后附加或操作当前页面。扩展使用与桌面端、Web 控制台相同的持久 Session，因此可以在不同入口继续同一段对话。

扩展依赖正在运行的 xopc Gateway；Gateway 离线时，扩展不会绕过它直接调用模型。

## 已提供的能力

- 持久对话、最近 Session 选择、流式回复、停止、重试，以及侧栏关闭后重新打开的运行恢复。
- Markdown、代码块、链接、复制、工具执行状态、错误和完成一次对话所需的关键审批状态。
- 文件、截图、PDF、当前页面、选中文字，以及显式标签页 mention 上下文。
- 通过已认证 Gateway Realtime 执行浏览器控制。
- 与 Gateway 控制台一致的亮色和暗色主题。

侧栏有意减少了管理功能。Agent、模型、工具、远程访问和高级浏览器策略仍在桌面端或 Web 控制台配置。

## 从桌面端或 Web 控制台安装

1. 启动 Gateway。
2. 打开 **设置 → 浏览器**。
3. 启用浏览器控制，并选择 **Chrome 扩展**。
4. 点击 **安装扩展文件**。xopc 会准备固定扩展目录和本机发现程序。
5. 点击 **打开扩展页**，开启 **开发者模式**，然后选择 **加载已解压的扩展程序**。
6. 选择 xopc 显示的目录。命令行默认目录是 `~/.xopc/bin/browser-ext`；应选择该目录本身，不要选择里面的 `dist`。
7. 可按需固定 xopc 图标，然后点击工具栏图标打开侧栏。

Chrome 不允许普通应用静默安装未上架的解压扩展。因此，在 Chrome Web Store 或企业策略分发之外，首次 **加载已解压的扩展程序** 无法省略。Electron 和 Gateway 可以自动准备、更新和修复文件，但不能绕过这条浏览器安全边界。

## 从命令行安装

```bash
xopc browser extension install
xopc browser extension doctor
xopc browser doctor
```

安装命令会输出准确的 `extensionDir`，在 `chrome://extensions` 中加载该目录。健康状态应满足：

- `installed: true`；
- `extensionDir` 有效；
- 受支持的本机系统上 `nativeHost.installed: true`；
- 没有 `needsRefresh` 或 `needsChromeReload`。

macOS 和 Linux 当前会为 Chrome、Chrome for Testing、Chromium、Microsoft Edge 和 Brave 安装本机自动发现。Windows 可以使用扩展和正常配对流程，但目前不会自动安装 Native Messaging 本机发现。

## 源码开发环境

先构建、再复制扩展，避免固定安装目录收到旧文件或不完整产物：

```bash
pnpm install
pnpm -C packages/browser-ext run build
pnpm run dev -- browser extension install
pnpm run dev -- gateway
```

然后加载安装命令输出的 `extensionDir`。修改扩展代码后执行：

```bash
pnpm -C packages/browser-ext run build
pnpm run dev -- browser extension install
```

打开 `chrome://extensions`，找到 xopc 并点击 **重新加载**。测试页面附加或控制前，还要刷新已经打开的目标页面。

`pnpm run pack:browser-ext` 会构建扩展并生成分发压缩包，但普通开发循环不需要它。`pnpm run sync:browser-ext-version` 属于发布流程，不能替代重新构建或在 Chrome 中重新加载。

## 本机自动连接

在受支持的本机安装中，打开侧栏通常无需配对码或 Gateway 审批即可连接：

1. Gateway 启动时安装或修复固定扩展目录与 `ai.xopc.browser` Native Messaging manifest。
2. 扩展生成不可导出的 P-256 设备密钥。
3. native host 只发现 loopback Gateway，并申请绑定固定扩展 ID 与公钥指纹的短时、一次性 enrollment。
4. 扩展验证 Gateway 签名，保存 scope 受限的设备凭据，并建立已认证 Realtime 连接。

Native Messaging 只用于本机发现和 enrollment，不承载聊天正文、页面内容、owner token 或长期凭据，也不会常驻充当消息代理。

点击 **Disconnect** 会撤销浏览器设备，删除凭据、私钥和待发送 outbox，并关闭自动重连。需要重新启用时，主动点击 **Connect local Gateway**。

## 远程或服务器 Gateway

运行在另一台电脑或服务器上的 Gateway 不会获得本机自动批准。这是安全边界：网页、远程服务器或伪造的 localhost 响应都不能静默登记浏览器设备。

1. 通过 Tailscale 或 HTTPS 等受保护入口暴露 Gateway，参阅[远程访问](./remote-access.md)。
2. 在 Gateway 管理入口生成新的浏览器配对链接。
3. 将链接粘贴到扩展。
4. 对比确认码，并在 Gateway 中批准请求。

扩展只申请所选 Gateway origin 的访问权限。使用 extension driver 时，用户浏览器需要保持在线；无人值守的服务器自动化更适合 Playwright 或已配置的远程浏览器，不应依赖某个用户的 Chrome 会话。

## 页面与站点权限

安装扩展不代表 xopc 可以永久读取所有网页。

| 操作 | 权限行为 |
| --- | --- |
| 普通聊天，不附加页面 | 不读取当前页面 |
| 附加当前页面或选中文字 | 需要时申请该页面 origin 的权限 |
| mention 另一个标签页 | 需要时申请目标标签页 origin 的权限 |
| 附加或控制当前标签页 | 创建明确的 Session-to-tab binding，并执行 Gateway 浏览器策略 |
| 高影响动作 | 即使已有站点权限，仍执行配置的审批策略 |

Manifest 把 HTTP/HTTPS 声明为可选站点权限，因此 Chrome 可以按 origin 单独授权。普通使用不需要选择 **在所有网站上**。Chrome 内部页面、Chrome Web Store、扩展页面以及其它受限制 scheme 无法读取或控制。

只有用户明确操作后才采集页面文字。基础页面快照会排除密码、一次性验证码、支付字段、表单、脚本、隐藏内容和 iframe。网页内容始终作为不可信输入，不能通过页面文字为自己提升权限。

## 更新扩展

xopc 将解压扩展维护在固定路径。Gateway 或桌面端更新可以直接替换该目录的文件，不必再次执行 **加载已解压的扩展程序**。

Chrome 不会在文件变化后自动重新加载解压扩展。如果 **设置 → 浏览器** 显示版本不一致或 **需要重新加载扩展**：

1. 打开 `chrome://extensions`。
2. 找到 xopc，点击 **重新加载**。
3. 刷新后续需要读取或操作的标签页。
4. 返回 **设置 → 浏览器**，执行连接测试。

`release:patch` 会同步扩展 Manifest 与核心 xopc 版本；生产构建还会验证侧栏、后台 Service Worker、Manifest 和必需资源完整存在。

## 故障排查

### 侧栏打开后空白

1. 运行 `xopc browser extension doctor`，确认 `installed: true`。
2. 确认 Chrome 加载的是包含 `manifest.json` 的目录，而不是 `dist/`。
3. 重新安装文件、重新加载扩展，再打开侧栏：

   ```bash
   xopc browser extension install
   ```

4. 源码开发时，必须先构建扩展再执行安装命令。
5. 在 `chrome://extensions` 中检查扩展 Service Worker 是否有初始化错误。

### 扩展一直提示等待批准

- 同机 macOS/Linux 安装通常会自动 enrollment。运行 `xopc browser extension doctor`，并用 `xopc browser extension install` 修复 native host。
- 确认正在运行的 Gateway 与安装命令使用同一个 xopc Profile、状态目录和配置路径。
- 远程和服务器 Gateway 始终需要 owner 手动批准配对。
- 如果之前点击过 **Disconnect**，自动 enrollment 会保持关闭，直到主动点击 **Connect local Gateway**。

### Chrome 提示“Extension manifest must request permission to access this host”

当前版本已将 HTTP/HTTPS 声明为可选站点权限，并在用户明确执行页面操作时申请准确的 origin。如果仍出现该错误：

1. 更新 xopc，并重新安装扩展文件。
2. 在 `chrome://extensions` 重新加载 xopc；Chrome 可能仍在运行旧 Manifest 对应的 Service Worker。
3. 打开扩展的 **详情 → 网站访问权限**，确认目标站点没有被禁用。优先选择 **点击时** 或指定站点，不必授权所有网站。
4. 刷新目标页面，然后重新点击 **附加页面**。
5. 确认目标是普通 `http://` 或 `https://` 页面，而不是 Chrome 内部页或 Web Store。

如果用户拒绝新权限，或授权后页面采集立即失败，xopc 会移除本次新授予的 origin，并在下次明确操作时重新申请。

### 助手提示 `DRIVER_UNAVAILABLE`

```bash
xopc browser extension doctor
xopc browser doctor
```

然后打开 **设置 → 浏览器** 执行连接测试，并依次确认：

1. 浏览器控制已启用，driver 选择的是 **Chrome 扩展**。
2. 扩展文件与 native host 都是当前版本。
3. xopc 侧栏已打开，并连接到预期 Gateway。
4. Chrome 与 Gateway 报告的扩展协议/版本一致；提示时重新加载扩展。
5. 如果操作需要读取或控制网页，目标站点权限已经授予。

xopc `v0.0.268` 修复了一个问题：没有 tab binding 的浏览器动作会错误加入 `target: undefined`，严格参数序列化失败后又被误报为 `DRIVER_UNAVAILABLE`。如果日志含有 `Canonical JSON does not support undefined`，请将 Gateway 更新到 `v0.0.268` 或更高版本并重启。

### Chat 正常，但浏览器控制失败

聊天与浏览器控制共享 Gateway，但鉴权条件不同。确认扩展状态显示 **Gateway Realtime**、browser endpoint 已连接，并且当前 Session 已明确附加到目标标签页。只有站点权限并不等于已经绑定 Session，也不会自动批准高影响动作。

## 安全边界摘要

- 扩展 UI 和脚本全部本地打包，Gateway 不下发远程可执行代码。
- Gateway 访问使用 scope 受限的浏览器设备凭据；Realtime 浏览器控制还需要签名 endpoint 身份和短期 turn token。
- 本机自动 enrollment 同时限制固定扩展 ID、loopback Gateway、native issuer、公钥指纹、nonce 和短有效期。
- 远程/自部署 Gateway 需要明确的配对链接和 owner 批准。
- 页面访问是可选、按 origin 授权的；页面内容是不可信数据。
- 当前标签页控制需要 Session binding，并继续受 URL、风险、上传和审批策略约束。

需要保存可重复网页任务时，继续阅读[浏览器自动化](./browser-automations.md)。实现细节和威胁模型见仓库中的 [Chrome 扩展 Side Panel 技术方案](https://github.com/xopcai/xopc/blob/main/docs/design/chrome-extension-side-panel-chat.md)。
