# 内置工具

本文说明 xopc 智能体可调用的内置能力：读写工作区、执行命令、检索与浏览网页、对接通道与技能等。实际注册哪些工具取决于 **配置**、可选 **能力**（记忆、浏览器、TTS）、是否接入 **网关**（例如交互式 `clarify`、计划任务 `cronjob`），以及是否加载 **扩展**（扩展可向注册表追加工具）。

---

## 一览

| 类别 | 工具 |
|------|------|
| 规划与澄清 | `clarify`, `todo` |
| Skills | `skills_list`, `skill_view`, `skill_manage` |
| 工作区文件 | `read_file`, `write_file`, `edit_file`, `list_dir` |
| 仓库内搜索 | `grep`, `find` |
| Shell | `shell` |
| 网页 | `web_search`, `web_fetch`, `web_extract` |
| 消息与媒体 | `send_message`, `send_media` |
| 语音（可选） | `text_to_speech` — 在配置中启用 TTS 时注册 |
| 记忆（可选） | `memory_search`, `memory_get`；配置后可含 `curated_memory`、`session_search` |
| 图像（可选） | `image`, `image_generate` — 需模型与密钥 |
| 浏览器（可选） | `browser_*` — 启用浏览器自动化时 |
| 委托与代码（可选） | `delegate_task`, `execute_code` |
| 定时任务（可选） | `cronjob` — 运行时提供 Cron（常见为网关） |

扩展也可追加工具。

**条件注册举例：** `session_search` 依赖会话持久化；`web_extract` 使用 `agents.defaults.webExtract.model` 或 `XOPC_WEB_EXTRACT_MODEL`；技能写入受 `skills.agentWritePolicy` 约束；技能发现可通过 `skills.toolGating` 与元数据门控。Skills Hub CLI：`xopc skills hub pull|update|lock`，见 [Skills 指南](./skills.md)。

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
| `timeout` | number | 否 | 超时秒数（默认 300） |
| `cwd` | string | 否 | 工作目录 |

默认最长约 5 分钟；执行范围限制在工作区内。

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

**配置：** `agents.defaults.webExtract.model` 或 `XOPC_WEB_EXTRACT_MODEL`。

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

按文件与片段 id 读取记忆片段。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | string | 是 | 记忆文件名 |
| `snippet` | string | 是 | 片段标识 |

### `curated_memory`

读写 **`agents/<agentId>/memories/`** 下的 **`MEMORY.md`**、**`USER.md`**（章节边界按格式约定）。系统提示里保留会话开始时的**快照**；本工具读写磁盘上的**实时**状态。`agents.defaults.memory.enabled` 为 false 或 `useEnhancedSystem` 为 false 时不注册。`userProfileEnabled` 为 false 时，对用户画像的写入会被拒绝（读可能仍可用）。

