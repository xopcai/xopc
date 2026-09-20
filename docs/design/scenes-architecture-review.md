# 场景系统架构复查

更新：2026-09-20。依据：[技术方案](./scenes-technical-design.md)。

旧实验功能没有用户历史保留需求。历史转换、34 表对账、私人资料导入、备份快照、配置 journal 和恢复协调器已删除；它们不再是上线条件。

## 存储职责

- `src/storage/sqlite/schemas/`：当前场景与通用通知 SQL。
- `src/storage/sqlite/scenes-schema.ts`：安装和表就绪检查，只由存储初始化和测试调用安装。
- `migrations/188_scene_storage.sql` 与 `scene-reset.ts`：普通版本升级，原子清空废弃实验数据、初始化新结构并推进版本。
- Node/Electron 从同一源码复制 SQL；业务领域不负责建表。
- 配置 schema 忽略废弃 Heartbeat 内容；不跨数据库和配置文件提交，不恢复旧巡查。

新结构仅保留运行时需要的场景表。模板不再有 history_only 分支；运行记录和反馈不再携带 import 来源；API 和界面没有私人历史导入入口。

## 正式运行链

Gateway 已使用唯一新场景宿主。旧 workers、事件发布者、Agent proactive 命令、旧 API、客户端跟进和项目监控已删除；v188 同步删除旧表。Task／Project／Automation 的独立能力保留。

新用户通过账号授权搜索和选定 Gmail 线程，不依赖知识采集。提醒使用通用通知投递账本，页面关闭后的 Web Push 仍须真实设备验证。模型用量、队列和投递诊断不等同于产品有效性指标。

最新验证与剩余发布门禁见[实施记录](./scenes-implementation-progress.md)。
