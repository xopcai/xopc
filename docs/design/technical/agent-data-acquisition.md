# Agent 数据获取与调研效率优化

- 日期：2026-09-20
- 状态：P0–P4 运行时代码与确定性验证已落地；真实模型效果验收待测
- 实施差异与验证记录：[实施记录](./agent-data-acquisition-implementation.md)，以该记录和源码为当前行为依据
- 源码核查基线：`b4b6f80dd`
- 适用范围：普通问答、文件与文档分析、项目研究、代码调研；后续扩展到知识与连接器数据
- 替代方案：`repository-research-acceleration.md` 中的仓库专用模式与激活门控不再实施

## 1. 目标与核心决策

让 agent 用更少的模型往返获取足够、可追溯的数据。批量读取、独立查询并行、结果去重、输出预算和完整性提示作为通用基础能力，不区分 coder 与普通 agent，不要求进入“调研模式”。

首期增加一个通用工具 `data_batch`，支持本地文件读取与内容搜索；文本资料和源码使用同一实现。内部建设可复用的数据操作执行层，既供批量入口调用，也逐步供原有工具复用。Git、知识库、网页和连接器作为独立数据源适配，不一次纳入 MVP。

保留单条读取和查询入口。单文件、小问题不必批量；有依赖的操作继续分步。底层不新增 LLM Planner，不自动扩大查询范围，不自行生成最终结论。

不建设：repository-research 模式、用户意图分类器、额外 agent loop、自动任务分派、通用任意工具批执行器、全局证据矩阵要求。

发布验证覆盖所有受影响场景：批量任务效率提升，简单任务成本合理，信息覆盖和答案质量不退化。代码调研是首个复杂验证场景，不是唯一获益对象。

## 2. 当前实现与实际缺口

| 核查位置 | 已有基础 | 本方案处理 |
| --- | --- | --- |
| `src/agent/tools/read.ts` | offset/limit、最大文件体积、安全检查；支持并行标记 | 抽出安全读取核心，增加批内文件读取复用；现有实现读取全文件再切片，不能声称已减少磁盘读取 |
| `src/agent/tools/grep.ts` | 单 pattern/path/glob、context、截断提示 | 新批量搜索按查询和文件分配预算，保留旧入口 |
| `src/agent/tools/repository-search.ts` | 原生 rg、环境清理、文件策略、10 秒超时、约 50 KB 原始 JSON 上限 | 增加流式事件消费，区分原始数据预算与最终证据预算 |
| `src/agent/tools/concurrency.ts` | 只读工具可无锁运行，其他工具使用 exclusive 队列 | 新增数据操作共享限流；现有队列不是读写锁或一致性快照，不据此承诺读写隔离 |
| `src/agent/tools/executor.ts` | 超时、取消、幂等重试、工具耗时 | 批内独立状态和重试，防止整批重试重复已完成请求 |
| `src/agent/tools/metadata.ts` | supportsParallel、idempotent、mutationScope | 增加由宿主定义的数据获取属性；不从缺省 metadata 推断外部操作可并行 |
| `src/agent/external-tools/service.ts` | search 已对 provider 并行，describe 循环读取，execute 校验契约 | 不重建外部搜索服务；后续优化受限并发与接入只读适配 |
| `src/agent/external-tools/types.ts` | descriptor 有输入 schema，但无明确可信的只读、缓存和并发策略 | 连接器批处理前先补可信策略与权限校验 |
| `src/agent/embedded/tool-result-truncation.ts` | live 工具结果默认上限 16,000 字符，受上下文保护影响 | 结构化预算必须与最终模型可见预算协调，避免二次截断损坏完整性声明 |
| `src/agent/coding/repository-instructions.ts` | 识别 read_file、exec 等工具路径，加载 AGENTS.md | 批量路径接入同一目录指令机制 |
| `src/agent/context/project-context.ts` | 按项目注入知识，普通条目约 240 字符摘要 | 后续提供按需知识读取；不靠无限扩大预注入提速 |
| `evals/coder/` | 黑盒 adapter、轨迹、隐藏评分和版本对比 | 扩展数据获取及普通任务评测 |

