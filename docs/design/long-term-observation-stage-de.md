# 长期观察 D + E：托管执行与方法改进

当前实现沿用工作台卡片、Automation 调度及 Task 执行/验收，不增加一级页面。

## 用户路径

1. 工作台「交给我」查看试做结果与逐项验收。试做当前合同未通过、有活动执行或任务版本过期时，服务端拒绝托管。
2. 展开「确认长期托管」，明确每周执行日、时间、时区、约定到期日，再确认启用。仅本次反馈不进入长期约定。首版限定私人草稿/分析，不自动发送或发布。
3. 托管卡片展示当前方法版本、计划和期限，可独立暂停、恢复、结束及调整时间。暂停观察与暂停托管是两个独立动作；忘记观察主题也不会删除已经确认的自动化。
4. 每个 Automation occurrence 创建独立 Task，结果回到原观察主题。排队/创建 Task 不计作完成；必须得到真实 TaskRun 回执及原合同验收通过才记为成功。缺少当前周期资料应报告缺口。
5. 用户针对结果补充长期反馈后，后台形成追加检查项的候选版本。一次性反馈不会形成候选；项目反馈仅影响该项目，长期同类反馈当前仅影响对应稳定主题，不跨主题泛化。
6. 「先验证改进」创建独立验证 Task，保留原目标和验收项并追加新检查。验证通过后，用户才能选择后续采用；可以保留原方法、查看验证结果、回退到任何曾采用的版本。
7. 自动化列表中的托管项归用户管理。在现有详情中展示同一托管/版本面板和运行历史，可跳转 Task 查看回执。主题被忘记后，仍可从自动化详情管理已有托管。

## 实现连接

- `ObservationRoutines` 使用 SQLite schema v273 的四张表保存约定、不可变方法内容、执行映射及幂等操作；与 Automation 创建/更新、Task 创建共用同步事务。v272 存量观察数据经增量 SQL 保留。
- `HomeIntelligenceHost` 每次后台 tick 检查新增长期反馈，投影到原工作台卡片；继续复用 `home.advisor.updated` 实时刷新。观察暂停后不采集新证据，也不从暂停会话生成方法候选。
- Automation 新增 `routine` action，包含 routineId、version、content hash。入队时沿用已有 request snapshot；采用新版只影响新入队执行，不能改变已排队的版本。
- 执行器重查来源读取资格、约定期限、项目状态、Automation 状态和方法 hash。Task 保留试做的证据引用、固定目标/标准，清空外部输出目的地与 authority grants。每次运行另存合同 hash，修改后的合同不能冒充原方法的成功验收。
- 私人试做、托管及验证 Task 由持久化 Task 身份识别工具边界：允许读取与 `publish_task_result`，禁用 shell、委派、浏览器操作、外部工具发现/MCP/codemode 及写入工具。方法反馈不能扩大能力集。
- 执行器等待根 TaskRun 的最终回执；暂停/结束会禁用未来触发并取消正在运行的 Automation，Abort 后写入 TaskRun 取消回执、请求关闭 Task 并等待关联 Agent 终止；无法确认时沿用 Automation 的 cancellation-unconfirmed 状态，不能将逻辑取消算作实际停止。串行执行、超时、租约/重启处理、失败熔断及注意事项通知复用 AutomationService。自动重试关闭，不宣称外部操作 exactly-once。
- 方法生成目前采用确定性的「追加长期反馈检查项」，不另开模型调用。失败回执回到观察记录供解释和后续反馈使用，失败本身不会未经确认改写方法。原始目标、验收标准、权限和目的地都不会由候选改动。
- 撤回反馈后依赖它的未采用候选无法验证/采用。已确认的方法保持历史约定，调整它需要用户操作版本或暂停托管；不把撤回记忆误当作静默改写运行计划。
- 方法采用要求候选仍对应当前基线、反馈有效、验证 Task 无活动根运行、最新合同回执验收通过，且验证合同 hash 与创建时一致。不能通过修改/减少验证标准来通过采用门槛。

## API

均通过已有鉴权和 `/api/home` lazy bundle；写操作带 revision 与 idempotencyKey。

- `GET /api/home/routines`
- `POST /api/home/routines/adopt`：topicId、trialTaskId、expectedTaskVersion、schedule、validUntil。
- `POST /api/home/routines/:id/command`：pause / resume / end / configure / validate / adopt_method / rollback / reject_method。
- `GET /api/home` 在观察主题下附带 routine 投影。

## 验证与实际边界

覆盖独立周期任务、等待真实回执、失败结果、来源撤权/约定过期、暂停取消、方法验证与回退、排队版本冻结、合同修改防护、一次性反馈排除、前端确认交互、带鉴权 localhost HTTP 和完整历史升级链。执行测试使用受控 TaskRun 验收回执，并未调用真实 LLM 或连接外部业务账户。

本阶段闭环是「观察 → 试做 → 用户确认托管 → 周期执行/验收 → 长期反馈候选 → 验证 → 用户采用/回退」。不包含任意桌面操作学习、跨应用发布授权、模型自身权重训练，或无需用户确认的目标/权限重写。UI 提供每周计划；API 复用 interval / cron / once，周期 interval 下限一分钟，约定期限最长一年。单次验证通过不代表长期效果改善已被统计证实。
