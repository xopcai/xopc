# 记忆学习与召回实施记录

日期：2026-10-11。对应[技术方案](./memory-learning-and-retrieval.md)。实现位于当前工作树；本次未提交 Git commit，也未迁移或重启本机正在使用的 Gateway。

## 已交付行为

1. **持续学习对话。** 成功的对话轮次留下持久化任务；后台也从 SQLite 权威记录恢复遗漏的通知。近期 30 天、有主人身份且非 temporary 的私聊进入补处理。达到原有轮数阈值或空闲 60 秒后执行；不再依赖 Agent 实例的内存计数和压缩发生。
2. **分开提取画像与工作知识。** 单次解释器调用同时返回两类候选，分别校验证据和写入政策。混合对话中的画像、目标及协作规则可逐条分类意图；工具和助手文本不能成为主人明确指令的证据。决策、原因、经验、承诺和问题按真实 workspace/project/session 保存。助手单独陈述保持 tentative。
4. **对授权资料持续索引和学习。** 原文索引、授权分块和派生知识分开存储。同步分批结束后，后台继续处理 pending/过期租约，避免大目录只索引前 200 项。源知识学习任务持久化，并绑定原文版本、授权 receipt、Agent、workspace 和配置版本。
5. **中文与长文件检索。** FTS5 索引保留英语词并补充汉字单字及二字组合；文件按约 2400 字符、150 字符重叠分块，检索可以覆盖原来 8000 字符之后的内容。大目录按页续读；达到单次同步 20 页上限会保存游标，等待下次同步继续。mtime 不再阻止 hash 更新。
6. **统一来源使用政策。** 工作知识的搜索、读取、自动上下文、项目上下文和语音入口都检查 scope、时效、可靠性、敏感度、授权、Agent 范围和源内容 hash。连接器生成的画像也检查授权和不可变证据版本。外部来源报告可以辅助回答，不能提供行动授权。
7. **纠错和删除。** 记录替换保留修订；用户纠错受保护，自动提取不能覆盖主人确认内容。相反决策自动候选被拒绝。删除继续使用既有 suppression，并清理修订、证据关系和相关审计；删除原文索引也取消其分块学习。重建不会解除 suppression。
8. **上下文与诊断。** “继续、上次、进度”等问题补充近期工作线索；规则、画像、目标、优先级、知识和外部资料分配独立上下文份额，并借用剩余空间。预算按实际渲染字符计算。用户理解页面显示索引、工作记忆和学习任务状态；展开工作记忆可检查来源证据。需要本地模型的任务会显示原因。

## 数据和运行机制

schema v245 新增或扩展：

- `knowledge_items` 的 `claim_mode`、`verification`、`sensitivity`。
- `knowledge_revisions`、`knowledge_evidence_links`，以及画像证据关系的源 hash 快照。
- `owner_identity_bindings`。
- 对话 `memory_learning_jobs/cursors`、资料 `memory_source_learning_jobs`、任务回执 `memory_learning_receipts`。
- `knowledge_source_chunks`、`knowledge_chunks_fts`、`knowledge_search_fts`。知识读取切换至新索引后删除旧 `knowledge_items_fts`；不持续维护两套知识索引。

worker 每 10 秒检查一次任务。对话和资料任务使用 180 秒租约、30 秒续租，最多 3 次尝试。模型结果、记忆写入、输出审计和游标推进在同一 SQLite 事务内提交，并验证当前租约。事务失败不推进进度；租约被接管的旧 worker 不能写入。配置或 Agent catalog revision 变化使旧任务失效。

对话重建从当前 active transcript 的开头重新提取，按预算分批续处理，不清空既有记忆和删除抑制。正常增量任务也会在未读完目标范围时原子地排入下一批。

历史 untrusted/candidate 工作总结仅在原来源仍保留、版本匹配且有现行授权时补证据和准入。只有旧总结而没有原来源的记录不被直接升级。

## 启用和配置

部署此工作树构建并启动 Gateway 后自动执行 v245 迁移和后台恢复。测试仅使用临时或内存数据库；本次未修改真实 `~/.xopc` 数据。

继续使用 `userContext.enabled`、`userModel.writePolicy`、`knowledgeMemory.writePolicy`、readScopes 和 contentSources 控制学习及读取。新增可选参数：

