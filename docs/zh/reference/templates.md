# 工作区模板

xopc 使用 **profile Markdown** 模板定义智能体行为与知识。执行 `onboard`、`setup` 或 `agents add` 时，会将缺失的模板 **复制**（**不会**覆盖已有文件）到该智能体 **解析后的 Markdown 工作空间根**（见 [磁盘与目录布局](../disk-layout.md)）。下文列出标准文件名与用途，便于对照编辑。

运行时选取模板的顺序：`XOPC_TEMPLATE_PATH`（若设置且存在）→ 从安装目录向上查找 `docs/reference/templates` → 否则使用与 `workspace-seed` 同目录打包的 `workspace-templates/`。**文档站中的 `docs/zh/reference/templates/*.md` 仅用于中文路由展示，与运行时种子无直接关系**（正文目前与英文模板相同）。

## 模板文件列表

| 文件 | 用途 |
|------|------|
| [SOUL.md](/zh/reference/templates/SOUL) | 智能体的核心身份、个性与价值观 |
| [TOOLS.md](/zh/reference/templates/TOOLS) | 工具使用说明和最佳实践 |
| [AGENTS.md](/zh/reference/templates/AGENTS) | 多智能体协作说明 |
| [IDENTITY.md](/zh/reference/templates/IDENTITY) | 身份和边界定义 |
| [HEARTBEAT.md](/zh/reference/templates/HEARTBEAT) | 主动监控配置 |

## 系统提示加载顺序

以下文件从智能体 profile 根读取，并按此顺序写入智能体系统提示。全局个人资料会从 **`user/PROFILE.md`** 单独读取，并排在智能体 profile 前。

1. **SOUL.md**
2. **IDENTITY.md**
3. **TOOLS.md**
4. **AGENTS.md**
5. **HEARTBEAT.md**

**CONTEXT.md**、**SKILLS.md** **不在**默认写入系统提示的列表中。`xopc init` **不会**在工作区根下创建这两个文件；需要时可自行放在工作区根。`onboard` / `agents add` 的种子流程只复制上文列表，**不会**自动从本文档目录带入 `CONTEXT.md` / `SKILLS.md`（需自行放入工作区根）。

## 记忆系统

记忆不属于 Agent profile 模板。所有 Agent 使用同一份用户存储：**`user/MEMORY.md`** 与 **`user/memories/MEMORY.md`**。通过顶层 `userContext` 统一配置，并在运行时使用 `memory_search`、`memory_get` 和 `curated_memory`。见 [共享用户记忆](../workspace.md#curated-memory)。

## 编辑建议

- 使用 Markdown 格式
- 保持简洁，关键信息放在前面
- 定期更新全局个人资料与共享用户记忆
- 使用清晰的标题结构

## 另见

- [状态目录与工作空间布局](../workspace.md)
- [磁盘与目录布局](../disk-layout.md)
