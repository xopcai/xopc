# 工作区模板

xopc 使用 **profile Markdown** 模板定义智能体行为与知识。执行 `onboard`、`setup` 或 `agents add` 时，会将缺失的模板 **复制**（**不会**覆盖已有文件）到该智能体 **解析后的 Markdown 工作空间根**（见 [磁盘与目录布局](../disk-layout.md)）。下文列出标准文件名与用途，便于对照编辑。

运行时选取模板的顺序：`XOPC_TEMPLATE_PATH`（若设置且存在）→ 从安装目录向上查找 `docs/reference/templates` → 否则使用与 `workspace-seed` 同目录打包的 `workspace-templates/`。**文档站中的 `docs/zh/reference/templates/*.md` 仅用于中文路由展示，与运行时种子无直接关系**（正文目前与英文模板相同）。

## 模板文件列表

| 文件 | 用途 |
|------|------|
| [SOUL.md](/zh/reference/templates/SOUL) | 智能体的核心身份、个性与价值观 |
| [USER.md](/zh/reference/templates/USER) | 关于你的信息、偏好与需求 |
| [TOOLS.md](/zh/reference/templates/TOOLS) | 工具使用说明和最佳实践 |
| [AGENTS.md](/zh/reference/templates/AGENTS) | 多智能体协作说明 |
| [MEMORY.md](/zh/reference/templates/MEMORY) | 关键信息存储和记忆索引 |
| [IDENTITY.md](/zh/reference/templates/IDENTITY) | 身份和边界定义 |
| [HEARTBEAT.md](/zh/reference/templates/HEARTBEAT) | 主动监控配置 |
| [BOOTSTRAP.md](/zh/reference/templates/BOOTSTRAP) | 首次运行 / 起源说明（**不在**默认系统提示加载顺序中） |

## 系统提示加载顺序

以下文件从 **Markdown 工作空间根** 读取（若存在），并按此顺序写入智能体系统提示：

1. **SOUL.md**
2. **IDENTITY.md**
3. **USER.md**
4. **TOOLS.md**
5. **AGENTS.md**
6. **HEARTBEAT.md**
7. **MEMORY.md**

**BOOTSTRAP.md** 也会在新建智能体时一并复制，但**不在**上述系统提示链中（仅作首次运行 / 人工说明）。

**CONTEXT.md**、**SKILLS.md** **不在**默认写入系统提示的列表中。`xopc init` 仍可能在 **工作区根** 下**生成**这两个文件。`onboard` / `agents add` 的种子流程只复制上文列表及 **BOOTSTRAP.md**，**不会**自动从本文档目录带入 `CONTEXT.md` / `SKILLS.md`（需自行放入工作区根）。

## 记忆系统

记忆文件支持动态更新：

- **MEMORY.md** - 永久记忆的索引
- **memory/*.md** - 按日期或主题组织的记忆片段

智能体可以通过 `memory_search` 和 `memory_get` 工具搜索和读取记忆。

**托管记忆**（可选）：**`agents/<agentId>/memories/MEMORY.md`** 与 **`USER.md`** 存放有上限、可由 `curated_memory` 维护的条目，与工作区根下 profile 用的 **`MEMORY.md`** 不同。见 [托管记忆](../workspace.md#curated-memory) 与 [配置参考](../configuration.md)（`agents.defaults.memory`）。

## 编辑建议

- 使用 Markdown 格式
- 保持简洁，关键信息放在前面
- 定期更新 USER.md 和 MEMORY.md
- 使用清晰的标题结构

## 另见

- [状态目录与工作空间布局](../workspace.md)
- [磁盘与目录布局](../disk-layout.md)
