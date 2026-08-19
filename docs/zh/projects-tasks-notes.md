# Project、Task 与 Notes

xopc 刻意保持产品模型简单：

- **Task** 是 xopc 承诺达成并验证的结果。
- **Project** 是可选的共享上下文，关联相关 Task、会话、文件和活动。
- **Note / Workspace** 保存长期输入材料与交付产物。
- **Conversation** 是工作开始、推进和请求用户决定的入口。

Home 位于 `#/home`，Projects 位于 `#/projects`，Task 详情位于 `#/tasks/:id`。

## 什么时候使用哪个对象

| 需求 | 使用 |
| --- | --- |
| 提问、探索或完成一个小任务 | Conversation |
| 持续推进一个结果，并确认是否真正完成 | Task |
| 多个相关结果共享上下文 | Project |
| 保存参考材料或产出文件 | Note / Workspace |
| 重复一个已知的多步骤执行方案 | Workflow，并关联 Task |
| 按时间或事件运行 | Automation；推进某个结果时关联 Task |

## Task：唯一事实源

一个 Task 持有：

- 目标和可选的 Project 上下文；
- 验收标准与交付物；
- 边界与所需授权；
- 内部状态和派生的用户状态；
- 下一步和阻塞原因；
- 执行尝试、运行租约与会话；
- 验证证据与执行回执。

面向用户的状态刻意保持为三种：

- `running`：xopc 可以继续推进；
- `needs_user`：确实需要用户提供决定、权限、凭证或事实；
- `completed`：验收标准已经通过验证。

Project、Workflow、Automation 和 Conversation 只关联 Task，不维护另一套相互竞争的任务状态。

## Project：上下文，不是任务管理器

Project 可以包含简报、约束、文件、相关会话、Task、工作流运行和活动。它的运营视图从关联 Task 与运行中派生进展和注意事项，因此用户无需维护第二套层级。

## Home：最小但有用的视图

Home 是对现有状态的读取投影，只展示一个有上限的决策队列、正在推进的 Task、最近已验证结果，以及真正需要关注的失败运行。同一个 Task 不会同时以“状态卡”和“决策卡”重复出现。

## 示例

以版本发布为例：

1. 用户在 Conversation 中说明想要的发布结果。
2. xopc 创建一个 Task Contract，写清范围、验收标准、交付物和验证方式。
3. 只有多个 Task 或长期文件需要共享上下文时才创建 Project。
4. xopc 根据执行需要选择直接工具、Workflow 或 Automation。
5. Home 只询问 xopc 无法安全代替用户做出的决定。
6. 只有证据满足验收标准，Task 才进入完成状态。

继续阅读 [Task 闭环](./concepts/loops.md)、[工作流](./workflows.md)、[自动化](./automations.md) 和 [Workspace](./workspace.md)。
