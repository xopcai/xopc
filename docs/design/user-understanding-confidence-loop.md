# 用户上下文：产品与技术设计

> 实现状态（2026-08-22）：结构化 User Context 已落地，旧 Markdown 用户档案及兼容接口已删除。

## 设计原则

1. Agent 身份和项目指令继续使用 Markdown；用户数据不使用 Markdown。
2. SQLite 是用户上下文的唯一事实源，不双写、不生成运行时 Markdown 投影。
3. “用户是谁”“系统如何理解用户”“系统应如何协作”是三个独立领域。
4. 推断必须可审核，使用必须可解释，纠错必须能归因到具体轮次和版本。
5. 先使用确定性规则完成作用域、隐私、授权与预算过滤，再做相关性排序。

## 产品结构

`/you` 只有三个页签：

| 页签 | 用户问题 | 核心操作 |
|---|---|---|
| 个人资料 | “你应如何称呼我？” | 编辑称呼、代词、时区、语言 |
| 对你的理解 | “你认为你了解我什么？” | 查看来源、确认、纠正、否定、删除 |
| 协作约定 | “你应该怎样和我工作？” | 新建、启用、停用、删除规则 |

协作约定是用户明确指令，优先级高于推断理解。待审核内容不会进入模型上下文；需要引用授权的内容必须先获得授权。

## 数据流

```text
用户输入 / 连接器证据
        ↓
候选提取与敏感信息拦截
        ↓
理解版本 + Evidence Link
        ↓
逐轮 Planner
  status → scope → validity → sensitivity → consent → relevance → budget
        ↓
Context Run + Items（完整记录选择与拒绝原因）
        ↓
模型回答
        ↓
用户反馈 / 显式纠错 → 精确归因、暂停或 suppression
```

## 领域与存储

- `user_profiles`：用户直接提供的稳定字段。
- `user_understandings` + `user_understanding_versions`：带生命周期的可版本化理解。
- `collaboration_rules` + `collaboration_rule_revisions`：用户明确制定的协作规则。
- `context_evidence` + `understanding_evidence_links`：来源与证据关系。
- `context_runs` + `context_run_items`：逐轮个性化选择审计。
- `context_feedback`：回答级或对象级反馈。
- `context_consents`：引用授权。
- `context_suppressions`：防止被用户否定的内容反复学习。

已删除 `PROFILE.md` 用户档案、playbook 标签协议、`user_claims` 中间层、旧 consent 表以及泛化 `/api/you/memories` 接口。

## 验收标准

- Profile、Understanding、Collaboration Rule 不可混写。
- archived、rejected、candidate、needs_review、stale 内容不得作为 active 注入。
- workspace、project、session 作用域不得泄漏。
- secret、regulated 内容不得写入理解。
- 每次注入都能通过 turnId 回查内容快照、来源说明和选择理由。
- 用户标记错误后，相关理解立即停止使用并留下 suppression 或 review 状态。
- 运行时不存在 `PROFILE.md` 路径、解析器、启动注入或兼容 API。
