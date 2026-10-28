# MCP Token 首次配置被错误阻断：麦当劳接入调研

日期：2026-10-28。状态：运行时修复已实现，自动验收结果见文末；下文保留定位依据。

## 事实与复现

- [麦当劳官方接入指南](https://github.com/M-China/mcd-mcp-server)指定 Streamable HTTP 地址 `https://mcp.mcd.cn`，使用请求头 `Authorization: Bearer <MCP Token>`。Token 在[官方开放平台](https://open.mcd.cn/mcp)申请。
- 本次只发送不带凭据的 MCP `initialize` 探测，未调用业务工具。实际返回 HTTP 403、`Content-Type: application/json`，没有 `WWW-Authenticate`，响应为 `{"code":"0001","msg":"系统错误","data":null}`。
- 官方文档将缺失、无效或过期 Token 描述为 HTTP 401；当前实测与之不同。403 及通用响应本身不能证明最终拒绝原因，也不能证明填入有效 Token 后一定可用。
- 用户截图显示仅有连接失败和重复检查入口，没有首次 Token 输入框。这与下述代码分支一致；本机默认数据库未找到截图中的 setup ID，未直接读取或修改该请求。

## 根因链路

1. `src/agent/mcp/connection-setup.ts:91` 的无凭据认证识别只匹配 401 / unauthorized / invalid_token；403 不匹配。下一条 401 / 403 恢复分支又要求已经有凭据。因此 HTTP 服务首次连接、没有 Token、返回 403 时落入 `error/access_denied`。
2. `src/agent/mcp/conversation-setup.ts:229` 把 probe 的 `error` 转成 `blocked`；返回给模型的说明也要求报告连接失败，而非引导首次输入 Token。
3. `web/src/features/connectors/mcp/mcp-conversation-setup-page.tsx:85` 只在 `token_required` 或 `blocked && canReplaceToken` 时显示安全输入框。`canReplaceToken` 由是否已有 `tokenProvider` 决定，首次连接为 false。
4. 后端 `interact(token)` 同样只接受 `token_required` 或已有 Token 的 blocked 状态。只改前端显示输入框仍会被拒绝。
5. `targetSchema` 只接收地址、名称和用途等字段，缺少不含秘密的认证方式提示。模型虽然从官方说明知道该服务使用 Token，却不能把这个事实传给宿主；宿主仍完全依赖失败探测来猜认证方式。

现有本地集成测试以无凭据 HTTP 401 为主，没有覆盖“首次接入、HTTP 403、无 OAuth challenge、无 tokenProvider”的完整场景。

## 应有流程与修复方向

用户提出连接需求 → 确认服务地址和认证方式 → 安全弹窗输入 Token → 保存到凭据存储 → 用真实 Token 重新探测 → 发现工具并提交配置 → 原会话自动续跑并报告实际结果。

- **明确认证意图**：产品工具可接受 `auto / bearer / oauth` 一类不含秘密的认证提示，随配置目标持久化。已核实为 Bearer 的服务直接进入安全 Token 步骤，无需先无凭据连接失败。该提示不授予配置权限；微信 owner 审批、目标检查和会话版本检查照常生效。不能让模型通过此字段传 Token、任意请求头或授权 URL。
- **恢复首次输入能力**：对于 HTTP 认证拒绝且没有现有 Token 的目标，允许通过受控、绑定版本的“使用 Token”步骤进入安全输入。不能让首次连接只能重复检查；UI 与后端必须同步支持。已有 Token 被拒绝时提供替换 Token。
- **保留错误含义**：不能将所有 403 无条件解释为缺少 Token。对没有明确认证信息的服务，提供 Token 配置入口和权限说明；WAF、地区、网络或账号权限拒绝仍应保留诊断。OAuth 需要正向协议证据或明确支持的方式，不能因 403 自动启动 OAuth。
- **文案与入口**：主操作为“输入 Token”或“保存并连接”，说明 Token 获取位置和秘密不进入聊天。连接失败时区分缺少 Token、凭据被拒绝和服务拒绝；避免笼统要求检查地址。重复检查放在次要位置。
- **恢复旧请求**：这次已经进入 blocked 的首次目标也需要通过原弹窗恢复，不能只修复新建目标；已取消、过期、会话重置或服务地址变更的目标不能复活。

## 验收要求

本地真实 HTTP 测试服务复刻本次 403 JSON 响应和无 challenge 情况；提交正确测试 Token 后才开放真实 MCP 初始化和工具发现。通过真实聊天发起配置，并直接点击回复中的链接，验收：

1. 没有 Token 时可到达安全输入框，不能停在只能重复检查的 blocked 页面。
2. 旧 blocked 请求可切入首次输入；错误 Token 可替换；不存在凭据时不误报“Token 已失效”。
3. 正确 Token 进入凭据存储，不进入模型消息、transcript、日志、链接查询参数或普通配置 JSON。
4. 认证成功后自动续跑同一 conversation，完成实际只读工具调用再报告可用；不能仅以保存成功判定通过。
5. OAuth、公开 MCP、403 权限拒绝、429、TLS、取消、并发版本冲突、Gateway 重启及原会话重置均有相应回归，不能靠弱化通过条件让测试变绿。

本地协议 E2E 通过只证明客户端闭环。麦当劳官方服务端的完整连通验收仍需要有效 Token；本次没有索要、生成或使用用户 Token，也没有执行点餐等业务操作。

## 实施结果

- `mcp_setup start` 新增可选 `authentication: "auto" | "bearer"`，只有非秘密枚举；已知 Bearer 认证在 owner 批准后直接进入安全 Token 表单，不发送无凭据探测。未指定时保留自动检测，工具手册明确要求根据用户说明或核实的接入指南选择。
- 无凭据 HTTP 403 仍保留 `blocked/access_denied` 诊断，但宿主返回 `canProvideToken`，安全弹窗显示首次输入框，后端接受同一版本的 Token 提交。已有 blocked 请求无需重建；重启 Gateway 后重新检查仍可恢复。
- 错误 Token 转为 `credential_rejected`，输入立即清空且可重新提交。凭据被拒绝的判断覆盖嵌套原生错误 cause。未提交过 Token 时不会显示“密钥被拒绝”。TLS、网络和限流错误不会错误开放首次 Token 恢复。
- 旧的 owner 身份、微信审批、会话 transcript、版本、过期、取消和 HTTPS 限制继续适用；不新增认证接口、任意请求头写入或普通聊天密钥参数。

专项 E2E 入口：

```sh
pnpm -C web run build
XOPC_CONFIGURATION_E2E_LIVE=1 XOPC_CONFIGURATION_E2E_STAGE=mcp XOPC_CONFIGURATION_E2E_TOKEN_403_ONLY=1 XOPC_CONFIGURATION_E2E_OUT=.xopc-evals/mcp-token-403-fix pnpm exec tsx scripts/verify-conversation-configuration-e2e.mts
```

脚本使用真实 XOPC Cloud 对话模型、生产 Gateway 和移动宽度 Web Chat，独立本地 HTTP MCP 服务复刻 403 JSON 且不提供 OAuth challenge。验收直接点击模型回复中的配置链接，通过真实安全表单提交错误和正确测试 Token，并要求原会话自动续跑、实际调用只读工具且返回随机标记。另验明确 Bearer 提示不产生无凭据请求；测试不通过会以非零状态退出。

最终专项 E2E **9 个场景全部通过**，覆盖首次无凭据 403、聊天实际链接、安全输入、Gateway 重启、错误 Token、原会话仅排队一次、明确 Bearer 跳过无凭据探测、两个原会话的实际只读结果及秘密隔离。验证中还发现模型改写成不支持的 `xopc://workspace/...` 链接，已让宿主在 instruction 中提供完整 Markdown 链接并要求原样复制；最终 E2E 仍通过直接点击回复链接完成，未改用测试拼接地址。

相关回归 **7 个文件、153 项通过**，包括原有 OAuth 原生协议集成；根项目 / Electron / Web 类型检查、Web 生产构建、E2E 脚本类型检查、修改代码 ESLint 和 `git diff --check` 通过。[脱敏证据](evidence/mcp-token-auth-recovery-2026-10-28.json)仅保存场景断言和模型请求统计，不包含 Token、原始聊天或连接身份。

修复需要更新运行代码并重启 Gateway、刷新 Web 页面。未过期且会话身份未变的旧 blocked 请求可恢复；过期或取消的请求需要重新发起。本次没有替用户重启日常 Gateway，也没有修改截图中请求的数据库状态。
