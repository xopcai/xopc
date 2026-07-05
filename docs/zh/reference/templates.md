# 工作区模板

xopc 使用 **profile Markdown** 模板定义智能体行为与知识。执行 `onboard`、`setup` 或 `agents add` 时，会将缺失的模板 **复制**（**不会**覆盖已有文件）到该智能体 **解析后的 Markdown 工作空间根**（见 [磁盘与目录布局](../disk-layout.md)）。下文列出标准文件名与用途，便于对照编辑。

运行时选取模板的顺序：`XOPC_TEMPLATE_PATH`（若设置且存在）→ 从安装目录向上查找 `docs/reference/templates` → 否则使用与 `workspace-seed` 同目录打包的 `workspace-templates/`。**文档站中的 `docs/zh/reference/templates/*.md` 仅用于中文路由展示，与运行时种子无直接关系**（正文目前与英文模板相同）。

## 模板文件列表

| 文件 | 用途 |
|------|------|
| [SOUL.md](/zh/reference/templates/SOUL) | 智能体的核心身份、个性与价值观 |
| [TOOLS.md](/zh/reference/templates/TOOLS) | 工具使用说明和最佳实践 |
| [AGENTS.md](/zh/reference/templates/AGENTS) | 多智能体协作说明 |
| [MEMORY.md](/zh/reference/templates/MEMORY) | 关键信息存储和记忆索引 |
| [IDENTITY.md](/zh/reference/templates/IDENTITY) | 身份和边界定义 |
| [HEARTBEAT.md](/zh/reference/templates/HEARTBEAT) | 主动监控配置 |

## 系统提示加载顺序

以下文件从智能体 profile 根读取，并按此顺序写入智能体系统提示。全局个人资料会从 **`user/PROFILE.md`** 单独读取，并排在智能体 profile 前。

1. **SOUL.md**
2. **IDENTITY.md**
3. **TOOLS.md**
4. **AGENTS.md**
5. **HEARTBEAT.md**
6. **MEMORY.md**

**CONTEXT.md**、**SKILLS.md** **不在**默认写入系统提示的列表中。`xopc init` **不会**在工作区根下创建这两个文件；需要时可自行放在工作区根。`onboard` / `agents add` 的种子流程只复制上文列表，**不会**自动从本文档目录带入 `CONTEXT.md` / `SKILLS.md`（需自行放入工作区根）。

## 记忆系统

记忆文件支持动态更新：

- **MEMORY.md** - 永久记忆的索引
- 记忆通过运行时工具和 curated store 管理；profile 模板不会创建按日期命名的记忆文件

智能体可以通过 `memory_search` 和 `memory_get` 工具搜索和读取记忆。

**托管记忆**（可选）：**`agents/<agentId>/memories/MEMORY.md`** 与 **`user/MEMORY.md`** 存放有上限、可由 `curated_memory` 维护的条目，与 **`agents/<agentId>/profile/MEMORY.md`**（系统提示用 profile）和 **`user/PROFILE.md`**（可编辑个人资料）不同。见 [托管记忆](../workspace.md#curated-memory) 与 [配置参考](../configuration.md) 中所选 agent manifest 的 `memory` 策略。

## 编辑建议

- 使用 Markdown 格式
- 保持简洁，关键信息放在前面
- 定期更新全局个人资料、用户记忆和智能体 MEMORY.md
- 使用清晰的标题结构

## 另见

- [状态目录与工作空间布局](../workspace.md)
- [磁盘与目录布局](../disk-layout.md)
