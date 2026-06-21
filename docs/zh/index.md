---
layout: home

hero:
  name: xopc
  text: Goal Loop OS
  tagline: "一个本地优先的长期目标 AI 助手：在终端、网页、桌面、移动端和 IM 里持续推进目标、行动与反馈。"
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
  - title: 🏠 默认本地优先
    details: "xopc 运行在你自己的硬件上。配置、工作区文件、凭据和本地状态默认都在 ~/.xopc/。没有强制云端。"
    link: /zh/configuration
  - title: 🔑 自带钥匙，任选模型。
    details: "DeepSeek、OpenAI、Anthropic、Google、Ollama、LM Studio、vLLM、Bedrock、Azure——内置 20+ 供应商。纯离线或云端本地混搭，一行配置切换模型。"
    link: /zh/models
  - title: 📡 一个大脑，每块屏幕都能用
    details: "同一个助手覆盖 TUI、CLI、浏览器、桌面应用、iOS/Android 上的 xopc-app 和即时通讯。无需同步，因为本来就是同一个系统。"
    link: /zh/channels
  - title: 🧩 跟你一起长大，永远不会过时。
    details: "xopc skills install · xopc extensions install——通过可复用的扩展模块不断补充能力，添加工具、通道和 UI 面板，免去改核心。"
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
