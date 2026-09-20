# Agent 数据获取实施记录

日期：2026-09-20。实现基于本地工作区，尚未发布。

## 阶段交付与自查

| 阶段 | 已完成 | 自查后修复 |
| --- | --- | --- |
| P0 | 顺序、原工具并行、批量三组本地基准；普通任务与代码任务评测 fixture | 区分模型请求、工具调用、来源请求；不把本地延迟冒充端到端效果 |
| P1 | 通用 data_batch、批内文件读取复用、OR 搜索、独立状态、来源与行号 | 子任务实际工具权限取交集；重复 ID 和非法参数在 I/O 前拒绝；接入嵌套 AGENTS.md |
| P2 | 共享调度器、异步安全文件读取、流式 rg、双层 deadline、结构化输出预算 | 排队取消、跨来源批内并发限制、截断后的续读位置、长噪声行不吞掉后续文件 |
| P3 | read_file/grep 复用底层读取与检索；工具契约参与 runner 指纹；答案断言 grader | 删除重复 rg 解析路径；移除会隐瞒截断的单文件命中限制；批量调用展开进入原有配额和授权检查 |
| P4 | Git 历史/对象、知识读取/搜索、网页读取/搜索、宿主批准的连接器读取 | Git 禁外部处理器与环境覆盖；隔离环境不执行宿主 Git；网页逐跳检查与固定 DNS；连接器 revision、账户和只读策略再次校验；跨账户来源不合并 |

## 实际接口

新增 `data_batch`，最多 8 个独立操作。具备任一底层数据工具权限的普通 agent 或 coder 均可使用；没有研究模式和意图分类器。原工具适用于单项、依赖前一步结果以及不支持的来源操作。

```json
{
  "operations": [
    { "id": "notes", "kind": "file_read", "path": "notes/meeting.md", "startLine": 1, "maxLines": 120 },
    { "id": "references", "kind": "file_search", "paths": ["docs"], "patterns": ["release", "deadline"], "literal": true }
  ]
}
```

| kind | 主要参数 | 原权限 |
| --- | --- | --- |
| file_read | path、startLine、maxLines | read_file |
| file_search | paths、patterns、literal、glob、ignoreCase、contextLines | grep |
| git_recent | paths、since、until | exec_command |
| git_read | path、commit（对象 hash） | exec_command + read_file |
| knowledge_search / knowledge_get | query / knowledgeId | 同名工具 |
| web_search / web_fetch | query / url | 同名工具 |
| external_read | toolRef、revision、arguments | xopc_tool_execute + 宿主 batchRead 契约 |

连接器必须先 describe 获取当前契约。Composio 仅开放宿主维护的小型只读 action 集合，必须明确 `xopcAccountId`；MCP 的 readOnlyHint 不能自行获得批量资格。所有操作仍经过原授权钩子；外层授权拒绝可阻止整个批次，执行中的单项失败独立返回。搜索按 path × pattern 计入原工具额度，额度检查有意保守。

结果区分 `sourceExhausted`（本次查询来源扫描结束）和 `outputOmitted`（正文被省略）。它们都不代表对整个问题的调研已完整。读取返回范围、内容 hash、时间和续读位置；远端结果无可信版本时不伪造版本。外部契约 revision 代表契约版本，不是数据快照版本。

## 边界与简化

- 每批并发 4、共享调度器全局 8、每资源 4；整批 15 秒、单操作 5 秒。原文件读取和 rg 使用同一调度器；原知识/网页/连接器单工具继续使用自己的执行路径，其并发不计入这个共享数据调度器。
- 单文件最多 10 MiB、批内文件最多 32 MiB；每批片段缓冲受 256 KiB 限制；模型输出最多 12000 字符且不超过 32768 字节，live context guard 进一步缩减时仍保持结构有效。
- 相同文件共享一次批内读取，输出证据去重；相同搜索仍独立执行。没有跨批缓存、后台预读、依赖 DAG 或持久化证据数据库。
- 不做批次整体自动重试，也没有另建局部重试框架。失败项由 agent 根据具体状态决定是否重新请求。
- Git 仅固定只读 argv，历史从 HEAD 可达范围读取，最多 20 条；不 fetch。Docker 命令隔离时使用现有 exec_command 路径，批量 Git 返回 denied。
- 本地读取检测读取期间的文件变化；整个批次不提供多文件事务快照。外部取消只停止客户端等待，未响应取消的 provider 占用的调度许可保留到请求真正结束。
- 禁用入口使用现有工具 deny 配置；共享实现需要回退时回滚代码版本。没有保留双套 collector、旧行为开关或 legacy 兼容执行分支。
- 保留单条工具是产品能力，不属于 legacy；没有新增 API、UI、配置层级或数据库表。

## 验证

- 全量 `pnpm test`：1241 个文件通过，3 个跳过；7047 个测试通过，12 个跳过。
- 最后边界修复后，批量/调度器/授权定向回归：20 个测试通过。
- `pnpm run eval:coder:check`：类型检查通过，21 个测试通过。
- 根 TypeScript 检查、Node 构建通过；修改的源码 ESLint 无错误；`git diff --check` 通过。
- 真实 AgentSession 的脚本模型集成覆盖批量结果进入模型上下文；它验证 runtime 接线，不衡量真实模型能力。

本地基准运行方式：`pnpm exec tsx scripts/bench-data-acquisition.ts`。8 个小文本文件，预热 1 次、计时 5 次，保留全部目标证据。批量工具调用从 8 次变为 1 次，独立文件的来源读取仍为 8 次；结构化元数据会增加短文本的输出成本。该微基准不能证明模型轮次下降，也不能证明普通场景质量不退化。

本机一次安静运行的结果（热文件缓存，未控制操作系统缓存）：

| 方式 | 中位耗时 | 输出字符 | 工具调用 |
| --- | --- | --- | --- |
| 顺序原工具 | 3.03 ms | 863 | 8 |
| 并行原工具 | 2.85 ms | 863 | 8 |
| data_batch | 2.83 ms | 6115 | 1 |

该规模下并行与批量的耗时接近，不能宣称批量获得显著性能优势；主要可确认收益是调用合并与可追溯结果，短文本的元数据成本则明显更高。

真实模型评测入口见 [评测说明](../../../evals/coder/suites/data-acquisition/README.md)。现有 4 个用例是 smoke 集：纪要汇总、单文档、代码注册链路、无需工具的翻译。真实模型的多次 A/B/C 对照、覆盖率、token 成本及配对区间尚未运行，设计中的 20%–40% 提速和质量门槛尚未验收。代码交付完成不等于效果验收完成。
