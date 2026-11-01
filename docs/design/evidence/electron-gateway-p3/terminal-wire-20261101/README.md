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

## Native验收补充

[第3轮](./native-3.json)完整通过：真实安全存储、独立设备登记、授权取消/批准、打开/bin/sh、取消第一条stdin得到notStarted、批准第二条stdin、真实终端输出、resize签名ACK、正常关闭与根成功停止回执，专用卷的写入计数一次。两分钟授权与三秒停止预算不变。第3版原包指纹`29e1a7cd0d7f2f599fd68b8d7a733007dd9035f3af2b1a1e52decccda32feb5b`，Native副本`af6a3e9f0eded13f97eba6c942209274c7981b4ac5be340a81aa613135d69193`；仅Info.plist和主MachO身份/签名不同。新版本地新启动/旧266复用回归见`reports/p3c-terminal-installed-local-3.json`，通过且原包指纹保持。

[第1轮](./native-1.json)与[第2轮](./native-2.json)均在打开成功后首个输入失败：输入还未写入ledger，原生确认框出现时根监督器停止，服务器unknown保留。增加帧处理失败日志并启用测试包warn日志，保留失败临时卷/记录；没有延长超时或将unknown改成功。

Main新增仅供当前原生终端确认框使用的焦点识别：精确绑定可信聊天窗口对象、连接代次、未取消signal，且macOS应用仍活动、窗口仍可见。Native sheet接管窗口焦点期间可保持原授权；其他应用获得焦点、锁屏、隐藏/最小化、换窗口、代次变化或取消仍不认可。确认框结束即释放，旧释放不能覆盖新token。独立边界测试和完整类型检查通过，Native第3轮证明实际取消/批准闭环；没有开放Renderer声明焦点或修改系统锁屏设置。
