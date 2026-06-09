---
layout: home

hero:
  name: xopc
  text: AI 工作站
  tagline: 与你一起成长的 AI 工作站——为一人公司打造的本地优先 AI 助手。CLI、桌面、浏览器、手机、即时通讯——全平台覆盖。自带钥匙，无需 fork 即可扩展。
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
  - title: 🏠 你的机器，你的规则。
    details: "xopc 运行在你自己的硬件上。对话留在本地，密钥存在你的配置里。没有强制云端——一切尽在 ~/.xopc/。"
    link: /zh/configuration
  - title: 🔑 自带钥匙，任选模型。
    details: "DeepSeek、OpenAI、Anthropic、Google、Ollama、LM Studio、vLLM、Bedrock、Azure——内置 20+ 供应商。纯离线或云端本地混搭，一行配置切换模型。"
    link: /zh/models
  - title: 📡 一个大脑，每块屏幕都能用
    details: "同一个助手——终端、浏览器、桌面应用、手机、即时通讯。无需同步，因为本来就是同一个系统。"
    link: /zh/channels
  - title: 🧩 跟你一起长大，永远不会过时。
    details: "xopc skills install · xopc extensions install——用 SKILL.md 教知识，增加工具、通道与 UI 面板，不必改核心代码。"
    link: /zh/extensions
  - title: ⏰ Cron 定时
    details: 摘要、提醒与报告按时间表推送。在你专注别处时，Agent 也能主动运行。
    link: /zh/cron
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
