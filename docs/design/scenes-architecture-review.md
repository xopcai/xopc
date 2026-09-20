# 场景系统架构复查

日期：2026-09-20。依据：[最终技术方案](./scenes-technical-design.md)。

复查覆盖场景领域、历史转换、SQLite 初始化与升级、Node/Electron 资源构建、通用通知、Gateway 装配、Agent 工具和 Web 入口。本文区分已经改正的结构问题与尚未完成的产品替换；不把移动目录视为生产切换完成。

## 已执行的调整

| 发现 | 调整 | 验证 |
| --- | --- | --- |
| `src/scenes/schema.sql`、通知 TS 内嵌 DDL、journal 内嵌 DDL 分散 | 全部收进 `src/storage/sqlite/migrations/scenes/`；schema 安装只由存储层负责 | 真实 SQLite 全量转换及事务回滚 |
| 场景目录混入一次性旧表 reader、配置转换和备份恢复 | 转换器及其测试统一放入迁移目录，原路径删除，无 re-export 兼容层 | 完整历史、私人资料、进程中断和恢复回归 |
| 转换器调用当前 Repository、模板和偏好规则 | 固定迁移目标契约与模板；迁移直接写目标表，不导入当前业务运行时 | 转换回归及 dependency-cruiser 强制边界 |
| Node 单独复制场景 SQL；Electron 优先读取已有 dist | `sql-assets.ts` 统一定位资源；两个构建脚本共用 `sqlite-assets.mjs`，从本次源码复制 SQL 树 | Node 构建产物实际转换；单文件压缩打包执行；SQL 缺失明确失败 |
| 通用通知服务直接读取 proactive 表、调用摘要及打扰策略 | 领域投递接口由 Gateway 注入；旧域的浏览器、Telegram、策略和事件映射归还旧域目录 | 删除全部 proactive/heartbeat 表后，通用通知仍可投递 |
| 未装配领域策略时，领域通知可能绕过复查 | 拒绝发布；已排队的领域通知在缺少策略时终止投递 | 无外部请求、事务回滚、去重和私密预览测试 |
| 已不支持的 v100 迁移特殊分支仍留在 runner | 删除分支；保留当前支持范围内的顺序迁移、备份与完整性检查 | migration 和 connection 测试 |
| Web `/proactive` 保留旧参数翻译跳转 | 删除旧路由和 `LegacyProactiveRedirect`，内部已无该地址调用 | Web 类型检查、构建与场景浏览器回归 |

## 固定的职责与目录

```text
src/storage/sqlite/
  schema.sql                    基线结构
  schema.ts                     基线与顺序升级入口
  sql-assets.ts                 唯一 SQL 资源定位/读取规则
  migrations/
    NNN_*.sql                   已发布的顺序迁移
    scenes/
      scenes.sql                场景目标表
      notifications.sql         通用通知目标账本
      journal.sql               跨数据库/配置文件提交日志
      schema.ts                 目标结构安装与表清单
      cutover.ts                一次性完整转换协调入口
      database.ts               全表转换、对账和旧表删除
      targetContract.ts         本次迁移固定的数据格式
      targetTemplates.ts        本次迁移固定的模板版本
      *.ts                      各历史格式转换、预检及恢复
      __tests__/                迁移验收
src/scenes/                     当前场景业务、执行与结果
src/notifications/              通用通知持久化、队列及传输
src/gateway/                    数据库、业务与传输的装配和生命周期
scripts/sqlite-assets.mjs        Node/Electron 共用资源复制
```

历史格式必须留在迁移内，才能升级现有用户数据。它们不得进入新运行时的读取、执行或兼容路径。迁移中的固定模板和格式描述也不得随日常业务改动一起更新；后续格式变化通过新的迁移处理。

已在 `.dependency-cruiser.cjs` 固定三项约束：场景运行时不得依赖旧域或迁移；通用通知不得反向依赖场景、旧域或迁移；场景迁移不得依赖当前场景、通知、旧域或 Gateway 实现。

`migrations/scenes/` 是最终存储归属，不是额外运行时或临时 schema 目录。完整转换入口尚未在生产启动中注册；注册必须与下面的运行时替换一起完成，不能靠自动建表假装完成上线。

## 仍须完成的生产替换

`src/gateway/scenes/host.ts` 已完成新域的独立宿主装配和转换后数据库验收：定时/邮件观测、模型执行、页面通知、预算与摘要、关闭等待和重启恢复。`mailContext.ts` 通过现有 Connector 策略只读获取已委托的 Gmail 线程，不借用后台学习同步，也不退回旧缓存生成草稿。正式 `GatewayService.start` 尚未调用该宿主，下面的生产替换清单仍然成立。

| 位置 | 当前实况 | 最终要求 |
| --- | --- | --- |
| `src/gateway/service.ts` | 仍构造、启动 Proactive 三个 worker 和助理 Heartbeat；项目、自动化、连接器事件仍指向旧事件服务 | 完整迁移门禁先于 worker，注入唯一 SceneRuntime/事件观测/成果发布与投递；删除旧装配 |
| `src/gateway/hono/app.ts`、`routes/deps.ts` | 场景服务为可选注入，正式 Gateway 没有提供 | 正式宿主提供真实服务；测试宿主显式装配，不能回退到旧域 |
| `src/proactive/notifications/` | 当前 Gateway 仍注入旧域的通知策略 | 场景投递策略完成后整体删除旧目录及装配；通用通知接口保留 |
| `src/agent/tools/xopc-use-tool.ts` | 仍提供 proactive 模式和旧邮件跟进命令 | 场景应用服务驱动的 scene 模式，删除旧模式与说明 |
| Gateway routes、Web `/assistant-work`、Heartbeat 设置 | 仍是真正使用旧域的产品入口 | 新入口、配置和历史访问就绪后同步删除旧 API、页面、导航及协议 |
| 移动端与通知偏好协议 | 共享协议已经支持场景目标，端侧场景页和偏好还未完成替换 | 用户点击通知能到达成果；删除 proactive 偏好/目标前完成历史转换和客户端接入 |

这些是尚未完成的功能依赖，不是最终设计允许保留的兼容层。不能发布当前工作区为“场景替换完成”。网络 keep-alive、WebSocket 心跳、独立 Automation/Workflow/Task 以及其他功能使用的静默标记不在删除范围。

## 验收记录

- 52 个测试文件、522 项通过，覆盖场景、存储转换、迁移、连接、通知、Proactive 回归、鉴权 HTTP 和 lazy-route 映射。
- Node 构建通过；从构建产物执行完整转换，34 张源表逐一对账并删除，ready gate 通过。
- 单文件压缩打包能从统一资源目录安装基线、33 张场景表、11 张通知表和 journal；缺失 SQL 不会回退读取源码。
- 根目录类型检查、定向 ESLint、架构依赖检查通过。
- Web 类型检查、构建、Chrome 真实鉴权隔离流程通过，覆盖邮件草稿与私人历史。构建仍提示现有 chunk 大小和 work-discovery 动态导入未拆包；浏览器脚本直接切换 hash 的两条 Router 警告不影响断言。详细结果见[实施记录](./scenes-implementation-progress.md)。
- 未对真实用户数据库执行转换，未启动新生产 worker，未发送邮件或通知。

Electron Gateway 实际单文件打包通过；打包后的全部 SQL 与本次源码逐文件一致，迁移资源目录不含 TS/JS 源码。
