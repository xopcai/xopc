# 录音与笔记：持久化、恢复与回顾契约

依据 2026-10-15/16 已实施文档，于 2026-10-29 合并原音安全、P0 状态、1B 续录、完成提示、证据标记、长录音回顾及媒体时钟修复。本文保存实现约束；历史实测与平台限制见[录音验收摘要](note-web-two-hour-realtime-acceptance-2026-10-16.md)。合并时没有重新执行设备或供应商验收。

## 可信状态和保存屏障

采集、本地保存、原音同步、AI 处理是四条独立状态。真实 PCM 帧或编码包到达后才确认采集；权限成功、recorder.start()、计时器或静音电平均不足以判断录音健康。暂停恢复需重新确认输入；两类音频回调均停滞 15 秒则显示等待输入。mute、ended、freeze、error 和异常 inactive 走统一收尾，旧录音迟到事件不能影响新录音。

“本机已保存”只来自音频及其元数据在同一事务中的成功提交。停止先停止原音并等待尾片、持久化队列与停止元数据屏障，实时转写独立取消；网络、STT 挂起不能阻塞已完成的本地保存。幂等停止共享同一个 Promise；超时、写失败及不完整关闭只承诺已提交前缀，迟到分片不能推进已终止的保存证明。

鸿蒙使用独立加密 ArkData `xopc-recordings.db`、FULL synchronous，约 3 秒一个独立 WAV，序号/媒体范围/字节原子提交；上传只逐片读盘，不累计全部待传 WAV。Web 使用 strict IndexedDB 事务，同步 put 异常显式 abort，关联更新进入同一写队列。恢复检查最新元数据、连续序号和数量，只读 key/元数据，不把整段音频载入内存。缺片、空会话和不一致证明不能标为完整可恢复。

已完成首次确认的已加载页面可在网关离线时先建立本地 UUID，联网后以相同 clientRequestId、原录制时间幂等创建 Discussion/Note。网关身份隔离。没有 Service Worker/离线冷启动或关闭浏览器后继续上传承诺；强杀前尚未发出或提交的尾部不在恢复承诺内。鸿蒙后台申请失败明确提示仅前台录音，不能承诺系统结束进程后继续采集。

上传 100% 只代表字节传输，seal 排队不是原音确认。完整服务端附件确认后才清理本地音频；seal 响应丢失先查询已有附件/任务并对账，不能重建另一条 Note。附件已删除时不得自动重传来撤销删除；清理中断使用完成标记恢复。原音、转写、纪要可用性独立展示，AI 失败不覆盖本机保存事实。

## 连续媒体范围与时钟

WebM/Opus 使用增量、内存有界的容器解析，只统计完整编码包，并将 mediaCoverage 与 committedChunkCount 绑定到落盘事务。verifiedThroughMs 是从起点连续可验证前缀，observedThroughMs 是最近观测位置；缺口后冻结前缀，不用最大序号、录制时钟、timeslice 或时长总和替代。

累计 Opus 采样时长作为全段基准；时间戳只允许相对帧时钟提前最多一个 WebM tick 且不超过 1ms，不允许正向容差，也不逐包累积容差。已保存范围取累计采样时长与实际媒体末端的较小值。正向跳时、缺包、非单调时间或超界偏移仍冻结前缀。旧草稿逐片重算证明，不改原音、身份或中断事实。

不支持的 MP4/OGG、WebM lacing、codec delay、BlockGroup/discard padding、损坏头部等停止推进证明，保留此前前缀与全部原音，其余时长待确认；解析器不是通用解码器。鸿蒙依据已提交 PCM 样本数。录制活跃时间、媒体位置、现实时间分开，中断不伪装成连续原音。

## 恢复、续录、导出与删除

恢复列表提供全部草稿的网关、时间、保存前缀、中断、恢复/续录/导出/丢弃。操作按录音串行；已知服务端录音不可用时不回退创建新 Note。丢弃仅删除所选设备副本，不隐式取消服务端处理或删除已生成笔记。

续录保留 recording UUID、Discussion、Note 与用户标记；新 recorder 创建新 epoch，从已提交边界追加，旧事件按 recorder identity 隔离。音频键 insert-only；Web Locks 覆盖采集、恢复、导出、丢弃，无 Web Locks 时仍防止覆盖旧分片。持久化 seal intent 后禁止继续追加，即使 seal 响应丢失。完成原音不可变，继续修改需另立资源版本。

独立 WebM 容器不能直接拼接。封存逐 epoch 校验哈希、分段解码，保留不可变原音附件和带哈希、资源身份、中断事件的版本化 manifest，再生成单声道 WAV 供播放器/STT 使用。附件/manifest 达到文件同步后才能清理上传分片；部分写失败保留输入，可幂等续跑不重复建 Note。鸿蒙追加独立 PCM WAV，并保留事件 manifest。原音删除同时删除派生资源、独立源和 manifest。

