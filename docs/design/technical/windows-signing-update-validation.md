# Windows 签名与更新验证工具

日期：2026-10-25。

## 当前发布行为

当前 CI **仍然允许未签名 Windows 安装包构建和发布**。没有加入缺少证书就终止 tag 或手动 release 的门禁，没有自动调用下述严格签名验证器。现有 unsigned 安装包缺少 `publisherName` 时，更新检查仍保留 electron-updater 的既有行为；这类更新不能证明发布者身份。

Windows 证书使用 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`，支持 `.env.local` 中对应的 `XOPC_WIN_CSC_*` 别名。Windows 不再从通用 `CSC_LINK` 读取可能属于 macOS 的 Developer ID 证书。CI 将已有 Windows Secrets 导出为 `WIN_CSC_*`，未配置时仍走原来的 unsigned 分支。macOS 配置保持不变。

可选的 `XOPC_WINDOWS_PUBLISHER` 是 Windows 证书的完整 Subject DN，例如 `CN=公司名称, O=公司名称, C=CN`。它被写入签名构建的 `app-update.yml`，用于后续更新发布者匹配。正式值应从实际 Windows 签名证书读取，不能使用示例值。

GitHub Actions 对应的可选变量为 `WINDOWS_PUBLISHER`。配置 Windows 证书后，打包器还会签署 DLL / Node 原生模块，并使用 SHA-256 和 RFC3161 时间戳；未配置证书时不启用这组设置。当前本地未签名 NSIS 打包、Gateway 预检和 asar 依赖检查均通过；没有 GitHub 登录态，未触发远端 CI 或发布新 Release。

## 已完成的真实负向测试

```powershell
node --import tsx scripts/run-windows-updater-negative-validation.mts
```

默认使用当前 `dist/release/xopc-0.0.416-x64.exe` 未签名安装包，也可追加其他未签名测试包路径。需要 Windows x64、Electron 依赖和 OpenSSL（默认 Git for Windows 自带路径，可用 `XOPC_TEST_OPENSSL` 指定）。

脚本启动真实 Electron HTTP executor 和 `NsisUpdater`，通过临时 loopback HTTPS feed 下载实际安装包：

- 正确 SHA-512、未签名包：`ERR_UPDATER_INVALID_SIGNATURE`。
- 错误 SHA-512：`ERR_CHECKSUM_MISMATCH`。
- 两项都没有 `update-downloaded` 事件，没有安装或重启尝试。

HTTPS 使用仅限测试 updater session、仅限 loopback 主机和单张证书指纹的信任规则；不安装系统根证书，不关闭 TLS 校验，不跳过 Authenticode。临时 TLS 证书不是代码签名证书。结果位于 `.cache/windows-updater-negative-<uuid>/result.json`，脱敏记录见 [真实负向验证证据](./evidence/windows-updater-negative-2026-10-25.json)。

应用中的历史 `XOPC_WIN_UPDATER_SKIP_SIGNATURE_VERIFY` 开关不再绕过签名检查。存在发布者信息的签名版本检查 Windows 信任状态、完整 Subject DN、Code Signing EKU 和时间戳；PowerShell 失败或输出无法解析时拒绝更新。缺少发布者信息的现有 unsigned 版本不因此被禁止构建、发布或检查更新。

校验基础函数另外用本机已签名的 Microsoft Windows PowerShell 程序核对了真实 Valid 状态、Code Signing EKU 和时间戳解析。此检查不代表 xopc 已签名，也不替代项目自身的签名更新正向测试。相关 16 项自动化测试通过，根项目类型检查和 Electron 构建通过。

## 取得证书后的独立检查

以下工具按需执行，**不会阻断当前 CI**。

检查签名产物、更新元数据、SHA-512 和 PE 载荷：

```powershell
$env:XOPC_WINDOWS_PUBLISHER = '实际证书的完整 Subject DN'
node --import tsx scripts/verify-windows-release.mts dist/release
```

严格验证器要求安装包的 Authenticode 为 Valid、具有 Code Signing EKU 和时间戳、发布者与本机更新配置一致，且 `latest.yml` 版本、文件名、长度、SHA-512 匹配。它还检查 unpacked PE 文件的有效签名，并严格匹配应用主程序和 `resources/bin` 的发布者。产物不满足时，此独立命令返回失败，不更改 CI 发布规则。

通过真实 updater 检查 HTTPS staging feed 的版本发现、下载、校验和及签名验证：

```powershell
node --import tsx scripts/run-windows-updater-download-validation.mts `
  --feed 'https://staging.example.com/windows' `
  --publisher '实际证书的完整 Subject DN' `
  --current '0.0.416' --expected '0.0.417'
```

此工具使用正常系统 TLS 信任，不接受 HTTP 或 URL 内联凭据；关闭安装和退出时自动安装，仅验证下载。结果位于 `.cache/windows-updater-download-<uuid>/result.json`。

本机尚无 Windows 代码签名证书；签名正向下载和已安装 A → B 升级、自动重启、升级后真实模型验证尚未实测。工具准备完成不等于这些项目已经通过，也不代表 SmartScreen 已建立信誉。取得证书后需用真实签名的两个版本补做安装升级验收，再决定是否启用强制发布门禁。

参考：[electron-builder Windows 签名](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)、[Windows 发布者和更新校验配置](https://www.electron.build/v26/docs/win/)。实现同时核对了项目安装的 electron-builder `26.15.3` 和 electron-updater `6.8.9` 源码。
