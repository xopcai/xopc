# Personal Agent 中文长回复基准

20 条合成中文样本覆盖普通对话、后台交付和明确要求完整输出的场景。前两类各 8 条，另有 4 条正文保留对照。样本使用虚构人物和业务数据，可以直接在隔离状态中运行。

## 运行

从仓库根目录执行：

```sh
pnpm exec tsc -p evals/personal/long-replies/tsconfig.json
node --import tsx evals/personal/long-replies/run.mts .xopc-evals/personal-long-replies/run-01 --dry-run
node --import tsx evals/personal/long-replies/run.mts .xopc-evals/personal-long-replies/run-01
node --import tsx evals/personal/long-replies/verify-openings.mts .xopc-evals/personal-long-replies/run-01
node --import tsx evals/personal/long-replies/fallback.mts .xopc-evals/personal-long-replies/run-01 --expect-compact
```

实跑使用配置中的模型配额。相同输出目录可继续尚未成功的请求。模型、样本或脚本指纹变化时需要使用新目录。模型只收到合成样本。执行使用临时 SQLite，授权凭据通过现有解析器读取。

## 实验设计

- 普通对话用生产 Personal 系统提示词构建器，后台交付用生产 Composer 的提示词构建器和草稿校验。只测试用户已给足材料后的文本生成。工具调用与真实用户连续对话、网关传输、聊天渲染和已保存的用户偏好不在此轮范围。
- A 使用原先的简洁规则。B 使用采纳后加入产品的规则，默认像给一个人发短消息，先说结论、限制和需要对方做的事。两版都使用固定的 GPT-6.1 Sol，每题生成一次，交替请求顺序。
- 固定 GPT-6 Luna 扮演读者，每次只看到用户请求和一版回复的第一个实质段落，最多 240 个字符。全文事实由盲评模型核对。首段理解以独立复核为准，评审只收到首段、读者答卷和预期要点，每项须给出可在首段中逐字找到的依据。全文盲评同时生成的首段分数只作为诊断记录。
- 长回复子集在实验前定义为 A 有至少 350 个非空白字符的非对照样本。接受候选要求该组至少 6 条、中位长度缩短至少 15%、首段理解不下降；两类任务各自的总体理解与保真不下降，无经复核的关键错误，并通过全部 4 个完整输出对照。
- 精确对照逐字比较清单，检查后台正文保留且仅交付一份，完整复盘按章节和事实清单核对。正文附加对照中的文本由 runner 模拟宿主拼接，独立兜底复现覆盖真实 Composer 的原样交付。
- 独立兜底复现通过临时库创建实际任务，调用生产结果交付服务和 Composer，覆盖正常交付、对话繁忙、生成失败、有无已发布附件、附件内容是否为原报告和原样交付。启用 `--expect-compact` 时会校验聊天回执以及原报告的完整字节。它不调用模型。
- 在兜底命令末尾加 `--live-normal` 会用 GPT-6.1 Sol 验证正常交付这一项，另外写入 `delivery-live.json`。

`manifest.json` 保存模型、评分口径、提示词版本和文件指纹。`results.json` 包含逐条回复、读者作答、原始评分和分组汇总。`opening-results.json` 保存首段独立复核和支持引文。`fallback.json` 保存各兜底分支实际写入聊天的文本及长度。关键评分需要读原文复核。该结果用于一次小样本筛选，读者为模型。
