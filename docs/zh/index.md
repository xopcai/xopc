---
layout: home

hero:
  name: xopc
  text: 把目标变成循环。
  tagline: "让重要的事持续向前。自托管、本地优先的个人 AI 运行时：统一连接模型、Agent、持续状态、工作流、自动化与多端入口。你掌控数据、密钥和运行环境。"
  image:
    src: /logo.svg
    alt: xopc
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/xopcai/xopc

features:
  - title: 🧠 持续状态，而非一次性上下文
    details: "持久会话、项目、目标、笔记、工作区与运行记录各有明确归属，长期工作可以恢复、检查和继续。"
    link: /zh/concepts/loops
  - title: 🏠 默认本地优先
    details: "xopc 运行在你自己的硬件上。配置、工作区文件、凭据和本地状态默认都在 ~/.xopc/。没有强制云端。"
    link: /zh/configuration
  - title: 🔑 使用自己的密钥，自由选择模型
    details: "DeepSeek、OpenAI、Anthropic、Google、Ollama、LM Studio、vLLM、Bedrock、Azure——内置 20+ 模型服务商。云端模型、本地模型或自部署服务都能接入，一行配置即可切换。"
    link: /zh/models
  - title: 📡 同一套运行时，多个入口
    details: "TUI、CLI、浏览器、桌面应用、iOS/Android 与即时通讯连接同一套 Agent、会话和项目状态。"
    link: /zh/desktop-app
  - title: 🧩 Agent 能力边界可配置
    details: "为每个 Agent 分别配置身份、模型角色、工作区、工具策略、技能、记忆和边界，再通过扩展添加工具、通道与 UI。"
    link: /zh/extensions
  - title: ⏰ 可触发的自动化
    details: 定时、手动或 webhook 触发 Agent 与工作流运行，并保留运行结果与失败记录。
    link: /zh/automations
  - title: 🌐 浏览器自动化
    details: 和助手一起完成一次网页任务，再从控制台、对话或定时任务中重复运行已验证的步骤。
    link: /zh/browser-workflows
  - title: 🔀 动态工作流
    details: 确定性脚本扇出多个子 Agent——仓库审计、多视角评审、并行调研，实时进度可见。
    link: /zh/workflows
  - title: 🤖 多 Agent 路由
    details: 不同场景路由到不同 Agent——各自模型、工作区、工具与系统提示词，上下文完全隔离。
    link: /zh/routing-system
  - title: 🌐 HTTP/SSE 网关
    details: REST JSON API 与 SSE 流式更新；浏览器与 Electron 内为同一套 React 控制台。
    link: /zh/gateway
  - title: 🛠️ 类型安全工具
    details: TypeBox 定义内置与自定义工具——网页搜索、浏览器（Playwright，按需开启）、文件操作等。
    link: /zh/tools
  - title: 🎙️ 语音与图像
    details: 在已配置路径上提供 STT/TTS（Telegram、网关等）；图像支持识图与按需生图。
    link: /zh/voice
---

[![xopc 桌面端演示](/xopc-desktop.gif)](./desktop-app.md)

## xopc 管理的是一套工作运行时

普通聊天产品通常围绕一次对话组织能力。xopc 为长期工作提供一个状态事实源和少量相互连接的执行能力：

| 对象 | 保存什么 | 如何继续 |
| --- | --- | --- |
| Agent | 身份、职责、模型角色、工具、技能、记忆与边界 | 为不同工作建立明确能力范围 |
| Session | 对话记录、上下文与运行事件 | 从终端、网页、桌面、手机或 IM 恢复 |
| Task / Project | 已验证的结果状态、可选共享上下文、阻塞、下一步和关联活动 | 持续推进，不再维护第二套任务层级 |
| Note / Workspace | 快速输入、附件与长期文件 | 收集原始材料，沉淀可复用上下文和产物 |
| Workflow / Automation | 多 Agent 执行过程、触发规则、运行状态与结果 | 执行复杂任务，并在约定时间或事件后再次运行 |

这套模型的重点不是“AI 会自动记住一切”，而是由 Task 统一持有工作状态，让触发和执行可观察，让你始终知道下一步从哪里继续。了解详情：[Task 闭环](./concepts/loops.md)。

## 按目标开始

| 你想做什么 | 从这里开始 |
| --- | --- |
| 在自己电脑上运行一个私有 AI 助手 | [PC 桌面端](./desktop-app.md) |
| 理解 xopc 如何保存状态、执行任务并触发后续工作 | [Task 闭环](./concepts/loops.md) |
| 用 Project、Task 和笔记组织长期工作 | [Project、Task 与笔记](./projects-tasks-notes.md) |
| 了解 xopc 和 Codex、Claude Code、Qoder、WorkBuddy 的区别 | [产品对比](./comparison.md) |
| 在 Telegram、微信或飞书/Lark 中使用同一个助手 | [消息通道](./channels/index.md) |
| 设置定期复盘、提醒和摘要 | [自动化](./automations.md) |
| 让助手重复完成网站上的固定任务 | [浏览器自动化](./browser-workflows.md) |
| 为工作、代码和个人场景配置不同 Agent | [Session 路由](./routing-system.md) |
| 用工具、通道或可复用技能扩展 xopc | [技能系统](./skills.md) 和 [扩展](./extensions.md) |