```json
{
  "userContext": {
    "knowledgeMemory": {
      "learning": {
        "idleFlushMs": 60000,
        "maxBatchChars": 30000,
        "maxDailyBatches": 100
      }
    }
  }
}
```

这个片段需合并至现有配置。每日预算以 UTC 日界计算，统计对话和资料模型提取尝试；不把确定性的索引和任务回执消费计为模型调用。

本地文件属于 `local_import`；其派生工作记忆还要求 `memory`。连接器原文要求 `connector`，连接器派生记忆同时要求 `connector` 和 `memory`。默认配置仍未开启 connector 读取，不能用新增学习机制自动扩大来源权限。

已安装并启用的本地文件连接器只为所选根目录创建工作辅助授权，默认仅允许该 Agent、`local_only`、365 天原文保留。根目录用 realpath 固定，变更目录或 Agent 不自动扩大旧授权；已撤销授权不自动恢复。授权字段过滤先于分块持久化和模型读取，格式损坏的连接器 JSON 不能降级为未过滤正文。敏感凭据和受管制数据不进入工作知识。

资料原文保留按 receipt/来源设置执行，后台每小时清理 bounded 原文、分块、原文索引及其修订和证据摘录；期限清理不创建用户删除 suppression。原文失效或清理后，仅由它支持且无法继续核验的知识停止用于回答。本地文本文件上限仍为 2 MiB，超限有同步警告；当前支持 md/mdx/txt/json/yaml/yml/csv/tsv，不增加 PDF/OCR/二进制文档解析器。

为 Agent 的 `understanding` intent 配置所需模型；没有该 intent 时使用该 Agent 的 chat primary。`local_only` 资料仅发送至 localhost/127.0.0.1/IPv6 loopback，不能仅因 provider 名称为 ollama 就视作本地。没有本地模型时仍可进行授权原文索引，但语义学习任务报告 `local_model_required`；配置更新后重新排队。

渠道私聊必须显式绑定主人，Web/CLI/TUI 沿用宿主本机身份。群聊、未绑定私聊和 temporary 会话不进入共享学习。

## Gateway 接口

全部经过既有 Gateway 认证和 lazy-bundle dispatch，写接口采用严格限流：

| 接口 | 用途 |
| --- | --- |
| `GET /api/memory-learning/status` | 当前配置版本的队列状态及知识覆盖统计 |
| `GET /api/memory-learning/jobs/:id` | 对话学习任务状态、尝试次数及原因 |
| `POST /api/memory-learning/rebuild` | `{ "conversationId": "..." }`，从当前 transcript 开头重建 |
| `GET /api/memory-learning/owner-identities` | 当前主人绑定列表 |
| `POST /api/memory-learning/owner-identities` | `{ "channel": "telegram", "accountId": "...", "peerId": "..." }` |
| `DELETE /api/memory-learning/owner-identities` | 同样字段，解除绑定 |
| `GET /api/knowledge-memory/:id/evidence` | 符合使用政策的证据摘要；不可用时返回原因 |

重建使用持久化会话 workspace override 或实际 Agent workspace，而不是任意全局工作目录。证据接口用于检查，不提供模型执行权限。

## 验证及边界

已覆盖真实 SQLite 的迁移、学习任务、租约恢复、事务回滚、空闲恢复、分批续处理、重建去重、删除抑制、身份绑定和撤销；授权字段过滤、local_only 阻断、模型处理中撤销、原文版本变化；长文件尾部中文检索、目录分页，以及画像证据快照。Gateway 测试通过真实 localhost HTTP、认证和 lazy dispatch，不只调用单个 route handler。

另执行后端单测、前端测试、根目录及 Web 类型检查、修改模块 ESLint 和 Web 生产构建。具体本轮结果由交付消息列出；构建中的现有 chunk size/dynamic import 提示不代表构建失败。

真实模型的工作知识质量、固定数据集 Recall/Precision 和 10k 知识/100k 分块性能门槛尚未测定。P3 向量及 rerank 按原方案保留为效果评测后的可选增强。不能把 mock 模型集成测试或条目增多解释为这些效果门槛已经通过。

超出单条对话 batch 字符上限的完整消息当前不会成为新支持证据；任务执行回执和文件分块提供独立入口。资料断言缺少原始可校验版本时保守停用。历史归档 transcript 不被一次 rebuild 自动全部纳入。
