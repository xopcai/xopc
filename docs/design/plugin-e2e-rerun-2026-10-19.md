# 插件完整链路复验

日期：2026-10-19。本轮使用本机 Gateway、Chrome 产品界面和线上 `https://store.xopc.ai`。没有修改 Store 数据，没有重新授权或卸载真实钉钉、飞书账号。

## 浏览器安装与补授权

使用线上 Store 的 `xopc-plugin-auth-lab@1.0.0`，账号和返回记录均为明确标注的合成测试数据。

| 场景 | 结果 |
|---|---|
| 卸载测试包后从市场重新安装，准备 Store 资源 | 通过 |
| 安装时暂时跳过授权，进入详情弹窗 | 通过；保留已安装状态并提示部分功能需要授权 |
| 关闭弹窗后卡片展示“需要授权 / 去授权” | 通过 |
| 再次打开详情补授权 | 通过；继续未完成的账号 |
| 错误 Token 校验 | 通过；显示验证失败，没有误报已连接 |
| 有效 Token、ClientKey/Secret 手动填写 | 通过；敏感字段为密码输入框 |
| CLI 登录、过期后重试、授权回调 | 通过 |
| 二维码展示与对应授权页回调 | 通过；通过备用授权链接确认合成账号，未使用手机实际扫描 |
| 四种授权完成后详情状态 | 四个连接均为“已连接” |

截图保存在本机 `/tmp/xopc-plugin-final-e2e/ui/`，未提交包含浏览器个人上下文的截图。浏览器控制中途发生 debugger 连接丢失，后通过原生 UI 完成剩余授权步骤；该自动化连接问题不作为产品授权失败。

## 真实模型与工具结果

模型使用当前配置的 `qwen-token-plan-cn/qwen3.8-flash`。通过真实 Gateway 输入和 realtime 完成事件执行，断言持久化记录中的实际工具调用及工具结果，而非仅检查助手回答。

| 对话 | 结果 |
|---|---|
| `296de76e-368a-4f0e-a6ba-ee27b9924fb1` | 补授权后的 auth-lab 四个连接各实际调用 MCP 工具，返回 `auth-token-verified`、`auth-client-verified`、`auth-cli-verified`、`auth-qr-verified` |
| `d83e27bd-650b-4c2b-80d9-1146ef9187dc` | 钉钉 1.0.5，qmdemo 已绑定账号，真实 `contact user get-self` 成功 |
| `b3da6071-58bd-4acd-a8fc-dd10c0115ca0` | 飞书 1.0.5，两轮真实用户身份调用：`contact +get-user --as user`、`calendar +agenda --as user` 均成功 |

钉钉和飞书本轮仅执行读取；没有发送消息、创建日程或修改企业数据。真实账号使用已有授权，跳过与补授权流程由独立测试插件覆盖。

新增 `scripts/verify-plugin-auth-live-e2e.mts`，用于在界面完成四种测试授权后复验真实模型调用。它根据插件命名空间识别被运行时缩短的 MCP 名称，要求四个不同工具实际调用，并核验工具结果中的四个记录。

## 补充回归与修复

`scripts/verify-store-plugin-e2e.mts` 本轮再次通过 19 组检查。它使用线上 Store 包和独立临时状态，覆盖 Codex/Claude 安装、资源摘要、OAuth 拒绝和错误 state、授权后实际 MCP 调用、重启、升级回滚、失败恢复、共享连接、原生 Extension 和卸载清理。该脚本的模型是确定性测试模型，与上述真实模型对话分别计证。

发现并修复：在详情弹窗内管理并卸载插件后，原逻辑会重新打开已经不存在的详情，显示 `Plugin not found`。现在卸载成功直接关闭所属详情弹窗；普通关闭管理仍返回详情。新增针对卸载回调及保留数据/凭据参数的回归测试。修复后的卸载返回行为由组件回归验证，未将浏览器控制恢复后的重复卸载操作计为通过。

检查结果：插件相关前端 7 个文件、28 项测试通过；Web 类型检查、修改文件 ESLint、`git diff --check` 通过。未运行整个仓库 `test:all`，未声明所有第三方服务、手机扫码或跨平台场景均已验收。

本机机器可读记录位于 `/tmp/xopc-plugin-final-e2e/{store,auth-lab,dingtalk,feishu}/result.json`。本轮改动仅本地提交，不 push。
