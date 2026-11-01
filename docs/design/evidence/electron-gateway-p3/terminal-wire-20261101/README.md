# P3c-3 PTY专用接线

本批新增Gateway持久根会话路由、Agent Provider、专用Host控制器、Main目录/逐次输入批准和保留隔离卷的终端授权入口。原有本地PTY与容器单命令目录保持原路径。Gateway和Host分别验证设备/授权revision/workspace/会话/连接代次，复用签名帧而非tool.progress。未新增Gateway认证路由或全局数据库schema。

## 已通过

- `/tmp/xopc-p3c-terminal-e2e-7.log`：实际认证Hono Gateway、独立设备与签名Realtime、Agent Provider、本机Docker PTY整条源代码链路通过。Native与加密在该夹具中注入，不能当作安装包原生验收。覆盖打开后根记录running、输入取消notStarted、随后输入序号、重复输入稳定键不再批准/写入、输出、实际stty尺寸100×30、正常关闭后删除证明及根成功。新增故障用例丢弃已验证签名的真实输入ACK，等待实际文件写入标记后断开，服务器unknown保留；本机独立核实已停止，journal保持unknown/stopped待核实，追加计数一次，未重放。
- `/tmp/xopc-p3c-terminal-wire-tests-2.log`：252项/39文件通过，包含实际Docker与上述源代码E2E、现有命令/设备/Provider/连接回归。`/tmp/xopc-p3c-terminal-packages-1.log`：438项/62文件通过，集合重叠不相加。完整类型检查第7轮通过；原预算未修改。
- 新内部预览：`/tmp/xopc-p3c-terminal-delivery-1/installed/xopc.app`，1431文件，指纹`ad66efcebfcf35f33adcc5e09d6ae7485bad41641fcf49da7e8f85a6454df719`。独立身份Native副本`7070b5d04667f9f6edc5340b037f7c77d2c407941cba7f8a739bd6a8a85590b5`。包内依赖、374项资源和669项字节验证通过。
- `reports/p3c-terminal-installed-local-1.json`：本地新启动/旧266 Gateway复用、聊天、Cookie/Realtime、原生文件/PTY/内置浏览器IPC、自己持有进程重启及外部进程不受影响通过。远端聊天回归另见对应报告；独立WAN与实际模型尚未重验。

## 修复与失败保留

- 第1轮类型检查发现Root库目标不支持Promise.withResolvers以及cancel错误码不匹配；使用显式deferred与既有cancel码，保留`/tmp/xopc-p3c-terminal-gateway-typecheck-1.log`，未更改编译目标。
- E2E第1—3轮正常关闭失败：Docker wait完成与显式关闭并发删除同一CID，第二次删除可能遇到removal-in-progress。关闭的删除与持久记录现由同一个promise串行化，监督器等待该证明后再次核实；第4轮正常整链路通过。原失败临时卷/状态/日志保留，未将409或仅进程退出当作停止证明。
- E2E第5轮初始故障注入发生在签名处，不能证明shell已执行；第6轮改为丢弃已验证签名的ACK并等待实际输出标记后断开。第5—6轮对本机终态断言过窄：服务器保持unknown时，本机可以持久记录stopped及独立停止证明，该状态仍要求人工核实，不能改为成功。第7轮同时断言两端分离状态、停止证明、待核实阻断与实际一次写入；没有放宽产品预算。原日志摘要索引见[failure-manifest.json](./failure-manifest.json)。
- 复查修复迟到停止证据：根回执原对象可能已记录executionStopped=false；释放执行权前，必须在独立容器停止后读取固定journal的新停止证明。不能以缓存回执或Native勾选替代核实。

## 待完成

`scripts/verify-electron-desktop-terminal.mjs`使用真实安装包、OS安全存储、独立设备和确定性模型，要求原生取消/批准、实际PTY输出、resize和关闭。Mac锁屏，已请求手动解锁；尚未运行该整轮，不能标记Native验收通过。后续仍有卷管理/总磁盘限制、Browser/Computer、文件管理及P4任务/大文件；性能和旧S5长测按用户要求独立保留，不阻塞功能开发。

尚未合入main或生成最终main交付包。当前origin/main到工作分支没有merge commit；最终须刷新main、保留主工作区未跟踪方案文档、线性合入，再从实际main提交重建并验证。