详见 [配置参考](./configuration.md) 与 [托管记忆](./workspace.md#curated-memory)。

### `session_search`

检索**其它会话**的 transcript（关键词或类语义检索；可按会话生成摘要）。需持久化与接入；摘要模型：`agents.defaults.sessionSearch.summaryModel` 或 `XOPC_SESSION_SEARCH_MODEL`。

详见 [配置参考](./configuration.md) 中 `agents.defaults.sessionSearch`。

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

入站图片：若**会话主模型**支持视觉，则随用户消息传入；否则可能先用 **`imageModel`（含回退）** 转成文字描述。详见 [图像与视觉](./image-multimodal.md)。

### `image`

对路径或 URL 上的图片做视觉理解；可选 `prompt`。用户已附图且主模型多模态时，往往不必再调。

**配置：** `agents.defaults.imageModel`（字符串或 `{ primary, fallbacks }`）、`agents.defaults.mediaMaxMb`。

### `image_generate`

文生图；成功时保存到工作区 `media/generated/`。`action: "list"` 可列出已注册的文生图提供方与模型。

**配置：** `agents.defaults.imageGenerationModel`（字符串或 `{ primary, fallbacks }`）。

程序化接口可能对部分厂商支持参考图；`image_generate` 工具未必暴露全部参数。

---

## 浏览器（可选）

`agents.defaults.browser.enabled` 为 true 时注册。若需本机浏览器，可执行如：`npx playwright install chromium`。

| 工具 | 作用 |
|------|------|
| `browser_navigate` | 打开 http(s)；默认拦截 localhost / 私网段 |
| `browser_back` | 浏览器后退；可选 `waitFor`（`load` / `domcontentloaded` / `networkidle`） |
| `browser_snapshot` | 页面或选择器的无障碍快照 |
| `browser_click` | 通过 `selector` / `text` / `role` 点击 |
| `browser_type` | 输入（`selector` 或 `label`；可选 `pressEnter`） |
| `browser_scroll` | 页面或元素滚动 |
| `browser_press` | 按键或组合键（如 `Enter`、`Control+A`） |
| `browser_screenshot` | 视口或元素截图（有大小限制）；可选视觉描述提示 |
| `browser_console` | 在页面上下文执行 JS 表达式（可选参数 `javascript`） |
| `browser_get_images` | 列出范围内图片 URL（可选 `selector`、`maxImages`） |
| `browser_dialog` | 接受/关闭待处理的 JS 对话框（`alert` / `confirm` / `prompt` / `beforeunload`）；需 CDP 监督器 |
| `browser_vision` | 截图并由视觉模型分析；需配置 `agents.defaults.imageModel` |
| `browser_cdp` | 发送原始 Chrome DevTools Protocol 命令（高级用法） |
| `browser_close` | 关闭本会话的浏览器标签 |

**URL 策略：** 拒绝带内嵌凭据的 URL、指向**云元数据 / IMDS** 及链路本地地址的导航（即使允许私网也仍拦截），以及查询串里疑似 **API Key / Token 外泄** 的模式。`agents.defaults.browser.allowPrivateUrls` 仅放宽**私网 IP** 拦截；元数据与可疑凭据模式仍拦截。

**运行后端：** `agents.defaults.browser.cloudProvider` — `local`（默认 Playwright）、`browserbase`、`browser-use`。可选 `cdpUrl` 直连 CDP WebSocket，绕过云厂商封装。单次操作超时：`commandTimeout`（秒）。**对话框：** `dialogPolicy`（`must_respond` \| `auto_dismiss` \| `auto_accept`）与 `dialogTimeoutSeconds` 配合 CDP 监督器。

每会话独立标签；`agents.defaults.browser.headless` 在启用时默认可为 true。

---

## 委托与沙箱代码（可选）

### `delegate_task`

子智能体**独立上下文**（无父会话 transcript），仅返回**文字摘要**。含 `goal`、`context`、`toolset`、`maxIterations`（默认 30）等。子智能体不能嵌套 `delegate_task`，也不能用 `clarify`、外发消息、记忆、`todo`、`cronjob`、Skills 管理类工具。

**配置：** `agents.defaults.delegate.enabled`。

### `execute_code`

在 VM 中执行 JavaScript，暴露白名单内的 `tools.*`（如 `web_search`、`web_fetch`、`read_file`、`write_file`、`grep`、`find`、`shell`、`skills_list`、`skill_view`）及 `console.log`。执行时间、工具调用次数、输出体量均有上限。

**配置：** `agents.defaults.executeCode.enabled`。`node:vm` **不是**强隔离边界；仅建议在可信模型与环境开启；也可通过 `disabledTools` 禁用 `execute_code`。

---

## 定时任务（网关）

### `cronjob`

`list` / `create` / `update` / `remove` / `enable` / `disable` / `history`。创建/更新需计划表达式与消息；可选 `timezone`、`sessionTarget`（`main` | `isolated`）、`name`、`jobId` 等。

仅当运行时提供 `CronService` 时注册（网关部署常见）。创建/更新带简单提示安全检查。

---

## 典型限制

| 操作 | 限制 |
|------|------|
| 文件路径 | 限制在工作区内 |
| Shell | 约 5 分钟超时；输出截断（约末尾 50KB） |
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
| `shell` / 浏览器 / `delegate_task` / `execute_code` / `cronjob` | 执行中 | ⚙️ |

在配置的 `progress` 下可调整如 `level`、`streamToolProgress`、`heartbeatEnabled`。详见 [进度反馈](./progress.md)。

---

## 运维说明

- **高权限工具：** 将 `execute_code`、`delegate_task`、浏览器相关能力视为强能力，按需开启。
- **Skills：** 写入遵循 `skills.agentWritePolicy`；`skill_view` 受 `skills.limits.maxSkillFileBytes` 限制。
- **记忆插件：** 实现可通过 `MemoryManager.getAdditionalTools()` 注入额外记忆类工具。

---

_最后更新：2026-05-08_
