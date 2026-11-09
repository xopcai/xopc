# 长期观察会话 A+B+C 实施记录

日期：2026-11-08。关联：[技术方案](./long-term-observation-implementation-plan.md)。

## 已实现主链

工作台「交给我」显式开启 → SQLite 观察会话 → 增量读取授权私人会话及任务回执 → 有界历史/反馈/上次理解 → HomeIntelligence 有预算的建议分析 → 卡内反馈与范围确认 → 私人分析试做 Task → 原有 Task 验收面板 → 回执重新进入同一观察主题。

没有新增第二个调度器或模型循环。HomeIntelligenceHost 的 5 秒 tick 只推进摄取和队列；普通增量在 60 秒无新摄取后合并分析。显式开启、反馈和原有手动刷新可以立即入队。模型调用继续使用 home.generate_advice 的既有调用/token 预算与本地处理策略。

## 实现位置

- `src/home-intelligence/observation.ts`：持久身份、独立游标、去重、主题、反馈、观察日志、Task 回链和来源访问控制。
- `src/home-intelligence/host.ts`：有界上下文、原有生成租约/预算复用、修订检查、私人试做、可复用讨论会话。
- `src/storage/sqlite/upgrades/272_home_observation.sql` 与 fresh schema：新表，保持原有升级链和最低支持版本。
- `packages/gateway-contract/src/observation.ts`：状态、反馈范围、控制与试做请求校验；HomeResponse 增加可选 observation。
- `src/gateway/hono/routes/home.ts`：观察命令、试做、讨论及 Home 投影，复用认证与 lazy home bundle。
- `web/src/features/tasks/home-observation-card.tsx`：观察状态、反馈、日志、讨论、试做、结果验收、暂停/恢复和忘记。

## 生命周期语义

- 观察默认未开启；首次可回看 0–30 天。使用稳定 session id，源 transcript 各自保存 seq，不影响 memory-learning 的进度。
- 通知不是可靠性前提，权威 SQLite 行能够恢复遗漏。重放来源不重复积累；运行结果不会作为独立用户需求计数。
- 新反馈确定性持久化，模型仅负责解释。仅本次不进入长期反馈上下文，第一次后续试做使用后不重复推广。当前项目反馈仅作用于同项目约束。
- 普通聊天中的补充作为来源证据；要形成有确定作用域的长期要求，应使用卡片反馈。模型的推测仍保留为上次理解，不作为明确授权。
- 暂停观察停止新增分析，不停止已有 Task/Automation；恢复可补看或用明确 seq 边界跳过暂停区间。
- 撤回反馈会失效相关旧理解和建议；忘记还会清理派生记录、关联建议缓存和讨论上下文，并排除相同来源主题。原始用户记录、独立任务与现有自动化保留。
- 模型返回前后检查 observation revision、来源上下文和 Home enabled；旧结果不能在暂停/撤回/忘记后提交。
- 试做仅接受属于该主题、当前修订已分析且能力就绪的 analysis 建议；创建 Task 时加入私人草稿和反馈约束。重复操作、包括不同请求键重试同一建议，复用同一个 Task。
- 不通过仅本次反馈或一次试做自动创建长期定时任务。D/E 的 routine 执行器和方法版本采用尚未实施。

## 第一版边界

主题以来源会话持久归组，展开讨论关联回原主题；模型可以结合多个主题证据提出建议，但没有自动合并跨会话语义相似主题。忘记的排除粒度也是来源主题，并非对任意新会话做语义封禁。

输入/投影有界：每批最多 100 个源 transcript，每源 40 行；最多 20 个可见主题，每主题 20 条近期日志、40 条反馈、10 个试做。模型读取最多 40 条来源片段、40 条有效长期反馈和 10 条上次理解。历史仍保存在 SQLite；更大规模的分页、检索和保留期管理是后续扩展，不能把当前有限窗口表述为全量无限记忆。

本轮不把观察反馈自动晋升为全局 user-model assertion，也不修改 live Skill 文件。结构化反馈与工作流理解在观察域内维护，避免未经确认的全局习惯推断。

## 验证证据

- 观察存储与 Host 测试：恢复与去重、on-disk close/reopen、作用域、撤回、忘记、权限撤回、敏感文本、幂等与 CAS、暂停时 in-flight 结果失效、模型上下文、Task 约束、结果回链。
- 真实 localhost HTTP listener：使用 createHonoApp 的认证和 lazy bundles，覆盖 401/400/409、开启、反馈、Home 快照、试做幂等、稳定讨论会话与讨论内容回流。
- React 组件：显式 opt-in、默认仅本次、冲突时保留输入、恢复补看范围、忘记的独立确认。
- 现有 HomeIntelligence 回归与 gateway-contract Home schema 测试。
- 所有受支持的历史 schema 起点升级至 v272（包含 v217 consolidated baseline），完整性和外键检查。

集成测试使用受控模型输出与任务回执，不等同真实模型质量评估或真实私人工作数据上的端到端验收。生产环境仍需要已配置、符合 processingPolicy 的模型，并由用户显式开启观察。
