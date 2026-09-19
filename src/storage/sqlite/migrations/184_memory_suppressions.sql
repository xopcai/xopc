CREATE TABLE memory_suppressions (
  fingerprint TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

UPDATE notification_events SET
  event_type = 'work_discovery.completed',
  dedupe_key = replace(dedupe_key, 'work_discovery.review_ready:', 'work_discovery.completed:'),
  title_en = 'Understanding updated', title_zh = '用户理解已更新',
  body_en = 'See what xopc learned. You can edit or delete it anytime.',
  body_zh = '理解已自动整理，可随时查看、修改或删除。'
WHERE event_type = 'work_discovery.review_ready';
