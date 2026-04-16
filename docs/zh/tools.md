# 内置工具参考

内置工具按当前环境注册：部分始终可用；部分依赖 **配置**、**会话存储**（例如 `session_search`）或正在运行的 **网关**（例如交互式 `clarify`、已接入计划任务的 `cronjob`）。

## 工具列表

| 类别 | 工具名 |
|------|--------|
| **规划与交互** | `clarify`, `todo` |
| **Skills 运行时** | `skills_list`, `skill_view`, `skill_manage` |
| **文件系统** | `read_file`, `write_file`, `edit_file`, `list_dir` |
| **搜索** | `grep`, `find` |
| **Shell** | `shell` |
| **网页** | `web_search`, `web_fetch`, `web_extract` |
| **消息与媒体** | `send_message`, `send_media` |
| **记忆** | `memory_search`, `memory_get`, `curated_memory`（可选）, `session_search`（可选） |
| **图像** | `image`（可选）, `image_generate`（可选） |
| **浏览器** | `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_screenshot`（可选） |
| **委托与代码** | `delegate_task`（可选）, `execute_code`（可选） |
| **定时任务** | `cronjob`（可选） |

扩展包在存在扩展注册表时还可追加工具。

### 近期能力增强（工具 + Skill 运行时，约 20 项）

1. **`skills_list` / `skill_view` / `skill_manage`**：发现技能、读取 `SKILL.md` 或 `references/` 等子目录文件、在策略允许下增删改用户技能（见 [Skills 指南](./skills.md)）。
2. **Skill 环境变量透传**：`skill_view` 后根据 SKILL.md 声明注册变量**名**；**`shell`** 可将进程中已存在的同名变量带入子进程（模型永不看到变量值）。
3. **`web_extract`**：拉取页面后用 LLM 做面向 Markdown 的抽取（`agents.defaults.webExtract.model` 或 `XOPC_WEB_EXTRACT_MODEL`）。
4. **`send_media`**：向当前会话通道发送本地图片/视频/音频/文档。
5. **`clarify`**：在 **Web / Telegram / CLI** 等已接线环境可阻塞等待用户作答；否则返回说明并尽量使用 `default`。
6. **`todo`**：按会话维护待办，支持按 `id` 合并或整表替换。
7. **`image` / `image_generate`**：在模型与密钥可用时做视觉理解与文生图。
8. **浏览器工具**：`agents.defaults.browser.enabled` 时启用 Playwright（需 `npx playwright install chromium`）。
9. **`delegate_task`**：子智能体独立上下文、受限工具集、仅返回摘要（`agents.defaults.delegate.enabled`）。
10. **`execute_code`**：沙箱 JS 以编程方式调用部分工具（`agents.defaults.executeCode.enabled`）；非强安全边界，仅可信模型场景使用。
11. **`cronjob`**：网关提供 `CronService` 时管理定时智能体轮次，带简单提示注入扫描。
12. **`session_search`**：跨会话 transcript 检索（可选会话级摘要）。
13. **`curated_memory`**：操作 agent 主目录 `memories/` 的实时内容，系统提示中保留会话开始时的快照。
14. **Skill 工具门控**：`skills.toolGating` 与技能元数据可要求「已注册工具」后才出现在 `<available_skills>`。
15. **`disable-model-invocation`**：技能仍安装，但对模型隐藏列表项。
16. **Skills Hub CLI**：`xopc skills hub pull|update|lock`，安装至 `~/.xopc/skills` 并维护 `skills-lock.json`。
17. **`web_search`**：`tools.web.search.providers` 多服务商链 + 按地区 HTML 兜底。
18. **`skills.limits.maxSkillFileBytes`**：限制 `skill_view` 单次读取体积。
19. **Memory 插件**：`MemoryManager.getAdditionalTools()` 可注入额外记忆相关工具。
20. **多服务商图像路径**：图像工具与其它模型共用解析与密钥体系。

---


## 📄 read_file

读取文件内容。输出自动截断至前 500 行或 50KB。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `limit` | number | ❌ | 最大行数 (默认 500) |

---

## ✍️ write_file

创建或覆盖文件。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `content` | string | ✅ | 文件内容 |

---

## ✏️ edit_file

替换文件中的指定文本。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `path` | string | ✅ | 文件路径 |
| `oldText` | string | ✅ | 要替换的文本 |
| `newText` | string | ✅ | 替换文本 |

---

## 📂 list_dir

列出目录内容。

---

## 💻 shell

执行 Shell 命令。输出自动截断至最后 50KB。

### 限制

- 超时: 5 分钟
- 输出截断: 50KB

---

## 🔍 grep

在文件中搜索文本。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `pattern` | string | ✅ | 搜索模式 (支持正则) |
| `glob` | string | ❌ | 文件匹配模式 |
| `path` | string | ❌ | 搜索目录 |
| `ignoreCase` | boolean | ❌ | 忽略大小写 |
| `literal` | boolean | ❌ | 纯文本匹配 |
| `context` | number | ❌ | 上下文行数 |
| `limit` | number | ❌ | 最大结果数 (默认 100) |

---

## 📄 find

按条件查找文件。

### 参数

| 参数 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `pattern` | string | ✅ | 文件名匹配模式 |
| `path` | string | ❌ | 搜索目录 |
| `limit` | number | ❌ | 最大结果数 |

---

## 🔍 web_search

按 `tools.web.search.providers` 配置依次尝试搜索；全部失败则按地区使用 HTML 兜底。

### 配置示例