正常完成且可验证的单容器逐字节导出；中断、缺片、多容器或时长不确定时导出 TAR 恢复包，含原始分片、SHA-256、缺失索引、epoch 和重建说明，绝不跨缺口伪造音频。Chrome/Edge 流式写盘，兼容内存下载上限 64MiB。鸿蒙通过文档选择器逐个 WAV 写包；取消、短写或读失败保留原音。annotation store 读取失败不阻止音频导出，manifest 明确标记元数据缺失。

## 结束体验和处理恢复

Web/鸿蒙共享 `packages/gateway-contract/src/recording-outcome.ts` 投影，`scripts/sync-recording-outcome.mjs --check` 检查镜像与文案同步。停止屏障成功后才提示可离开；同步未完成说明重开恢复。结果浮窗由用户打开同一笔记或稍后处理，不强制跳页；关闭界面不终止保存。空音频、部分保存、原音删除、等待确认与 AI 失败分别表达。

普通重试复用当前进度；转写失败续转写，纪要失败只重新生成纪要。原文更新标记旧分析，重整保留模板和人工编辑。重点同步失败只重试 outbox，不重新上传原音或新建 Note。完整恢复、退避、租约、from_audio generation 与人工内容保留见[生成可靠性](note-generation-reliability.md)。

## 证据、重点和版本

概览、原文、我的标记共享以 Note 为键的播放器、位置、查询、分页和选中锚点；切页/证据面板不重建播放器，恢复位置不自动播放，迟到响应按 Note/播放所有权隔离。证据绑定 transcript revision 与 segment IDs，不把旧版序号映射到新版行。多处依据分别展示/回听，到选定范围末端暂停；未知词级时间不伪造精确定位。

Web 标记先提交独立 strict IndexedDB outbox，再反馈成功；点击时 flush 并使用已提交编码包时钟及 epoch，空 flush 绑定下一已保存边界。鸿蒙使用 PCM 位置和加密 S2 SQLite/FULL outbox。标记失败不停止原音保存；说明是用户上下文，不当作录音事实。类型区分重点、问题、补充说明；编辑/删除保留 revision 和 tombstone，旧请求不能复活删除项。飞行中确认不能覆盖后续编辑，冲突保留本地文字并要求显式合并或采用服务端版本。

discussion_annotations 与 discussion_media_timeline 保存稳定 UUID、不可变原始锚点、revision 和按原音 SHA-256 绑定的时间映射。封存建立编码包时间到解码时间的有界映射；跨 epoch/暂停不连续范围拆分，无法核实旧锚点不吸附。人工校对、旧分析、原音哈希和不可变转写版本保留。原音清理不清除尚未同步的 annotation outbox。

认证接口：GET `/api/discussions/:id/evidence?revision=…&segments=…`、GET/PUT annotations、GET audio-clip。读取 workspace.read，写入 workspace.write；既有 discussion lazy bundle 覆盖。片段解码有输出/超时/取消限制，并发最多两个；鸿蒙每次最多 120 秒 WAV，通过带设备证明的请求下载，失败/释放关闭句柄并清除临时文件，不在裸 URL 传凭据。压缩时间映射使用 ffprobe，支持 XOPC_FFPROBE_PATH 与 XOPC_FFMPEG_PATH。

## 长录音搜索与阶段性内容

GET `/api/discussions/:id/review?q=&offset=&limit=&version=` 需要 workspace.read，默认 20 条、最多 50 条、关键词最多 200 字符。Note 内使用 Unicode NFKC 和不区分大小写的字面量匹配，涵盖原文、章节、分析、候选行动与标记，不执行正则或模型搜索。分页绑定版本，改变后拒绝沿用旧游标；搜索时保持结果快照，空查询可刷新阶段性内容。尚未转写音频不可搜索。

discussion_chapter_progress 绑定原音 SHA-256、原文 revision/全文 SHA-256，旧代次任务不能写入新投影。阶段性转写使用 processing run 独立身份，不占正式 sequence，也不提供正式校对/标记。已确认分片和已验证章节先行可读、搜索和回听，旧发布版本在新代次原子发布前继续可用。

处理进度使用本代次持久化区间并集和连续前缀，重叠不重复计时，旧原文/旧分析不算当前完成范围；completed 状态不能替代覆盖说明，无语音范围不伪装成文字。章节显示时间、摘要、重点数与候选行动数，旧依据不跳新版段号。原音就绪后播放不等待纪要。

## 保留的未完成事项

候选行动确认 2C、精确单卡片重算、语义问答、四小时扩时与说话人/声纹不是以上实现的完成声明。iOS 独立长录音会话/录制中恢复、Android 完整 Notes 入口、增量上传性能与跨任务调度应按当前代码另行核实，不能沿用 2026-10-15 审计快照断言仍存在或已修复。鸿蒙真机长录音、系统休眠/唤醒、来电/蓝牙抢占、低存储、Safari/其他容器及原生加密 SDK 故障仍需平台实测；主机 SQLite、HAP 编译和 CDP freeze 不替代这些验收。
