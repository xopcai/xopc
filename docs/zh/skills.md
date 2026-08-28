# Skill

Skill 是一组可复用指令和可选资源，用来教 Agent 如何完成某类工作。Skill 决定工作方法，工具提供执行这些方法所需的动作。

## 查找并启用 Skill

在 Gateway 控制台打开 **Skill**，查看说明和要求，然后为目标 Agent 安装或启用。

终端中使用：

```bash
xopc skills list
xopc skills status <skill-name>
xopc skills install <skill-name>
xopc skills enable <skill-name>
```

有些 Skill 已经存在，但需要先安装依赖或完成配置才能就绪。

## 配置与验证

```bash
xopc skills config <skill-name>
xopc skills audit <skill-name>
xopc skills test <skill-name>
```

启用后，用目标 Agent 新建 Session，并提出一个明确符合该 Skill 用途的小请求。Agent 应按 Skill 的流程工作，并报告缺少的要求。

## 信任与安全

Skill 可以要求 Agent 使用高权限工具或安装依赖。启用仓库外的 Skill 前：

1. 阅读它的指令和源码；
2. 检查要求的工具、命令、包、环境变量和网络访问；
3. 运行安全审计；
4. 只为确实需要的 Agent 启用；
5. 使用非敏感输入测试。

流行或带签名的归档并不自动等于安全。Skill 的实际访问范围由其指令和 Agent 已启用工具共同决定。

## 启用、停用与更新

```bash
xopc skills disable <skill-name>
xopc skills status <skill-name>
xopc skills hub --help
```

依赖不可用、指令不再合适，或需要隔离行为问题时停用 Skill。停用会保留文件和配置。

## Skill 不工作时

| 现象 | 检查内容 |
| --- | --- |
| 列表中没有 Skill | 当前 xopc Profile 可以访问它的来源目录 |
| 状态未就绪 | 安装依赖并完成配置 |
| Agent 忽略 Skill | 已为该 Agent 启用，并且请求清楚匹配其用途 |
| 命令或工具被拒绝 | Agent 策略有意允许所需能力 |
| 测试失败 | 先修复第一个失败检查，再重试 |

排障先运行 `xopc skills status <skill-name>`。除非准备维护自己的副本，否则不要直接修改已安装 Skill 的文件。