当前 runtime 已有同一模型消息内并行执行多个工具的基础。必须先测“模型是否发出独立并行调用”，不能把所有串行现象归因于工具不支持并行。本次代码发现没有可调用的图 MCP，使用文件检索回退。

## 3. 架构与边界

```text
用户请求
   |
现有 agent loop：决定要读取/检索哪些数据
   |
   +-- 原有单条工具 ------------------+
   |                                  |
   +-- data_batch：一组独立操作 --------+
                                      |
                          DataAcquisitionService
                参数校验 / 权限 / 调度 / 预算 / 部分失败
                                      |
              +-----------------------+--------------------+
              |                       |                    |
         LocalFileAdapter         GitAdapter          其他适配器
           MVP                    后续阶段         知识/网页/连接器
              |                       |                    |
              +---------- 结果片段、来源、范围与状态 ---------+
                                      |
                       去重、分组、最终预算渲染
                                      |
                            主 agent 判断与回答
```

DataAcquisitionService 不是授权或工具执行的新入口。adapter 必须复用既有资源权限、连接绑定和外部契约检查；权限不可用时该子操作返回 denied。普通 agent 与 coder 的区别来自原有工具政策和实际数据源，不来自新的场景隔离。

MVP 工具工厂仅在原有文件读取或搜索权限可用时提供 `data_batch`。read/search 操作分别映射到现有读取/搜索权限，工具本身允许不等于所有子操作允许。workflow/child allowlist 仍取交集；新增工具不自动扩展父任务授权。

## 4. 模型可见接口

### 4.1 为什么采用一个新入口

MVP 仅增加 `data_batch`，不再同时增加 read_slices、repo_research、repo_grep_grouped 等重叠工具。相比直接扩展 `read_file` 为复杂 union，新入口不破坏其已存在的单路径参数与 profile 文件回退语义。

工具简短描述：一次读取或搜索多个相互独立的数据项；指定路径与范围，结果保留各项状态和来源。单项操作可使用原有工具，依赖前一个结果的查询应下一轮提交。

工具不接受自然语言 objective，不接受任意 toolName、shell 或 root，不允许在 operation 内引用另一个 operation 的结果。后续有真实需求再评审依赖图，MVP 不建设 DAG 引擎。

```ts
type LocalDataOperation =
  | {
      id: string;
      kind: 'file_read';
      path: string;
      startLine?: number;
      maxLines?: number;
    }
  | {
      id: string;
      kind: 'file_search';
      paths: string[];
      patterns: string[];
      literal?: boolean;
      ignoreCase?: boolean;
      glob?: string;
      contextLines?: number;
    };

type DataBatchArgs = { operations: LocalDataOperation[] };
```

生产接口用 TypeBox discriminated union，限制唯一 id、路径/正则长度、数组大小和整数范围，拒绝未知参数。file_search 的 patterns 是 OR 语义；需要区分查询证据时使用不同 operation，不把多个模式误描述为 AND。相对路径基于当前已授权 workspace，绝对路径按现有文件政策处理，不额外放宽访问。

MVP 只处理文本文件；PDF、图片、音视频、Office 文件仍使用已有媒体/文档能力，不把二进制解码成文本。格式解析适配器属于后续扩展。

### 4.2 使用示例

普通任务“比较三份会议纪要的待办”：

```json
{
  "operations": [
    { "id": "meeting-a", "kind": "file_read", "path": "notes/a.md", "maxLines": 120 },
    { "id": "meeting-b", "kind": "file_read", "path": "notes/b.md", "maxLines": 120 },
    { "id": "meeting-c", "kind": "file_read", "path": "notes/c.md", "maxLines": 120 }
  ]
}
```

代码任务“查看路由和前端调用位置”：同一工具提交两个限定目录的 file_search。匹配得到具体文件后，在下一轮提交 file_read。普通文本资料不要求先执行 Git、寻找 migrations 或建立代码状态矩阵。

## 5. 统一结果协议

