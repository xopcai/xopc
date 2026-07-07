---
layout: home

hero:
  name: xopc
  text: 把目标变成循环。
  tagline: "从一次普通对话开始，把项目持续托管给 xopc；在手机上随手记录 note/idea，再用自动化养成私有的本地 AI 数据飞轮。"
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
  - title: 🔁 循环驱动，而非一次性对话
    details: "先普通聊天，再随着真实工作逐步长出项目、笔记、外部入口和自动化。"
    link: /zh/concepts/loops
  - title: 🏠 默认本地优先
    details: "xopc 运行在你自己的硬件上。配置、工作区文件、凭据和本地状态默认都在 ~/.xopc/。没有强制云端。"
    link: /zh/configuration
  - title: 🔑 使用自己的密钥，自由选择模型
    details: "DeepSeek、OpenAI、Anthropic、Google、Ollama、LM Studio、vLLM、Bedrock、Azure——内置 20+ 模型服务商。云端模型、本地模型或自部署服务都能接入，一行配置即可切换。"
    link: /zh/models
  - title: 📡 同一个助手，多个入口
    details: "同一个助手覆盖 TUI、CLI、浏览器、桌面应用、iOS/Android 上的移动端 App 和即时通讯。无需额外同步，因为它们连接的是同一个系统。"
    link: /zh/desktop-app
  - title: 🧩 能力可扩展，长期可维护
    details: "通过 xopc skills install 和 xopc extensions install 安装可复用模块，按需添加工具、通道和 UI 面板，通常不需要改核心代码。"
    link: /zh/extensions
  - title: ⏰ 自动化
    details: 定时、手动或 webhook 触发 Agent 与工作流运行。当你专注别处时，系统仍会持续推进。
    link: /zh/automations
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

## xopc 会随着你的使用长出来

你不需要第一天就搭好复杂流程。先把它当成本地 AI 助手使用；当你持续把项目上下文交给它，xopc 才会慢慢变成能跟进长期事情的工作系统。

| 阶段 | 先怎么用 | 有需要时再加 |
| --- | --- | --- |
| 聊天 | 问问题、整理思路、做判断 | 自己的模型配置和本地状态 |
| 项目 | 让 xopc 跟进一个真实目标 | 目标状态、阻塞点、决策、下一步 |
| 笔记 | 随手丢进展、链接、想法和反馈 | 以后还能继续使用的上下文 |
| 外部入口 | 手机 App 扫码连接，也可以用桌面、终端、网页、IM、gateway API | 从你本来工作的地方收集信号；Agent 和数据仍在你的 xopc 环境里 |
| 自动化 | 定时复盘、提醒、摘要、工作流 | 不用每次手动想起来再问 |

了解这套思路：[从聊天到数据飞轮](./concepts/loops.md)。

## 按目标开始

| 你想做什么 | 从这里开始 |
| --- | --- |
| 在自己电脑上运行一个私有 AI 助手 | [5 分钟快速入门](./first-5-minutes.md) |
| 理解 xopc 如何从聊天变成数据飞轮 | [从聊天到数据飞轮](./concepts/loops.md) |
| 了解 xopc 和 Codex、Claude Code、Qoder、WorkBuddy 的区别 | [产品对比](./comparison.md) |
| 在 Telegram、微信或飞书/Lark 中使用同一个助手 | [消息通道](./channels/index.md) |
| 设置定期复盘、提醒和摘要 | [自动化](./automations.md) |
| 为工作、代码和个人场景配置不同 Agent | [Session 路由](./routing-system.md) |
| 用工具、通道或可复用技能扩展 xopc | [技能系统](./skills.md) 和 [扩展](./extensions.md) |
