# 产品对比

本文基于 2026-07-07 可公开访问的产品定位整理。目的不是给工具排名，而是帮你判断 xopc 适合作为哪一层。

## 一句话结论

如果主要任务是在代码仓库里开发，用 **Codex** 或 **Claude Code** 很合适。如果主要任务是办公交付物，例如报告、PPT、表格和调研包，**WorkBuddy** 很直接。如果想要商业化的 coding + work agent 套件，可以看 **Qoder / QoderWork**。

如果你想要的是一个自托管、本地优先、能长期记住目标，并且贯穿模型、通道、自动化、工作流和多端入口的个人 AI 系统，**xopc** 更适合作为底层。

## 对比表

| 产品 | 公开定位 | 适合场景 | xopc 的优势 |
| --- | --- | --- | --- |
| **Codex** | OpenAI 面向软件开发的 coding agent，覆盖 CLI、IDE、App 和云端任务。 | 写代码、代码审查、调试、自动化开发任务。 | xopc 不只服务 coding：`~/.xopc/` 本地状态、BYOK/本地模型、Gateway API、定时循环、桌面/网页/手机和 IM 可以共享同一个助手。 |
| **Claude Code** | Anthropic 的 agentic coding system：读代码库、改文件、跑测试、处理 git 和工具链。 | 项目级工程任务和编码任务托付。 | xopc 是面向长期工作的个人 Agent OS，不只是一轮 repo 执行。目标、会话、Agent、通道、技能、工作流和自动化可以围绕同一套本地状态连接起来。 |
| **Qoder / QoderWork** | Agentic platform，覆盖 autonomous development desktop、QoderWork、QoderWake、Qoder CLI、插件和云端 Agent。 | 商业化 coding 与 work agent 套件，多 Agent 协作与桌面/办公场景。 | xopc 是 MIT 开源、可自托管、可改造的系统。运行时、配置、状态目录、模型选择、Gateway 和扩展面都由你掌控。 |
| **WorkBuddy** | 面向职场角色的 AI agent 桌面工作站，自主规划并执行任务，交付可验证结果。 | 报告、PPT、表格、数据分析、深度调研、批量文件处理等办公任务。 | xopc 更适合想掌控运行环境的用户：自带 key，混用本地/云端模型，接入 IM，并把长期项目上下文保留在本地。 |

## xopc 的差异点

### 1. 目标循环，而不只是任务执行

很多 Agent 擅长执行一个任务。xopc 更关注持续循环：方向、行动、反馈、重新校准。它适合 side project、个人操作系统、长期研究、一人公司和周期性复盘。

### 2. 本地优先，运行环境由你掌控

xopc 默认把配置、本地状态、会话、日志、Agent 文件和工作区放在你的 xopc 状态目录下。你可以自己运行 gateway，用自己的远程访问层暴露服务，并决定哪些数据离开本机。

### 3. 使用自己的模型和密钥

xopc 设计上强调 provider 自由。你可以使用云端 API、本地模型服务、OpenAI-compatible endpoint、Ollama、LM Studio、vLLM 和其他已配置的 provider。默认助手不绑定单一厂商账号。

### 4. 一个助手，多个入口

同一个助手可以在 CLI、TUI、浏览器、桌面、手机、Telegram、微信和飞书/Lark 中使用。你不需要维护互相失忆的终端助手、网页助手和 IM bot。

### 5. 自动化和工作流是一等能力

xopc 支持定时运行、提醒、摘要、workflow run、多 Agent 路由和确定性工作流脚本。这让“循环”变成实际能力：重要事项可以主动回到视野中。

## 适合优先选 xopc 的情况

- 你想在自己的机器上运行一个私有 AI 助手。
- 你需要长期目标、项目、会话和周期性工作的上下文。
- 你希望同一个助手覆盖终端、桌面、网页、手机和 IM。
- 你想使用自己的 API Key 或本地模型。
- 你想要 MIT 开源、可改造、可自托管的系统，而不是封闭产品表面。
- 你需要自动化和工作流，而不只是聊天。

## 可以优先选择其他工具的情况

- 你只需要一个 coding agent 在单个代码仓库里工作。
- 团队已经围绕 Codex 或 Claude Code 建立工程工作流。
- 你主要需要商业化办公工作台直接生成报告、PPT 或表格。
- 你想要完全托管的企业 agent 平台，而不是自托管系统。

## 公开来源

- [OpenAI Codex](https://developers.openai.com/codex)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [Anthropic Claude Code](https://www.anthropic.com/product/claude-code)
- [Claude Code GitHub repository](https://github.com/anthropics/claude-code)
- [Qoder](https://qoder.com/)
- [Tencent WorkBuddy overview](https://www.workbuddy.ai/docs/workbuddy/Overview)
