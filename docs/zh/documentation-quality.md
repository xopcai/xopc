# 文档质量计划

这页用于跟踪 xopc 文档如何从“功能说明”改进为真正面向用户完成任务的产品文档。

## 当前判断

- 文档覆盖面较广，但部分页面仍混杂用户指南、内部设计说明和历史行为。
- 首次运行路径已经指向 `onboard --quick` 与裸 `xopc` 默认进入本地 TUI。
- 模型配置、Telegram、gateway 暴露、第二个 agent、故障诊断这些高优先级任务指南已经补齐。
- 中英文文档已有对应页面，后续要保持同步更新。
- CLI 文档需要和 `xopc --help` 保持一致。

## 文档类型

| 类型 | 用途 | xopc 示例 |
| --- | --- | --- |
| Tutorial | 用唯一可靠路径带用户完成第一次成功 | 5 分钟快速入门、本地 TUI 第一次对话 |
| How-to | 帮用户完成具体任务 | 接入 Telegram、远程访问网关、配置模型 |
| Reference | 工作中查字段/命令/API | CLI、`xopc.json`、API、模板文件 |
| Explanation | 建立心智模型和理解取舍 | Local-first、网关架构、Agent 路由 |

## 目标导航

| 分组 | 目的 |
| --- | --- |
| 快速开始 | 第一次成功对话 |
| 使用 xopc | 从 TUI、网页、桌面、手机、IM 等入口工作 |
| 运维 xopc | 运行、远程访问、模型、日志、更新、安全 |
| 扩展 xopc | Agents、skills、extensions、MCP、tools、cron、workflows |
| 参考 | 精确查阅 CLI、配置、目录、模板、架构 |

## 已完成的第一批修复

- 新增 `pnpm run docs:check`，检查 Markdown JSON 示例和 CLI 总览漂移。
- CLI 总览已按当前 `xopc --help` 对齐。
- 英文和中文高流量页面的配置示例已改成当前 manifest-first 模型。
- 中文配置页已从旧 `agents.defaults` 说明更新为当前 Agent Capability Manifest。
- 新增第一模型配置、Telegram、安全暴露 gateway、第二个 agent、故障诊断的任务指南。
- 新增严格配置参考，记录当前顶层配置段与 manifest-first agent 结构。

## 后续队列

- 补齐“配置飞书/Lark”“配置微信”“配置 outbound MCP 工具”“配置语音输入/输出”“安装与审计 skills”等任务页。
- 若 MCP 重新成为公开 root CLI 命令，再把它加回 CLI 总览。
