# Code signing policy（代码签名政策）

状态：正在准备 SignPath 申请，尚未获得 SignPath Foundation 批准。Windows v0.0.439 安装包仍未签名。以下是拟实施政策，不代表签名服务已经启用。

## 项目与下载

[xopc](https://github.com/xopcai/xopc) 是 MIT 许可的个人 AI 助理，支持本地 Gateway 与用户选择的远端 Gateway。文件、命令、桌面、浏览器、麦克风等能力具有实际权限和数据影响，应按需配置。

仅从 [xopc.ai](https://xopc.ai/zh#download) 或 [GitHub Releases](https://github.com/xopcai/xopc/releases) 下载对应版本和架构的安装包。现有 macOS 签名与拟接入的 Windows SignPath 签名是独立流程。

## 拟定职责与签名流程

- 当前仓库维护者和管理员为 [xopcai](https://github.com/xopcai)。外部贡献由维护者审查；新增写入权限须由仓库所有者授予。
- 维护者于 2026-11-02 确认由 xopcai 担任申请人及人工审批人，且 GitHub MFA 已开启；这是维护者确认，并非 API 验证。SignPath 账号 MFA 与角色分配仍待完成，目前没有 SignPath API 凭据。
- 具备源码或签名权限的人必须启用 MFA；每个提交给基金会的发布都必须经过人工批准，不能让 CI token 自动批准生产签名。
- 只使用 GitHub 托管 runner 从记录的 commit/tag 构建签名输入，保留构建 artifact ID、依赖/许可证清单和校验值。
- 自有程序、辅助程序、安装器及生成的卸载器须有明确签名范围和产品名/版本限制。Electron/NSIS 生成程序的处理方式需先与 SignPath 确认。
- 不得批量为第三方 DLL、Node 原生模块、Electron 组件、ripgrep、Cua 驱动等套用基金会证书。保留上游许可证和已有签名；是否允许签名以批准的清单为准。
- 签名后重新生成更新清单和哈希。在 Windows x64、ARM64 上通过发布者/时间戳验证、篡改拒绝和连续两个签名版本之间的升级测试后，才宣布可信自动更新可用。旧未签名版本需要手动安装一次正式签名版。

## 桌面隐私说明

本节说明桌面程序，不代替各网站或外部服务自己的隐私政策。

- **本地与远端数据**：默认本地状态保存在 `~/.xopc`。远端模式的服务端数据保存在所选 Gateway 主机。选择本地存储不意味着推理一定在本地。
- **模型请求**：提示词、选中的历史/上下文、附件和工具结果可能发送给配置的模型服务。需要设备内处理时应选用本地模型，并检查相关工具是否仍会联网。
- **本机能力**：授权的文件、命令、浏览器、剪贴板、麦克风或截图操作可能向所选 Gateway、模型或服务暴露数据；聊天连接、设备登记和能力授权分别管理，并非每次操作都会再次弹窗。
- **更新**：安装版会在启动后和周期性检查中联系 `https://xopc.ai/api/download`，自动下载可用更新，并可能在退出时安装；下载可能由 GitHub 提供，服务运营者会收到 IP 和客户端请求头等常规网络信息。目前安装器没有关闭这些自动更新流量的选项；安装时披露和可用的关闭机制是申请签名发布前的待补项。
- **运行追踪**：本地追踪默认开启；Langfuse 远端导出默认关闭，需要配置后才启用。开启前应检查采集模式、保留时间、导出地址和凭据。
- **可选联网服务**：配置的模型、消息渠道、连接器、远端访问、语音、Web 工具以及目录/商店页面可能访问相应服务；后装扩展和技能也可能增加行为。仅启用需要的服务并核对各自条款。

相关服务包括用于下载或仓库交互的 [GitHub 隐私政策](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)，以及用户启用云端导出时的 [Langfuse 隐私政策](https://langfuse.com/privacy)。模型、渠道、连接器和远端 Gateway 由各自运营者管理，无法用一份固定名单覆盖所有配置。xopc.ai 网站自身的 Cookie、分析与服务端政策仍需单独核对，本页不为其作符合性保证。

请参阅[用户理解与隐私](./user-understanding.md)、[数据位置](./workspace.md)和[桌面安装/卸载说明](./desktop-app.md)。不要向公开 issue 上传密钥或私人日志。

## SignPath 状态

以[基金会条件](https://signpath.org/terms.html)为依据准备申请；是否接纳、批准的签名范围、隐私控制和维护者身份仍待核实。

获得批准并启用后，项目政策及相关下载/发布页将包含要求的署名：

> Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

这段条件式署名不表示当前下载已由 SignPath 签名。最终发布者 Subject 必须从实际签名产物核实，不能从基金会名称猜测。

安全问题通过 [GitHub 私密漏洞报告](https://github.com/xopcai/xopc/security/advisories/new)提交。
