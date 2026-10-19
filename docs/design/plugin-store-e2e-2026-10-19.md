> 后续安装交互、全局 Agent 可用范围和多方式授权流程已更新，见 [安装与授权设计及验收](./plugin-install-authorization-2026-10-19.md)。本文保留此前阶段的实施记录。

# Plugin Store 分发与本地使用验收

日期：2026-10-19。接续 P0～P2，实现与验证覆盖 xopc、xopc-platform Store 两个仓库。

## 验收链路

```text
发布者上传资源 / ZIP → 线上 Store 扫描、审批及分发
→ xopc 能力中心或 CLI 安装 → 审阅能力
→ 下载并校验资源 → 保存本地配置 → 浏览器 OAuth 授权
→ 检查 HTTP / stdio 工具 → 绑定 Agent / 工作目录
→ Agent 实际调用 → 升级、回滚、解绑、卸载
```

本轮使用真实 `https://store.xopc.ai`，没有用本地目录代替 Store 包，也没有拦截 Store 下载响应。包、运行程序和数据文件全部位于 Store。HTTP MCP 服务是明确标注为测试用途的 Plugin Lab；记录均为合成数据，不涉及 Gmail 或其他真实业务账号。

Agent 验证通过真实 pi Session、MCP 扩展和传输执行工具；模型流使用确定性的测试模型，不调用付费 LLM。浏览器另外启动构建后的 Gateway 进程及完整 Web 产品页面，并通过本地 OpenAI-compatible HTTP 测试模型发送真实对话请求；只有该模型收到实际 HTTP / stdio 工具结果后才输出验收成功标记。

## Store 测试包

| 包 | 用途 | 默认版本 |
|---|---|---|
| `xopc-plugin-lab-codex` | Codex 清单、Skill、OAuth HTTP MCP、本地 stdio 与敏感配置 | `1.1.0` |
| `xopc-plugin-lab-claude` | Claude 清单、同类能力及共享连接 | `1.1.0` |
| `xopc-extension-lab` | 原生 Extension、宿主信任策略、工具注册与卸载 | `1.0.1` |

两种 Plugin 均保留 `1.0.0` 供升级 / 回滚验证，`1.1.0-e2e-invalid` 是明确命名的摘要错误故障 fixture；该预发布版标为 beta，不是默认安装版本。所有包说明均标注 TEST ONLY。输入任意测试 access key 即可验证本地敏感配置，不应填写真实账号密钥。

资源通过 `PUT /api/v1/developer/resources/:sha256` 上传，需要 Store 身份认证。接口核对实际 SHA-256 并限制 50 MiB，返回内容寻址的 Store URL。`/files/assets/plugin-resources/<sha256>.bin` 以附件和 `application/octet-stream` 分发。安装器准备阶段再次验证摘要，随后将独立版本副本交给已审阅的 MCP 命令。

## 多场景验证

核心验收脚本 `scripts/verify-store-plugin-e2e.mts` 已通过 19 组检查，结果保存在 [机器可读记录](../../reports/plugin-store-e2e-2026-10-19/scenarios.json)：

- 公网目录发现；本地 Gateway 未认证请求被拒绝。
- 构建后的 xopc CLI 从 Store 安装 Codex Plugin，HTTP API 从 Store 安装 Claude Plugin。
- ZIP 摘要校验；新安装保持停用，不能在资源 / 配置未完成时启用。
- 从 Store 下载程序与数据；必填敏感配置以宿主凭据引用保存，包与准备记录不含明文。
- OAuth DCR / PKCE、用户拒绝、错误 state 回调拒绝、重新授权。
- 完成操作幂等、旧 revision 请求拒绝；绑定后实际调用 HTTP / stdio 工具。
- Agent、工作目录及 Skill 来源隔离；Gateway 重启后继续使用授权。
- 候选版本资源摘要错误时准备失败，旧版本工具继续工作；取消候选后清理其资源。
- 从 Store 升级到 `1.1.0`，回滚到 `1.0.0`，工具实际读取各自版本的数据和配置。
- 修改 Agent 绑定后权限立即变更；卸载后无运行时投影，删除资源、配置引用与自有凭据。
- 显式复用既有连接；来源连接更改后停止投影；删除插件保留共享账号。
- 原生 Extension 从 Store 安装；信任前拒绝加载，授予指定 ID 后加载、调用工具、卸载。
- 两种 Plugin 删除后，无其他引用的资源缓存清理干净。

