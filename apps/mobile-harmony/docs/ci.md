# GitHub Actions 与手机测试

## 自动构建

`Mobile HarmonyOS CI` 在相关代码推送到 `main` 后运行，也支持手动运行。PR 仅运行不需要凭据的契约、单元测试和类型检查；原生构建仅在受信任的 `main` 上执行。

原生构建使用 GitHub 托管的 macOS ARM64 runner、华为官方 command-line-tools `26.0.0.821`、SDK 26。最低运行版本为 `6.1.0(23)`，目标版本为 `26.0.0`；构建脚本会解开 HAP，检查实际清单中的最低 API、目标 API、包名和 Release SDK 标记。下载包的 SHA-256 固定在 workflow 中，不使用非官方 SDK 镜像。

仓库 Secret `HARMONY_TOOLS_URL` 保存官方下载地址（含临时签名参数，不能写入仓库）。下载地址失效时，从官方页面重新获取**同一版本**地址并更新 Secret；升级版本时同时核对并更新 SHA-256。不要上传 SDK 到 Release 或构建产物。

成功后在 Actions 的 Artifacts 下载 `harmony-api23plus-unsigned-<commit>`，包含：

- Debug / Release 未签名 HAP。
- Release APP 分发容器。
- CodeLinter 报告、提交号、版本号和包 SHA-256。

这些包仅用于构建验证，**不是可以点击下载后直接在手机安装的测试版本**。流水线不代表真机功能验收通过，也不自动公开发布应用。

本地复现原生构建：

```sh
cd apps/mobile-harmony && ohpm install --all
cd ../..
HARMONY_TOOLS_DIR=/absolute/path/to/command-line-tools node apps/mobile-harmony/scripts/build-ci.mjs
```

## 应用身份与待完成门禁

- Bundle Name：`ai.xopc.mobile`
- AGC APP ID：`6917616647856901107`
- AGC 项目：`xopc`（`101653523865066304`）
- 最低 API 23（HarmonyOS 6.1）/ 目标 API 26；低于 API 23 的手机不在支持范围。

应用注册及本机 DevEco 调试签名生成已完成。签名配置备份在 Git 忽略的 `signing/build-profile.local.json`（仅本机），材料在用户的 `.ohos/config` 目录。手机设备范围及测试分发仍需完成；DevEco 登录或生成模拟器配置不等于真机安装已通过。

调试安装需要匹配设备范围的调试 Profile；手机独立下载安装应使用华为测试分发渠道及其要求的签名包、账号和检查流程，不能以 GitHub Release 链接绕过平台签名/安装限制。

## 受限测试签名

在 Actions 手动运行本流程，分支选择 `main`，启用 `sign_test_hap`。签名只接受 `ai.xopc.mobile` 的有效 Debug Profile 和 API 23 Debug HAP，不执行正式上架签名。

GitHub Environment `harmony-testing` 的分支策略仅允许 `main`。以下 Secrets 仅注入手动签名步骤：`HARMONY_TEST_KEY_ALIAS`、`HARMONY_TEST_STORE_PASSWORD`、`HARMONY_TEST_KEY_PASSWORD`、`HARMONY_TEST_KEYSTORE_BASE64`、`HARMONY_TEST_PROFILE_BASE64`、`HARMONY_TEST_CERT_BASE64`、`HARMONY_TEST_ARTIFACT_KEY`。前三个是别名和可移植密码，中间三个是对应文件的 Base64，最后一个是随机 32 字节十六进制加密密钥。不要把 DevEco 本机加密密码直接当作可移植密码；不得上传 `.ohos/config/material` 主密钥目录。

签名后调用官方工具验签。由于 Profile 包含测试设备标识，签名包不会明文上传到公开仓库的 Artifacts。`harmony-api23plus-test-encrypted-<commit>` 仅保存 AES-256-GCM 加密包和不含设备标识的校验摘要，保留 7 天。私钥、密码、证书与 Profile 不提交 Git、不打印到日志。

下载加密产物后，在已保存 `signing/artifact-key` 的本机执行：

```sh
node apps/mobile-harmony/scripts/decrypt-test-hap.mjs /absolute/path/to/xopc-test-signed.hap.enc
```

输出位于 Git 忽略的 `.test/ci/xopc-test-signed.hap`（权限 0600；已有文件时拒绝覆盖）。加密密钥只保存在本机忽略目录与 Environment Secret，不放在下载链接里。调试包仍仅能安装到 Profile 授权的设备；这一产物不是华为测试分发链接。

参考：[Huawei CI 工具](https://developer.huawei.com/consumer/cn/testing/get-started/)、[签名配置](https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/ide-signing-auto)、[测试与分发](https://developer.huawei.com/consumer/cn/appgallery/devstart/)。