```ts
type OperationStatus = 'ok' | 'partial' | 'error' | 'denied' | 'cancelled';
type DataFragment = {
  id: string;
  operationIds: string[];
  source: { kind: string; resource: string; revision?: string; capturedAt: string };
  locator?: { startLine?: number; endLine?: number; page?: number; recordId?: string };
  text: string;
};

type DataBatchResult = {
  schemaVersion: 1;
  operations: Array<{
    id: string;
    status: OperationStatus;
    fragmentIds: string[];
    completeness: {
      scope: string;
      sourceExhausted: boolean;
      outputOmitted: boolean;
      reason?: 'output_budget' | 'scan_budget' | 'timeout' | 'changed' | 'unsupported' | 'aborted';
    };
    next?: { kind: 'file_read'; path: string; startLine: number; maxLines: number };
    errorCode?: string;
  }>;
  fragments: DataFragment[];
};
```

设计语义：

- ok 表示请求范围内成功，不代表整份文件或整个数据源已读完。scope 必须包含实际查询路径、过滤条件或读取区间。
- sourceExhausted 表示该范围已扫描完成；outputOmitted 表示有证据未展示，两者独立。不得从中途停止得到精确总命中数。
- 多个请求命中相同片段时正文存一次，operationIds 保留来源对应。不同资源的相同文字不默认合并，避免抹掉证据来源与出现次数。
- read continuation 返回明确行区间；搜索达到扫描上限时提示缩小路径/模式，MVP 不伪造可完整续页的 offset。后续远端分页透传绑定查询和账号的 opaque cursor。
- metadata 放 details，模型正文为紧凑可读格式，列出所有 operation 的状态和对应证据；不在正文和 details 中重复整个大 payload。
- 不在 adapter 内生成“已经实现”“项目延期”等语义结论。数据可能彼此矛盾，保留片段和版本，由主 agent 判断。

## 6. 执行、并行与重试

### 6.1 执行顺序

每批：schema 校验 → 为每项解析权限与资源 → 加载适用目录指令 → 按可信属性去重 → 有界并发执行 → 归一化片段 → 公平分配输出预算 → 返回各项状态。

整个参数结构非法时不执行任何子操作。有效批次中单项权限不足、路径不存在或数据源失败时，其他独立项继续。取消优先于重试和新任务出队。

### 6.2 独立并行

只对 host 确认的无业务写入、无顺序依赖、允许并行的 adapter 操作并行。不从 read/get 名称推断；MCP readOnlyHint 只作为线索，不能直接成为调度授权。若读取邮件会标为已读，必须使用明确的 peek 模式或保持原操作流程。

现有 `supportsParallel` 与 `idempotent` 含义分开：可并行不等于可重试，可重试不等于结果稳定可缓存。外部 metadata 缺失时不接入批量入口。

MVP 使用共享 scheduler，以进程、workspace/data source 为单位限流，不能每个 batch 独立创建限流器而使总并发失控。旧工具接入服务后共享同一配额；wrapper 与 adapter 只获取一次执行 permit，防止嵌套限流死锁。排队时间计入 deadline。

不自动跨模型轮次收集工具调用，不隐式延迟一个单项请求等待凑批，不把有依赖的读/写组合并行化。现有 agent loop 对混合工具的顺序问题单独评估，MVP 不重写全局调度器。

### 6.3 超时与取消

每项和整批有独立 deadline，取较早者。完成项保留；超时项标 partial/error，取消项标 cancelled。外层 `data_batch` 关闭整批自动重试；局部瞬态失败仅在 adapter 明确 retrySafe 时重试，且不得超过整批 deadline。

本地 AbortSignal 传到文件读取和 rg/Git 子进程，停止排队、终止进程并等待回收。远端取消只能表示客户端已停止等待，不能声称撤销了服务端执行；因此 MVP 不接入具有外部业务副作用的操作。

### 6.4 一致性

批量读取默认 best-effort，不提供跨文件、跨数据源原子快照。记录来源版本和读取时间；文件读前/读后版本变化时标 changed。Git commit blob 可按不可变对象读取；dirty worktree 不能仅以 HEAD 代表版本。

批次内相同文件的多个区间尽可能只读一次，得到同一份内容。不同轮次不因“刚刚读过”跳过读取；用户编辑文件或外部数据变化后应重新取数。

## 7. 结果预算与搜索质量

### 7.1 初始预算

数值是待评测的默认值，不是已证明的最优配置。