```json
{
  "tools": {
    "web": {
      "search": {
        "maxResults": 5,
        "providers": [{ "type": "brave", "apiKey": "BSA_your_key_here" }]
      }
    }
  }
}
```

---

## 📄 web_fetch

获取网页内容。

---

## 📨 send_message

发送消息到配置的通道。

---

## 🔍 memory_search

搜索记忆文件。在回答关于之前工作、决定等问题前必须调用。

---

## 📄 memory_get

从记忆文件读取片段。

---

## 🧠 curated_memory

读取或编辑 **`agents/<agentId>/memories/`** 下的 **`MEMORY.md`** 与 **`USER.md`**（条目以 § 分隔，有总字数上限）。系统提示里包含会话开始时的 **冻结快照**；本工具操作的是磁盘上的 **实时** 内容。当 `agents.defaults.memory.enabled` 为 `false` 或 `useEnhancedSystem` 为 `false` 时不注册。若 `userProfileEnabled` 为 `false`，对 user 画像的写入会被拒绝（读仍允许）。

详见 [配置参考](zh/configuration.md) 中的 **agents.defaults.memory** 与 [托管记忆](zh/workspace.md#curated-memory)。

---

## 🔎 session_search

检索 **其他会话** 的 transcript（关键词或带可选的按会话摘要）。需要会话持久化与智能体侧接入；摘要模型由 `agents.defaults.sessionSearch.summaryModel` 或环境变量 `XOPC_SESSION_SEARCH_MODEL` 指定。

详见 [配置参考](zh/configuration.md) 中的 **agents.defaults.sessionSearch**。

---

## 规划与澄清

### ❓ `clarify`

向用户提问并等待回答；可选 `choices`（2–10 项选择题）、可选 `default`。在已接线的 Web/Telegram/CLI 会话中走交互；否则返回提示并尽量使用 `default`。

### ✅ `todo`

会话级待办列表。传入 `todos`（含 `id`、`content`、`status`）；`merge: true` 时按 `id` 合并，否则替换整张表。省略 `todos` 为读取当前列表。

---

## Skills 工具

### 📚 `skills_list`

列出当前会话可见的已启用技能（受 allowlist 与工具门控影响）。可选 `query` 按名称/描述子串过滤。

### 📖 `skill_view`

读取 `SKILL.md` 或 `references/`、`templates/`、`scripts/`、`assets/` 下文件。参数：`name`、可选 `path`、可选 `limit`（行数，默认 500）。成功读取后注册声明的环境变量**名**供透传。

### 🛠️ `skill_manage`

`create` / `edit` / `patch` / `delete` / `write_file` / `remove_file`，受 `skills.agentWritePolicy` 约束；内置技能不可写；写入后做安全扫描。

---

## 网页抽取

### 🧾 `web_extract`

抓取 `url`，可选 `instruction`（关注点）、`maxLength`。模型由 `agents.defaults.webExtract.model` 或 `XOPC_WEB_EXTRACT_MODEL` 指定。

---

## 媒体消息

### 📎 `send_media`

参数：`filePath`、可选 `mediaType`、`caption`。可根据扩展名推断类型。

---

## 图像

通道 / 网页入站的图片：若**会话主模型**支持视觉，则**原样**作为多模态内容传入；否则会先用 **`imageModel`**（可带 `fallbacks`）上的视觉模型**描述**为文本再交给主模型。详见 [图像与视觉](image-multimodal.md)。

### 🖼️ `image` / 🎨 `image_generate`

- **`image`**：从路径或 URL 加载一张或多张图做视觉理解；依赖 `agents.defaults.imageModel`（字符串或 `{ primary, fallbacks }`）、`mediaMaxMb` 与对应 API Key。
- **`image_generate`**：按 `imageGenerationModel` 链文生图，成功时写入工作区 `media/generated/`；`action: "list"` 可列出已注册的文生图 Provider 摘要。

程序内的 `generateImage()` 支持 OpenAI **图生图/编辑**（`inputImages`，当前取第一张参考图）；`image_generate` 工具尚未暴露该参数。

---

## 浏览器工具（可选）

`agents.defaults.browser.enabled` 时注册：`browser_navigate`、`browser_snapshot`、`browser_click`、`browser_type`、`browser_scroll`、`browser_screenshot`。默认禁止 localhost/内网 URL；会话级标签页。

---

## 委托与沙箱代码

### 🤖 `delegate_task`

子智能体独立执行，仅返回摘要；工具集受限，不可嵌套委托或使用 clarify/消息/记忆/todo/cronjob/Skills 管理类工具。

### 💾 `execute_code`

VM 内 JS，暴露受限 `tools.*` 与 `console.log`；有执行时间、工具调用次数与输出长度上限。`node:vm` 非强隔离。

---

## 定时任务（网关）

### ⏰ `cronjob`

`list` / `create` / `update` / `remove` / `enable` / `disable` / `history`。需运行时注入 `CronService`（典型为网关）。

---

## 安全限制

| 操作 | 限制 |
|------|------|
| 文件路径 | 限制在 workspace 目录内 |
| Shell 命令 | 超时 5 分钟 |
| 文件读取 | 500 行或 50KB |
| Shell 输出 | 50KB |
| 文件大小 | 最大 10MB |

---

## 使用建议

- 在 `skills.promptStyle` 为 `metadata-only`（默认）时，优先用 `skills_list` / `skill_view` 读技能，而非直接 `read_file` 技能路径。
- 谨慎开启 `execute_code`、浏览器与 `delegate_task` 等高能力工具。

---

_最后更新：2026-04-11_
