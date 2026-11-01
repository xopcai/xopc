# J2b-2：Gateway操作审计关联与访问边界

2026-11-01，基于`a05ea9577`继续实施。未修改原性能预算，未合入main；本批仅完成稳定身份审计关联，完整可靠执行及后续阶段继续开发。

## 已交付

- Agent既有`executeExternalOperation`的稳定operationId传入Endpoint审计，invocationId仍标识传输尝试；原Endpoint消息没有新增强制字段，不为旧客户端开启执行能力。
- schema266增加可空operation_id和索引，完整202–265迁移及v217历史基线继续支持；旧记录保留，字段为null。不复制参数正文，也不将审计ID当成执行权或停止证明。
- 现有认证审计API支持严格UUID筛选operationId。设备只能查询自己记录，跨设备principalId拒绝、其他设备operationId返回空。设备批量撤销要求gateway.admin，device.self不授予该权限；owner管理入口保留。
- 增加实际安装包审计HTTP和跨包升级验收脚本。

## 验证

- 全量SQLite存储回归**247项、40文件通过**，包含每个受支持版本的升级、备份、回滚和历史保留检查。
- 连接/Endpoint/Realtime/Provider相关回归**286项、38文件通过**。
- 认证、设备证明、独立设备帧和只读观察**58项、8文件通过**；最后针对性API/Provider/WS/lazy映射**88项、5文件通过**。这些集合重叠，不相加。
- 根/Electron类型检查通过。
- 真实WS验证审计在发送前已记录、写操作关联稳定ID及去重重放不再次调用Endpoint；工具执行由合成Endpoint响应，不冒充本机写权限或原生批准。
- 实际包内Gateway HTTP验证无凭据401、owner筛选、设备请求签名、只读自己记录、跨设备拒绝、无效筛选400和device.self撤销403。
- 新包本地新启动/复用、聊天、Cookie/Realtime、文件/PTY/浏览器IPC、进程所有权及重启通过；**复用真实旧schema265包时，外部Gateway退出后仍存活，数据库265→265未升级**。
- 独立的跨包升级：真实旧265包先建立隔离数据库，停进程后写入合成历史调用；再由真实新包执行265→266，HTTP读取历史不丢失，完整性/外键通过，保留一份权限0600、版本仍为265且历史完整的pre-upgrade备份。新旧包内容摘要均未变化。
- 新包SSH-loopback远端聊天/历史、断线与gap不重投、进程/worker崩溃的未知输入、回执恢复、草稿隔离、身份/版本矩阵及返回本地通过；不是本轮公共CA/WAN或新原生交互验收。

## 安装包与保留证据

候选：`/tmp/xopc-j2b-audit-delivery-2/installed/xopc.app`，来自实际DMG只读挂载复制。1427文件摘要`9f6df4b411053af2153057659c262f44e77826ec05649dbe9e8c737da4c1d524`；DMG `/tmp/xopc-j2b-audit-delivery-2/xopc-preview-arm64.dmg`，SHA256 `b25170890bf6d3bfa7870441905399abf9170b37f1f041fba1955fa95b3876fa`。Developer ID签名，未公证；372包内资源、665运行产物字节验证通过。第一轮构建在权限审查修复前完成，只保留构建日志；实际安装验收均使用第二轮最终候选。

`xopc-j2b-audit-storage-regression-1.log`保留首次全量失败：旧输入恢复测试把最新数据库改版本号伪装为v260，只删除部分新表，导致desktop_observation_grants重复创建。已改用真实v217历史DDL及218–260升级链构建v260结构、复制测试行后让正式打开路径升级，并验证原输入恢复行为。生产SQL没有改为忽略重复表或删旧数据。修复后整批247项通过，后续结果另存。

原预算文件SHA256仍为`e752bb4b97f54e4713d8ecc8b6f8cd302d3e80d044099b0397dfe113d0f45746`；没有重新定义性能通过条件。S5独立旧候选24小时测试继续运行，不冒充本批Host长测。

本批尚未开放远端Host写入/命令：稳定操作意图与回执的传输接线、独立设备执行授权、结果核实与人工处理未知结果、J3以及P3/P4仍需继续。此包为内部阶段候选，不能作为用户要求的最终main交付。
