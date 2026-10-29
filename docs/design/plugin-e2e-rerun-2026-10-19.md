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

## 合并保留的早期验收结论

2026-10-29 将同日较早的 Store 分发验收与真实账号首轮验收收敛到本报告。安装与授权的当前契约见[安装与授权设计](plugin-install-authorization-2026-10-19.md)，早期安装期 Agent 绑定流程不再作为产品规范。

Store 生命周期测试使用线上测试包 `xopc-plugin-lab-codex@1.1.0`、`xopc-plugin-lab-claude@1.1.0` 和原生 `xopc-extension-lab@1.0.1`；旧版 1.0.0 用于升级/回滚，摘要错误版本为明确标注的故障 fixture。19 组检查覆盖认证、ZIP/资源摘要、敏感配置引用、OAuth DCR/PKCE/拒绝/错误 state、revision 幂等、重启、升级失败保留旧版、回滚、共享连接保留、原生 Extension 信任及卸载清理。测试记录为合成数据，模型为确定性 HTTP 服务；它们不证明真实业务账号权限。

完整产品 UI 的 13 组检查通过真实 Gateway 和 HTTP/stdio 工具结果确认聊天完成，先确认草稿未自动发送，再点击发送并核对唯一输入。复跑入口为 `XOPC_PLUGIN_SMOKE_BROWSER_CHANNEL=chrome pnpm run test:plugins:e2e`；单独安装弹窗可使用 `pnpm run test:plugins:browser`，`XOPC_PLUGIN_SMOKE_SOURCE` 指定测试包，`XOPC_PLUGIN_SMOKE_EVIDENCE` 指向临时证据目录。测试使用隔离状态，不应填写真实密钥。该轮 macOS/Chrome 结果不等于 Windows、所有第三方服务或 Hooks/Commands/Agents Runtime 适配已通过。

保留的修复包括 Store 跨版本身份稳定、OAuth 拒绝后结束并可重试、卸载清理精确版本的凭据引用、CLI/浏览器 owner 准备身份一致，以及组合宿主策略与 pi 工具钩子、等待延迟 MCP 加载并恢复钩子。CLI 账号字段提交曾在登录前启动 prepare 而竞争 setup lock；现按 configure → authorize 顺序，登录成功后再准备与探测，组件回归覆盖该顺序。

真实账号首轮使用钉钉 1.0.5、飞书 1.0.3，验证了跳过后补授权、返回用户重新登录、当前用户/drive/wiki 读取；不代表首次创建第三方应用成功。飞书当时 calendar 缺 scope，后确认应用侧权限已启用，缺口是 recommended-only 登录未请求需审核的用户 scope。补授权机制见[权限恢复契约](plugin-permission-recovery-2026-10-19.md)。后续飞书 1.0.5 的真实 calendar 成功以本报告上方复验为准，不把较早失败改写为通过。钉钉一次对话曾被并行插件安装刷新 runners 中断，安装结束后重跑成功。

这些是历史结果合并，没有在清理时重新运行线上 Store 或业务账号验收；原始本机记录路径和旧稿保留在 Git 历史。
