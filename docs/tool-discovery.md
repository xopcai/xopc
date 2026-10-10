# 按需工具发现与 MCP 试点

按需工具发现让模型先搜索、再载入工具声明，减少初始请求中展示的工具数量。功能默认关闭，每个 Agent 先选一个已配置的 MCP 服务试用。连接、OAuth、超时、工具授权和会话释放继续使用 xopc 的既有 MCP runtime。

## 配置

在控制台「全局 Agent 能力 → 运行策略」开启「按需工具发现」，填写完整 MCP 服务名称并保存。名称必须与当前 MCP 配置的服务键完全一致；没有选择服务时不会增加 deferred MCP 工具。其他服务保留现有 `xopc_tool_search` / `xopc_tool_describe` / `xopc_tool_execute` 路径。

Agent 可以通过现有 `PATCH /api/agents/:id` 配置覆盖全局设置。以下是试用 `docs` 服务及其中一个读取工具的请求体示例；应先合并该 Agent 已有的 runtime override 和工具策略，避免覆盖其他设置。

```json
{
  "runtime": {
    "toolDiscovery": { "enabled": true, "mcpServer": "docs" },
    "codemode": { "enabled": true }
  },
  "tools": {
    "mcp:docs:lookup": { "mode": "allow", "readOnly": true }
  }
}
```

Agent 配置保存在 SQLite Agent catalog，使用控制台或 Agent API 修改，不向 `xopc.json` 添加旧版 Agent 配置结构。MCP 连接仍在现有 MCP 配置中管理。`toolDiscovery` 和 `codemode` 各自作为 runtime 的一个字段整体覆盖，未覆盖的其他 runtime 字段继续继承全局值。

工具策略使用现有 `mcp:<safeServerName>:<originalToolName>` ID。服务名规范化后的命名空间可从 `xopc_tool_search` 返回的 `toolRef` 获取。`mode: deny` 的工具不进入发现集合；`ask` 继续使用原有确认流程。`readOnly: true` 是本地维护者对操作无副作用的明确授权，远端 annotations 不代替它。

可以单独开启工具发现，而不开启 Codemode。搜索载入后的直接调用仍遵循原有授权；只有宿主批准的读取工具可以进入 Codemode 的脚本集合。关闭发现或修改工具权限会取消活动运行并重建 runner，下一次输入使用新的工具集合。

## 发现、执行和恢复

- 模型通过公开 pi `tool_search` 查找并载入工具，单次最多返回 20 项，查询最多 2,000 个字符。初始声明中不展示所选服务的完整工具 schema。
- 注册名使用 `mcp__<safeServerName>__<toolName>` 并转换为 JavaScript 标识符。归一化碰撞或名字超过 64 个字符明确报错，不静默替换工具。
- `namespace`、服务 instructions、annotations 和 `outputSchema` 沿用当前 MCP 契约。MCP `structuredContent` 传到 SDK，脚本可以直接处理结构化结果；MCP `isError` 保留为失败状态。
- 每次执行复用原有外部工具执行器，重新检查当前合同 revision、参数 schema、权限、个人请求和连接状态。通过别名调用不会绕过 `xopc_tool_execute` 的 before/after 策略、限次、超时或 extension hooks。
- 搜索载入状态作为 `xopc-tool-discovery` custom entry 追加到原有 SQLite transcript。重启或压缩后只恢复仍被授权且契约指纹一致的工具；reset 使用新 transcript，不继承旧载入状态或 Codemode store。
- 服务发出 `tools/list_changed` 或连接断开时，活动试点运行取消，runner 失效。下一次输入由同一个 MCP 管理器重新连接并列出工具；移除的工具不再进入声明或搜索。连接失败的目录缓存会在 5 秒后允许重试，不自动重放已经执行的脚本。

## 输出与客户端

Web 展示父脚本、子调用的状态和耗时，刷新后从持久化结果恢复审计记录。超长文本输出使用工作区内的受控文件保留及现有鉴权预览、下载 API，详见 [Codemode 输出限制](./codemode.md#限制和审计)。本机临时路径不会作为远程下载地址。

本阶段没有新增 Gateway API 或必填协议字段。TUI 与移动端继续接收标准父工具结果、相对输出路径和终态；不要求它们新增嵌套调用专用界面。图片临时文件的远程附件访问尚未实现。

## 本地验收

```bash
pnpm vitest run src/agent/embedded/__tests__/codemode.integration.test.ts src/agent/embedded/__tests__/mcp-discovery.test.ts src/agent/mcp/__tests__/catalog-invalidation.test.ts
pnpm run build:node
pnpm run test:tool-discovery:gateway
pnpm run electron:server:build
XOPC_CODEMODE_SMOKE_ENTRY=out/server/index.js pnpm run test:tool-discovery:gateway
```

验收使用临时状态目录、本机模拟模型、真实 stdio MCP 服务、实际 Gateway 和 QuickJS worker，不消费真实模型额度。覆盖鉴权、deferred 声明、搜索、结构化结果、长输出下载、取消、断线重连、工具移除、SQLite 冷启动、reset 和关闭开关。

第四阶段已完成整套 Codemode + 工具发现策略的 [真实模型评估](./design/technical/codemode-evaluation-2026-10-10.md)，本轮未达到推广门槛，继续默认关闭、按 Agent opt-in。两个 MCP 查询任务显示部分收益，但不足以推广，也不能将整套策略的差异单独归因于工具发现。
