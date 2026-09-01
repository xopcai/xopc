# 内置工具

本文说明 xopc 智能体可调用的内置能力：读写工作区、执行命令、检索与浏览网页、对接通道与技能等。实际注册哪些工具取决于 **配置**、可选 **能力**（记忆、浏览器、TTS）、是否接入 **网关**（例如交互式 `clarify`、自动化 `automation`），以及是否加载 **扩展**（扩展可向注册表追加工具）。

---

## 一览

| 类别 | 工具 |
|------|------|
| 规划与澄清 | `clarify`, `todo` |
| Skills | `skills_list`, `skill_view`, `skill_manage` |
| 工具手册 | `tool_manual`，用于加载内置复杂工具说明 |
| 工作区文件 | `read_file`, `write_file`, `edit_file`, `list_dir` |
| 仓库内搜索 | `grep`, `find` |
| Shell | `shell` |
| 网页 | `web_search`, `web_fetch`, `web_extract` |
| 消息与媒体 | `send_message`, `send_media` |
| 语音（可选） | `text_to_speech` — 在配置中启用 TTS 时注册 |
| 记忆（可选） | `memory_search`, `memory_get`；配置后可含 `session_search` |
| 图像（可选） | `image`, `image_generate` — 需模型与密钥 |
| 浏览器（可选） | `browser_use`；`browser_recipe` 用于管理已保存的[浏览器自动化](browser-workflows.md) |
| 委托与代码（可选） | `delegate_task`, `execute_code` |
| 多 Agent 编排（可选） | `workflow` — 通过确定性 JS 脚本扇出子 Agent。见 [动态工作流](workflows.md)。 |
| 自动化（可选） | `automation` — 运行时提供自动化服务（常见为网关） |
| 外部工具 | `xopc_tool_search`、`xopc_tool_describe`、`xopc_tool_execute` — 统一发现和调用 MCP、Composio、扩展与远程记忆工具，不注入其 schema |

扩展可向外部工具目录追加能力，但不会直接追加到模型可见工具列表。

**MCP 工具：** 按需从 `mcp.servers` 读取目录；已安装 Connector 会在这里生成受管服务器，Extension 只能声明 `connectorDependencies`，不能注入 MCP 配置。Agent 策略仍可按服务器或稳定策略 id 禁用。详见 [MCP](mcp.md)。

**条件注册举例：** `session_search` 依赖会话持久化；`web_extract` 可通过 `XOPC_WEB_EXTRACT_MODEL` 指定抽取模型；技能写入受 `skills.agentWritePolicy` 约束；技能发现可通过 `skills.toolGating` 与元数据门控。Skills Hub CLI：`xopc skills hub pull|update|lock`，见 [Skills 指南](./skills.md)。

---

## 文件系统

### `read_file`

读取文件；输出有上限（默认约前 500 行 / 50KB）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `limit` | number | 否 | 最大行数（默认 500） |

```json
{
  "name": "read_file",
  "arguments": { "path": "src/index.ts", "limit": 100 }
}
```

### `write_file`

新建或整文件覆盖。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `content` | string | 是 | 完整内容 |

```json
{
  "name": "write_file",
  "arguments": {
    "path": "src/new-file.ts",
    "content": "export const hello = 'world';"
  }
}
```

### `edit_file`

用精确匹配的 `oldText` 替换为 `newText`（含空白须完全一致）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 是 | 文件路径 |
| `oldText` | string | 是 | 待替换片段 |
| `newText` | string | 是 | 替换为 |

```json
{
  "name": "edit_file",
  "arguments": {
    "path": "src/index.ts",
    "oldText": "const x = 1;",
    "newText": "const x = 2;"
  }
}
```

### `list_dir`

列出目录项（默认从工作区根开始）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `path` | string | 否 | 目录路径 |

```json
{
  "name": "list_dir",
  "arguments": { "path": "src/components" }
}
```

---

## 搜索（`grep`、`find`）

### `grep`

使用 ripgrep 做文本检索。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pattern` | string | 是 | 模式（`literal` 未开则为正则） |
| `glob` | string | 否 | 如 `*.ts` |
| `path` | string | 否 | 起始目录 |
| `ignoreCase` | boolean | 否 | 忽略大小写 |
| `literal` | boolean | 否 | 纯文本 |
| `context` | number | 否 | 上下文行数 |
| `limit` | number | 否 | 最大命中数（默认 100） |

```json
{
  "name": "grep",
  "arguments": {
    "pattern": "function.*test",
    "glob": "*.ts",
    "path": "src",
    "ignoreCase": true,
    "limit": 50
  }
}
```

### `find`

按文件名模式查找文件。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pattern` | string | 是 | 类 glob 的文件名模式 |
| `path` | string | 否 | 起始目录 |
| `limit` | number | 否 | 最大结果数 |

```json
{
  "name": "find",
  "arguments": { "pattern": "*.test.ts", "path": "src", "limit": 20 }
}
```

---

## `shell`

