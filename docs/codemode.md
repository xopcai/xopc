# Codemode 读取试点

Codemode 允许模型在 QuickJS 沙箱中用 JavaScript 组合已授权的读取工具。普通工具调用仍可使用。功能默认关闭，不改变现有模型、SQLite 会话或 MCP 连接管理。

## 开启和关闭

在网关控制台的「全局 Agent 能力 → 运行策略」开启「Codemode 读取试点」，保存后应用到继承全局设置的 Agent。

Agent 也可以通过现有 `PATCH /api/agents/:id` 的 `runtime` 字段覆盖全局设置：

```json
{
  "runtime": {
    "codemode": {
      "enabled": true,
      "timeoutMs": 60000,
      "maxConcurrentCalls": 4,
      "maxCalls": 32,
      "maxOutputTokens": 4000
    }
  }
}
```

Agent 配置保存在 SQLite Agent catalog 中。使用控制台或现有 Agent API 修改；不要向 `xopc.json` 添加旧版 Agent 配置结构。`runtime` 中未覆盖的字段继续继承全局值，`codemode` 对象作为一个字段整体覆盖。只设置 `enabled` 时，其余预算使用上述默认值。API 更新 `runtime` 时应保留该 Agent 已有的其他 runtime override。

各预算允许降低，不能超过示例中的上限。关闭开关或修改工具权限会中止活动运行并释放 runner，下一次输入重新构建工具声明。停止后可继续使用普通工具。不会自动重放失败或取消的脚本。

## 工具和状态

脚本可以使用当前会话中已启用且来自 xopc 核心工厂的 `read_file`、`list_dir`、`grep`、`find`、`knowledge_search`、`knowledge_get`、`web_search`、`web_fetch` 和 `data_batch`。每次调用仍经过原有权限、目录指令、工具执行器和取消逻辑。

`ALL_TOOLS`、`searchTools()` 和 `describeTool()` 仅包含同一份授权读取集合。通过猜名字也不能调用 shell、写文件、发消息、任务修改、浏览器或桌面控制；`models.*` 不可用。`data_batch` 同时受底层工具权限交集限制，因此 Git 和外部操作在本试点中不可用。

第三阶段另提供默认关闭的 [按需工具发现与 MCP 试点](./tool-discovery.md)。同时开启后，所选 MCP 服务中由宿主明确设置 `readOnly: true` 且当前已授权的工具也可供脚本搜索和调用。远端 `readOnlyHint` 不授予权限；未获宿主读取授权的 MCP 工具仍不能在脚本中执行。

例如，模型可以提交以下脚本：

```javascript
const results = await Promise.allSettled([
  tools.read_file({ path: "README.md", limit: 80 }),
  tools.read_file({ path: "docs/models.md", limit: 80 }),
]);
text(results);
```

脚本可以通过 `store(key, value)` / `load(key)` 保存 JSON 状态。总状态最多 64 个键、64 KiB，每次写入也最多 64 KiB。成功写入通过 `codemode-store` custom entry 追加到现有 SQLite transcript；冷启动和压缩后仍可恢复。不同会话互不共享，reset 后使用新 transcript，不继承旧状态。

## 限制和审计

- 源码最多 64 KiB。宿主期限包含工具等待；脚本第一行的 `// @options:` 只能降低期限和输出预算。
- 调用次数超限会终止沙箱，避免脚本捕获错误后持续发起请求。宿主并发限制之外，原有工具锁和数据调度器继续生效。
- 输出预算按每 4 个字符约 1 token 估算，覆盖返回模型的文本和图片数据。上游另有 256 MiB VM 内存、16 MiB 字符和 100,000 个输出项的原始沙箱上限。预算不是实际模型 tokenizer 的精确计数。
- 超长文本输出从 pi 自己的临时文件保留到当前工作区 `.xopc/codemode-output/`。有界结果包含相对路径，Web 的「查看完整输出」使用现有鉴权文件预览和下载链路；刷新历史后仍可打开。文件保留在工作区，可按需清理。上游图片临时文件尚未接入此链路，不能把本机图片路径当作远程附件链接。
- 子调用的父 ID、状态和耗时通过 realtime 传输，并保存为父结果的有界 `nestedCalls`。Web 刷新后可恢复子调用记录。子调用不生成独立的模型 toolResult；使用量由 pi 汇总到父结果一次。
- 沙箱失败不是事务回滚。已完成的读取和对应审计记录保留；超时、取消或权限修改不会自动重试整个脚本。

## 本地验收

```bash
pnpm vitest run src/agent/embedded/__tests__/codemode.integration.test.ts
pnpm run build:node
pnpm run test:codemode:gateway
pnpm run electron:server:build
XOPC_CODEMODE_SMOKE_ENTRY=out/server/index.js pnpm run test:codemode:gateway
```

Gateway 验收脚本使用临时状态目录、本机模拟模型服务和真实 QuickJS worker，不消耗模型额度。覆盖鉴权输入、子调用事件、取消、SQLite 冷启动、reset 隔离，以及关闭开关时的 worker 终止和 `cancelled` 终态。

第四阶段已完成 30 个任务、270 个真实模型样本的 [成本、速度和成功率评估](./design/technical/codemode-evaluation-2026-10-10.md)。本轮未达到推广门槛，继续默认关闭、按 Agent opt-in；推广阈值见 [pi 升级方案](./design/technical/pi-upgrade-plan-2026-10-10.md)。