完整产品脚本还通过了 13 组检查，见 [产品 UI 结果](../../reports/plugin-store-e2e-2026-10-19/product-ui.json) 和 [Gateway 模型端观测](../../reports/plugin-store-e2e-2026-10-19/gateway-model.json)。后者记录了实际收到两类工具结果，失败列表为空；测试先确认草稿没有自动发送，再点击发送并确认唯一一次输入抵达 Gateway。最终截图见 [聊天结果](../../reports/plugin-store-e2e-2026-10-19/chat-tool-result.png)。

`verify-plugin-setup-browser.mts` 对 Codex 与 Claude 都已通过浏览器安装、配置、Store 资源、OAuth 弹窗与 loopback 回调、刷新恢复、Agent 绑定、真实工具调用及桌面 / 窄屏 / 深色横屏检查。

客户端相关回归：**74 个文件、464 项通过**；Store 服务端：**7 个文件、71 项通过**。核心类型检查、相关 ESLint、Node / 类型声明 / Web 构建通过。未运行整个仓库的 `test:all`。

## 本轮修复

1. Store 仅接受根目录 Portable 清单：补充 Codex / Claude 隐藏清单扫描、组件及风险索引，保留原 ZIP。
2. Store 缺少资源发布接口：补充认证上传和不可变内容寻址下载。
3. `store:包@版本` 原先参与插件身份计算：现在同一 Store 包跨固定版本保持身份，能够进行候选升级。
4. OAuth 用户拒绝的远程回调无法结束：校验回调目标与 state 后，正确终止登录并允许重试。
5. 卸载凭据后遗留配置引用：按精确版本删除引用文件，其他插件不受影响。
6. Store 列表 / 详情未识别带来源后缀的安装 ID：按 Store provenance 关联已安装包，允许继续准备和管理。
7. CLI 与浏览器使用不同准备任务身份：同一 Gateway owner 使用稳定身份，重新登录仍可继续；设备身份维持隔离。
8. 上游清单未声明版本：Store 使用发布表单版本记录元数据，ZIP 保持原样；安装详情显示实际 Store release 版本。
9. Gateway 回合策略覆盖 pi 的工具钩子：组合宿主策略与 pi 原生加载等待 / 结果钩子，并在回合结束时恢复；Codemode 嵌套调用不重复进入原生钩子。新增延迟 HTTP MCP 与连续两轮复用的回归，真实聊天路径也已通过。

## 重跑

```bash
pnpm run test:plugins:fixtures
# 在 Store server workspace 运行 fixtures/store-plugin-lab/publish.mjs，发布到测试 Store。
# 它使用限时发布 Key，经标准上传 / 审批 API 发布，finally 撤销 Key。

# 本机使用已安装 Chrome；CI 也可以安装 Playwright Chromium 后不指定 channel。
XOPC_PLUGIN_SMOKE_BROWSER_CHANNEL=chrome pnpm run test:plugins:e2e

XOPC_PLUGIN_SMOKE_BROWSER_CHANNEL=chrome \
XOPC_PLUGIN_SMOKE_SOURCE=store:xopc-plugin-lab-claude@1.0.0 \
XOPC_PLUGIN_SMOKE_EVIDENCE=/tmp/xopc-store-browser-claude \
pnpm run test:plugins:browser
```

`test:plugins:e2e` 先完成 Node / Web 构建，再依次执行 Store 多场景、完整产品 UI 和安装弹窗验收。使用独立临时状态、SQLite、配置和 pi 凭据目录；测试结束关闭服务并清理本地测试账号状态。

## 线上改动及边界

Store API 的新扫描器 / 资源接口已经部署；增加三个测试包、版本和四份内容寻址资源。Plugin Lab 授权服务独立运行于 `xopc-plugin-lab` PM2 进程，仅提供测试账号和只读合成记录。Store nginx 为 `/plugin-lab/` 和该 issuer 的 OAuth metadata 转发至 loopback 19381。发布密钥只在内存中使用，已撤销。

缺少宿主 engines 的原生测试包 `1.0.0` 已移除，默认保留已通过运行验收的 `1.0.1`；故障版本标为 beta。临时发布 Key 剩余数量为 0，SQLite 完整性及外键检查通过。

Store 服务包、nginx 与数据库的部署前备份：`/var/backups/xopc-store/plugin-e2e-20261019/`。xopc 客户端改动仍在工作区，尚未发布 npm / 桌面版本。

Hooks、Commands、Agents、OpenAI 平台应用 Runtime 的适配范围仍按 P3～P5；本次验收没有扩大该兼容性承诺。完整验收在 macOS / Chrome 完成，未宣称 Windows 或真实第三方业务服务已经通过认证。