在工作区约束下执行 shell；标准输出/错误会截断（例如保留末尾约 50KB）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | 命令行 |
| `timeout` | number | 否 | 超时秒数（默认 1800） |
| `cwd` | string | 否 | 工作目录 |

默认最长约 30 分钟；执行范围限制在工作区内。

```json
{
  "name": "shell",
  "arguments": { "command": "git log --oneline -10", "timeout": 60 }
}
```

在成功执行 **`skill_view`** 后，SKILL 中声明的环境变量**名**可注册到本会话；**`shell`** 子进程可带上进程中已存在的同名变量（**值**不会暴露给模型）。

---

## 网页

### `web_search`

按 `tools.web.search.providers` 依次尝试；均失败时按地区走 HTML 兜底。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 检索词 |
| `count` | number | 否 | 最大条数（默认见 `tools.web.search.maxResults`） |

```json
{
  "tools": {
    "web": {
      "region": "global",
      "search": {
        "maxResults": 5,
        "providers": [{ "type": "brave", "apiKey": "BSA_your_key_here" }]
      }
    }
  }
}
```

### `web_fetch`

请求 URL 并返回页面内容供模型使用（HTTP 客户端，有超时）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 地址 |
| `timeout` | number | 否 | 超时秒数（默认 30） |

### `web_extract`

抓取 HTML 或 JSON、去掉明显噪声后，用配置的抽取模型生成偏 Markdown 的结果。可选 `instruction`、`maxLength`（默认来自配置或约 15000 字符）。**超大页面**会按块分段抽取，避免单次把整页塞进模型（内部仍有体积上限）。

**配置：** 需要强制指定抽取模型时使用 `XOPC_WEB_EXTRACT_MODEL`。

---

## 消息

### `send_message`

向已配置的通道发消息。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `channel` | string | 是 | 如 `telegram` |
| `chat_id` | string | 是 | 目标会话 |
| `content` | string | 是 | 正文 |
| `accountId` | string | 否 | 多账号 id |

### `send_media`

向**当前会话**发送**本地**文件：`filePath`，可选 `mediaType`（`photo` | `video` | `audio` | `document`）、`caption`。类型可按扩展名推断。

### `text_to_speech`（可选）

