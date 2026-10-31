# D3b 截图能力验证（进行中）

原预算不变，未通过或尚未运行的项目不记作通过。S5 24 小时验证在另一份不可变安装包上独立运行，不阻塞本批开发。

- package-1：安装包校验失败，screen-capture.html 已在 preload 构建输出中，但缺少 electron-builder asarUnpack 白名单。已补入白名单，重新打包；失败日志保留。
- schema-1：测试命令误用 unit 项目，未发现测试，不作为成功证据。改用 component 项目，完整支持起点升级到 v265 的 145 项验证通过。
- runtime-1 中 database is locked / cleanup failed 等日志由测试主动注入，最终 74 项断言通过。
- 截图进入模型后遵循既有会话保存策略；短期内存帧仅描述上传传输缓存，不代表模型上下文或 SQLite 中没有图像。

## 已验证

- `e2e-3.log`：真实 HTTP/lazy/auth/设备证明/签名 WebSocket、状态及截图两条 E2E 通过。截图逐次拒绝、后台不可用、授权版本竞争、单次图像上传和消费、迟到取消结果清零、Agent 图像投影、禁止通用文件下载和落地文件验证通过。测试注入采集和加密不当作原生采集/OS safeStorage。
- `schema-routes-2.log`：145 项数据库、完整支持起点升级和路由断言通过。另有 74 项 Endpoint 测试、31 项认证测试、176 项契约测试、12 项包校验测试及类型检查通过。
- `package-2.log`：正式 Developer ID 签名 macOS arm64 包构建、371 项必要资源与 664 项运行字节校验通过；新增页面确实 unpack。未配置 notarization。
- 实际 DMG 安装副本 `442291dc363298f9375127f9db31496f1a7d7d83e13f4120fff4fb386760ca51`，1426 个文件；`p2a2-d3b-package-fingerprints.json` 保留摘要。
- `p2a2-d3b-bundled-auth-1.json`：实际包内 Gateway 的最小认证、身份绑定、刷新/丢回执恢复、撤销和越权验证通过。
- `p2a2-d3b-installed-local-1.json`：实际安装包本地新启动/复用、聊天/Cookie/WS、文件边界、PTY、浏览器、进程拥有权、重启和退出通过；损坏远端配置不影响本地模式。复用 schema264 与262 的旧 Gateway 也分别通过，版本前后保持不变。
- `d4-recovery-2.log`：Host 真实断线重连后更换 connectionInstanceId 与 turn token；旧凭证失效，恢复调用通过。第1轮误从不包含该字段的公开快照读取 connectionInstanceId 导致测试失败，已改为观察真实 WS hello，失败保留。

## 尚未验收

原生测试副本仅改变 bundle id 为 `ai.xopc.desktop-screen.acceptance` 并使用同 Developer ID/entitlements 签名，差异只包含 Info.plist 与签名主程序，见 `p2a2-d3b-native-bundle-differences.json`；不混称正式包标识。

第1、2轮原生测试均在连接凭据写入阶段触发原有15秒安全存储保护，尚未执行来源选择或截图。随后原生自动化明确报告 Mac 已锁屏且无法自动解锁；已请求手动解锁。锁屏是已观察到的环境条件，尚不能断言它是所有历史安全存储超时的唯一原因。失败状态目录及日志保留，没有加长预算，也没有将重试记为修复成功。

来源选择、实际截图单次拒绝/批准、实际模型图像及远端 UI 回归待解锁后完成；显示器录制权限与跨平台/WAN截图也未验收。当前不能把完整D3b或P2a-2标为通过。