| 项目 | MVP 默认上限 |
| --- | --- |
| 每批操作数 | 8 |
| 单 search 路径 / 模式 | 各 8 |
| 每批并发 / 每 workspace 并发 | 4 / 4 |
| 全进程数据操作并发 | 8 |
| 单 read 行数 | 默认 120，最大 500，继续受文件与正文预算约束 |
| search context | 默认 2 行，最大 10 行 |
| 单文件展示片段 | 3 个，合并重叠区间 |
| 原始 search 输出 | 每项 1 MiB、每批 4 MiB，达到上限显式 partial |
| 单文件 / 批内读取数据量 | 10 MiB / 32 MiB，沿用文件安全检查；去重文件只计一次 |
| 聚合 fragment 缓冲 | 每批 256 KiB，不缓冲全部原始搜索结果 |
| 单项 / 整批 deadline | 本地 5 秒 / 15 秒，包含排队 |
| 模型正文预算 | 默认最多 12,000 字符且不超过 32 KiB UTF-8，预留状态与来源空间 |

32 KiB 字节限制用于资源保护；12,000 字符限制与当前 16,000 字符 live guard 留出余量，两者不能互相等价换算。最终还受模型上下文可用预算影响，使用更小值。

### 7.2 分配方式

先给每个 operation 保留状态和最少证据份额，再按查询/文件轮转分配剩余片段；不让首个噪声文件耗尽整个批次预算。来源路径、范围、截断和错误状态优先于正文，不能为多留一行正文隐藏失败项。

rg 使用流式 JSON 解析，消费 match/context 事件，尽早进行权限过滤、重叠合并和有界保留。保留实际观察到的数量，但扫描中断时不报告完整命中总数。不自动根据源码或文档类别丢弃结果，权重来自用户/模型给定路径和查询。

首期保持旧 `grep` 展示契约不变；新流式 collector 先供 data_batch 使用。公共进程/权限组件可以复用，旧工具切换 collector 必须独立验证排序、空结果和截断行为。

### 7.3 与下游截断协调

为 batch 结果提供结构化预算渲染器，执行层传递可用输出上限；进入 live context guard 时若仍需缩减，按 fragment 边界重新渲染，更新 outputOmitted，保留每项状态。不得直接截 JSON 或保留“完整”声明后再砍掉正文。

旧工具继续走已有文本 guard，未知外部结果不直接套用结构化渲染。所有入口包括重放、compaction 前后的模型视图都需测试；持久化继续走现有 SQLite transcript 写入路径，不新增 turn-end save 或双份全文存储。

## 8. 去重与缓存

MVP 只做批次内去重与读取复用，不做跨用户、跨会话或持久化结果缓存，避免把“缓存命中”误当作实时事实。

去重键至少包含 principal/权限范围、workspace 或 connection、adapter、资源、规范化参数、已知版本；每个原始操作都先完成授权检查。不得跨账户共享 in-flight 结果。

file_read 的相同文件可共享一次读取，但保留各自区间；完全相同 search 可复用，多个不同查询不会未经证明被改写合并。同一资源相邻片段可合并，资源不同则保留来源。

后续只有 adapter 具备可信 version/ETag/不可变对象语义时才考虑跨批缓存。写入和权限撤销需要失效；仅有 TTL 不足以保证数据新鲜度。缓存是单独灰度项，不与 MVP 绑定。

## 9. 数据源适配与任务策略

### 9.1 本地文件：首期

复用 `checkedFilePath`、`readWorkspaceFile`、`checkFileSafety` 和搜索文件过滤；保留敏感文件、符号链接、硬链接、文件体积等限制。抽出安全读取核心时必须保持原 read_file 行号、错误和 profile Markdown 回退行为；批量入口只处理明确数据路径，不提供隐式 profile 回退。

批量 read 在执行前枚举路径并调用 RepositoryInstructions。search 先解析已知搜索根的目录指令，发现更深层 AGENTS.md 时收集并遵循：如果新增指令会改变检索方法，应暂停对应扩展/读取并将指令交回当前 agent，再继续。不能默默绕过目录指令，也不为普通资料全盘寻找 AGENTS.md。

### 9.2 Git：后续可选适配

Git 提供 recent/show 等固定只读操作；不把任意 exec_command 包装成批量读。默认 HEAD 可达历史，支持显式时间与路径，提交消息关键词只是筛选条件；不默认 `--all`、fetch 或切分支。