TTS 开启时注册。用于需要语音播报的场景；一般仍以文字回复为主。详见 [配置 — tts](./configuration.md#tts) 与 [语音（STT/TTS）](./voice.md)。

---

## 记忆

### `memory_search`

在工作区 `memory/` 下检索。当回答需要依据已落盘的笔记、既有结论时使用。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 检索词 |
| `limit` | number | 否 | 最大条数（默认 10） |

### `memory_get`

读取 `memory_search` 返回的一条结构化记忆记录。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 稳定的记忆记录 id |

### `session_search`

检索**其它会话**的 transcript（关键词或类语义检索；可按会话生成摘要）。需要 SQLite 会话持久化。需要强制指定摘要模型时使用 `XOPC_SESSION_SEARCH_MODEL`。

详见 [会话管理](./session.md) 与 [配置参考](./configuration.md)。

---

## 规划与澄清

### `clarify`

向用户提问并等待回复；可选 `choices`（2–10 项）、可选 `default`。在已接线的 **网页**、**Telegram**、**CLI** 上可走交互；否则返回说明并可能使用 `default`。

### `todo`

会话级待办：`id`、`content`、`status`（`pending` | `in_progress` | `completed` | `cancelled`）。`merge: true` 按 `id` 合并；`merge: false` 或省略则整表替换。省略 `todos` 为读取当前列表。

---

## Skills

### `skills_list`

列出当前会话可用技能（名称、描述、来源），受允许列表与工具门控影响。可选 `query` 在名称/描述中做子串过滤。

### `skill_view`

加载 `SKILL.md` 或 `references/`、`templates/`、`scripts/`、`assets/` 下路径。参数：`name`、可选 `path`、可选 `limit`（行数，默认 500）。注册 SKILL 声明的环境变量**名**供 `shell` 透传。遵守 `skills.limits.maxSkillFileBytes` 与被禁用/门控技能。

请用 `skills_list` / `skill_view` 加载技能正文，不要从 `<available_skills>` 硬猜路径或直接绕开这些工具读盘。

### `skill_manage`

`create` / `edit` / `patch` / `delete` / `write_file` / `remove_file`；受 `skills.agentWritePolicy`（`global` | `workspace` | `both`）约束；内置技能不可写；写入经安全扫描。

技能可设 `disable-model-invocation`，文件仍在磁盘但对模型隐藏。Hub：`xopc skills hub pull|update|lock`，见 [Skills 指南](./skills.md)。

---

## 图像与文生图

入站图片：若**会话主模型**支持视觉，则随用户消息传入；否则可能先用可用的视觉模型转成文字描述。详见 [图像与视觉](./image-multimodal.md)。

### `image`

对路径或 URL 上的图片做视觉理解；可选 `prompt`。用户已附图且主模型多模态时，往往不必再调。

图像理解由所选 agent/runtime 的图像能力设置和已配置 provider 解析。使用 `xopc image status` 查看当前行为。

### `image_generate`

文生图；成功时保存到工作区 `media/generated/`。`action: "list"` 可列出已注册的文生图提供方与模型。

生成 provider 会根据当前配置在运行时发现。使用 `xopc image providers` 查看可用选项。

程序化接口可能对部分厂商支持参考图；`image_generate` 工具未必暴露全部参数。

---

## 浏览器（可选）

当浏览器自动化已在配置中启用，并被所选 agent manifest 允许时注册。本地浏览器运行时为可选依赖：

```bash
npm install playwright-core@1.60.0
npx playwright-core install chromium
```

如果 xopc 本身是全局安装，请在安装命令中添加 `-g`。

| 工具 | 作用 |
|------|------|
| `browser_use` | 负责打开网页、读取内容、点击、输入、滚动、截图和等待页面变化等浏览器操作。复杂任务可先调用 `tool_manual({ tool: "browser_use" })`。 |
| `browser_recipe` | 网关提供浏览器自动化服务时，用于保存、列出、运行、暂停和修改可重复使用的[浏览器自动化](browser-workflows.md)。 |

如需为某个 agent 禁用浏览器自动化，将该 agent manifest 的 `tools.builtin.browser_use.mode` 设为 `"deny"`，或从相关 capability preset 中移除浏览器权限。

**URL 策略：** 拒绝带内嵌凭据的 URL、指向**云元数据 / IMDS** 及链路本地地址的导航（即使允许私网也仍拦截），以及查询串里疑似 **API Key / Token 外泄** 的模式。顶层 `browser.allowPrivateUrls` 仅放宽**私网 IP** 拦截；元数据与可疑凭据模式仍拦截。

**运行后端：** 顶层 `browser.backend` 选择浏览器后端（`local`、`cdp`、`cloud`、`extension`、`cloakbrowser`）。可选 `browser.cdpUrl` 直连 CDP WebSocket。单次操作超时：`browser.commandTimeout`（秒）。**对话框：** `browser.dialogPolicy`（`must_respond` \| `auto_dismiss` \| `auto_accept`）与 `browser.dialogTimeoutSeconds` 配合 CDP 监督器。

每会话独立标签；`browser.headless` 控制本机浏览器是否显示窗口。

---

## 委托与沙箱代码（可选）

### `delegate_task`

子智能体**独立上下文**（无父会话 transcript），仅返回**文字摘要**。含 `goal`、`context`、`toolset`、`maxIterations`（默认 30）等。子智能体不能嵌套 `delegate_task`，也不能用 `clarify`、外发消息、记忆、`todo`、`automation`、Skills 管理类工具。

可用性由所选 agent manifest 与 capability presets 控制。

### `execute_code`

在 VM 中执行 JavaScript，暴露白名单内的 `tools.*`（如 `web_search`、`web_fetch`、`read_file`、`write_file`、`grep`、`find`、`shell`、`skills_list`、`skill_view`）及 `console.log`。执行时间、工具调用次数、输出体量均有上限。

可用性由所选 agent manifest 与 capability presets 控制。`node:vm` **不是**强隔离边界；仅建议在可信模型与环境开启。

---

## 定时任务（网关）

### `automation`

`list` / `create` / `update` / `delete` / `run` / `pause` / `resume` / `history`。创建/更新使用与 `/api/automations` 相同的结构化 payload：一个触发器（`manual`、`schedule` 或 `webhook`）和一个动作（Agent 指令或工作流运行）。计划触发可使用 `once`、`interval` 或 cron 表达式。

仅当运行时提供自动化服务时注册（网关部署常见）。

---

## 典型限制

| 操作 | 限制 |
|------|------|
| 文件路径 | 限制在工作区内 |
| Shell | 默认 30 分钟超时；输出截断（约末尾 50KB） |
| 文件读取 | 行数/字节上限（如约 500 行 / 50KB） |
| 单文件大小 | 过大读取会拒绝（如约 10MB 量级） |

具体数值可能随版本微调，本表作数量级参考。

---

## 进度反馈

耗时步骤会触发进度阶段，便于控制台、Telegram 等展示状态。示例映射：

| 工具 | 阶段（概念） | 界面图标 |
|------|----------------|----------|
| `read_file` | 读取中 | 📖 |
| `write_file` / `edit_file` | 写入中 | ✍️ |
| `grep` / `find` / `web_*` | 检索中 | 🔍 |
| `shell` / 浏览器 / `delegate_task` / `execute_code` / `automation` | 执行中 | ⚙️ |

在配置的 `progress` 下可调整如 `level`、`streamToolProgress`、`heartbeatEnabled`。详见 [进度反馈](./progress.md)。

---

## 运维说明

- **高权限工具：** 将 `execute_code`、`delegate_task`、浏览器相关能力视为强能力，按需开启。
- **Skills：** 写入遵循 `skills.agentWritePolicy`；`skill_view` 受 `skills.limits.maxSkillFileBytes` 限制。
- **记忆插件：** 实现可通过 `MemoryManager.getAdditionalTools()` 注入额外记忆类工具。

---

_最后更新：2026-05-08_
