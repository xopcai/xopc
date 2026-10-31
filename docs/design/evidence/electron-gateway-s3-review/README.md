# S3 review 修复与验收（2026-10-31）

审查基于 main `3f86a8af2` 的 S3 分支，修复源码 `913729032`。范围仍为纯文本远端聊天、业务状态隔离与恢复；不推进 S4/S5、远端 Host 或本机能力。

## 确认的问题与修复

1. 切换会话在等待业务写入后才改变 generation，旧历史请求可能在这段时间写入新会话视图。现在先递增 generation、取消旧 HTTP/Realtime 并清空临时视图，再等待持久化；每个 await 后重新核对存活状态和 generation。
2. 等待草稿写入期间关闭窗口，迟到的 select 原来仍会创建新的 RealtimeClient。现在关闭/旧选择不能继续建连接。
3. stop 的异步响应未绑定发出时的会话/generation/run，切换后可能错误显示新会话已停止。现在只更新原目标；run 已更换时清理旧停止状态。
4. 写入循环结束至 Promise.finally 之间的微任务窗口可能接到最后一次草稿更新，调用方成功返回但没有写盘。现在预先登记 writer，并在同一个 drain 执行体的 finally 中同步释放所有权；后续更新得到真正覆盖其写入的 Promise。
5. 输入意图 fsync 期间如果 Realtime 断开，原逻辑仍会调用 POST。现在调用前再次核对连接、generation、会话和存活状态；明确尚未调用 transport 的意图可清理并保留草稿；已发出但结果未知的输入继续只查 receipt，不重放。
6. 初始化期间允许 select，慢模型目录响应可能与新连接竞争。现在初始化完成前不切换，初始编辑/新建控件禁用，并阻止初始化结果在销毁后继续发请求。

[第一组修复前日志](./xopc-s3-review-races-before.log)有5个确定性失败；[初始化延迟前日志](./xopc-s3-review-initialize-forced-before.log)复现第6个问题。快速 mock 的初始初始化检查未复现，随后用受控延迟目录响应复现；两份过程日志均保留。所有修复后回归通过，不增加产品超时、不弱化旧响应/重复提交断言。

## 验证口径

最终测试、E2E、原预算与命令汇总在 `validation.json`。正式性能始终对比原 S0，采样器、每模式30次启动/129个API样本及门槛不变；本轮不重定基线。原 S0/S1、性能排查、S2 与 S3 初次失败证据均保持原样。

当前是 macOS arm64 开发 Electron + 独立真实 Gateway 进程验证。HTTPS 是 TLS 终止 fixture，SSH 是显式 loopback 逻辑远端；只有推理确定化。显式回本地观察生产代码的 relaunch 参数，再由测试监督器按同样参数运行原 main，不当作 OS 原生重启或安装包验收。S4/S5、物理服务器、跨平台、长期运行和完整产品发布仍未验收。

最终 **946项 / 113文件、10组E2E通过**；两轮原S0预算各60次均 **8/8通过**，新旧 out/main、dist/Gateway/Web与SQL产物指纹一致，只有远端preload/UI产物变化。详见[汇总与命令](./validation.json)、[预算1](./s3-review-budget-1.json)、[预算2](./s3-review-budget-2.json)。采样报告dirty标记对应待归档文档/证据，产品源码与产物指纹已单独核验。复测务必更换输出文件名，不能覆盖本轮证据。