固定 argv，禁用外部 diff/textconv/pager，清理 Git 环境覆盖；当前路径与历史文件均执行政策检查。无 Git、浅历史、submodule 或多根工作区返回范围限制，不越界扫描。仅绑定仓库并允许相应操作时在工具契约中提供 Git 变体，无需用户进入模式；工具 schema 随实际数据源可用性变化时须纳入缓存失效测试。

### 9.3 知识、网页与连接器：分适配器接入

- 知识：复用 scope/read policy，按需 search/get；项目入口信息属于知识条目，校验新鲜度，不独立建设 Landmarks 产品。
- 网页：沿用 URL 安全、重定向检查、响应体限制和站点限流；不在普通请求中预抓取网页。
- 连接器：通过既有 ExternalToolService 执行，保留 toolRef、revision、输入校验和连接/账号绑定；批量不能绕过契约确认或授权。
- provider 的只读/并发/重试属性由宿主维护的适配声明验证，MCP hint 不能直接升级权限。未知操作继续使用原单工具执行。
- 429 按 provider 策略退避并纳入 deadline；按 provider+connection 限流。分页明确返回 cursor 和不完整性，不自动拉完整邮箱或云盘。
- 新增 adapter 属性影响执行语义时，需要同步纳入外部 descriptor revision；当前 revision 只覆盖 toolRef、description、inputSchema，不能遗漏策略变化。

每个适配器需给出 operation union 与数据源特有参数。模型 schema 只包含实际支持且可授权的数据源，不暴露一个 `arguments: any` 的任意执行后门。

### 9.4 策略保持轻量

通用工具提示只增加短规则：独立数据可批量，有依赖则分步；先少量定位再读细节；结果不完整时继续查询或说明范围；不为单项任务强制规划或矩阵。

仓库任务可使用 Git、符号/调用图、注册入口以及实现/暴露/验证三维状态；会议纪要使用日期、决策、行动项和出处；邮箱分析使用账号、时间范围和分页状态。策略来自任务和相应 skill/工具说明，不建立全局强制流水线。

## 10. 接入、兼容与配置

建议新增模块：

```text
src/agent/data-acquisition/
  types.ts
  service.ts
  scheduler.ts
  budget.ts
  render.ts
  adapters/localFiles.ts
src/agent/tools/dataBatch.ts
```

修改 factory/index/metadata 注册批量工具；调用同一权限组件，传递 workspace、principal、runId、toolCallId 与 AbortSignal。通过当前工具 policy 控制暴露；不在 agent ID、任务关键词或 session 上设置研究模式。

现有 read_file/grep 首期保留参数和模型可见输出，后续将底层代码逐步迁移到 acquisition service。单条路径直接执行一个操作，不人为增加等待、模型请求或小文件扫描成本。

初期使用工具 deny 配置灰度 data_batch：测试 agent 放行，再推广所有有数据访问权限的 agent。共享底层 collector/读取实现切换另用内部发布开关控制，避免禁用入口后仍无法回退公共改动。资源预算先使用版本化常量，不新增一组永久研究模式配置。

工具 schema 与简短提示变化会影响模型 prompt cache，属于需要测量的正常成本，不要求普通任务 schema 字节不变。保持工具排序稳定；在 runner fingerprint 纳入影响执行的工具契约/策略版本，避免同名工具热更新后复用旧闭包。缓存改造随执行契约变化实施，不新增仓库模式生命周期。

继续使用现有 run、transcript、模型、技能与任务结束机制。MVP 不新增 API、UI 或数据库表；后续若新增 Gateway API，必须补 lazy-bundle matcher 与真实认证路径测试。

## 11. 验证与指标

### 11.1 衡量真正的收益

分别记录 model_requests、tool_calls、data_operations、source_requests；8 个工具包装成 1 个但仍执行 8 次 I/O，只代表接口合并。只有模型往返、关键路径耗时或有效信息成本改善才算提速。

观测包括：端到端耗时、首个有用结论时间、模型输入/输出和 cache tokens、批次排队/执行时间、来源请求数、返回/省略内容量、重复读取、后续补查、超时与取消。并发耗时按时间轴计算，不把子操作 duration 相加冒充总耗时。

来源日志默认只记录有界计数、状态、adapter 与耗时，沿用 runId/toolCallId 关联；路径、用户文本、邮箱内容不作为指标标签，不新增全文日志。first useful conclusion 由 evaluator/人工判断，不由 agent 自报计分。

### 11.2 评测集

复用 evals/coder 基础设施，并扩展普通任务与多轮 adapter/评分：

| 类别 | 建议首轮样本 | 要验证的问题 |
| --- | --- | --- |
| 普通批量任务 | 20 | 多份纪要、方案对比、目录资料总结是否更快且不漏项 |
| 代码调研 | 20 | 实现链路、近期变更、接线缺口是否准确 |
| 简单任务 | 30 | 闲聊、写作、单文件解释是否出现无谓批量/规划和成本增长 |
| 混合与故障任务 | 15 | 取消、权限、部分失败、跨项目、长输出、文件变化 |
| coding-core | 现有套件 | 修复正确率和验证完成率不下降 |

至少 3 次重复，固定模型/思考配置/数据快照，baseline 和 candidate 交错执行；分别报告冷/热缓存、不同任务类别、配对差值与置信区间。初始样本用于筛查，区间不足时追加样本，不能把不显著直接解释为非退化。

对照分三组：A 原工具；B 原工具加“独立调用同轮提交”的短提示；C 通用批量与预算实现。可分辨收益究竟来自策略、调度还是结果结构。

Git 历史评测后续在隔离 fixture 内构造固定日期/分支/重命名/dirty 历史；现有 eval sandbox 会清理原历史，不能直接拿它评估“最近做了什么”。隐藏答案和 grader 不放入 agent 可见工作区。

### 11.3 门槛与预期

| 指标 | 初步门槛 |
| --- | --- |
| 权限/取消/预算/来源映射 | 确定性测试全部通过 |
| 批量任务效率 | P50 总耗时目标下降至少 20%，模型往返目标下降至少 25% |
| 数据质量 | 关键事实覆盖、出处准确性不低于 baseline；不可把 partial 宣称完整 |
| 简单任务 | 额外前置模型调用为 0；不新增自动数据 I/O；P50/P90 延迟与 tokens 增长目标不超过 5% |
| 普通任务质量 | 预注册非退化界限为 -2 个百分点；配对 95% 区间下界通过后才扩大灰度，严重行为回归为 0 |
| 编码任务 | coding-core 完成率和隐藏测试通过率不降低 |

20%–40% 是批量/探索密集任务的实验目标，不是所有请求的承诺。模型推理时间占主导或读取只有一次的任务可能几乎不提速。若效果主要来自短提示，则保留提示优化、缩减工具复杂度。

## 12. 实施与回退

| 阶段 | 交付 | 退出条件 |
| --- | --- | --- |
| P0 基线与小实验 | A/B 提示对照、模型轮次/工具时间观测、普通任务样本 | 明确主要瓶颈和批量工具的增量价值 |
| P1 本地批量 MVP | data_batch、LocalFileAdapter、schema、来源与独立错误 | 文件策略、目录指令、重叠读取、部分失败测试通过 |
| P2 性能与完整性 | 共享 scheduler、流式 collector、公平预算、下游结构化渲染 | 大结果无失控、取消无后台残留、无错误完整性声明 |
| P3 共用与推广 | 原工具底层逐步复用、跨场景评测、全体有权限 agent 灰度 | 简单/普通/代码三类门槛均通过 |
| P4 数据源扩展 | Git 优先，之后知识/网页/可信连接器逐个接入 | 每个 adapter 的权限、契约、限流、分页与正确性验收通过 |

P1–P2 在内部测试闭环后再推广，P4 不阻塞首期交付。暂不估算固定人日，先通过 P0 确认是否值得承担共享底层改造成本。

回退可分别禁用 data_batch、恢复旧 collector、停止新 adapter；不会回滚用户文件或删除 transcript。已运行批次取消后保留已完成结果，原有工具按原权限继续可用。共享代码提取应先保持行为，再单独开启性能变化，确保问题可定位。

最终交付必须附：源码/配置版本、测试与评测结果、三类任务质量及成本、冷/热缓存条件、未解决限制。本文保留设计目标；实际交付范围与未验证指标见实施记录，目标数字不代表实测收益。
