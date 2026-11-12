ALTER TABLE video_generation_jobs ADD COLUMN model_ref TEXT NOT NULL DEFAULT 'dashscope-cn/wan3.0-video';

CREATE TABLE video_generation_provider_budget (
  provider TEXT NOT NULL,
  day INTEGER NOT NULL,
  reserved_fen INTEGER NOT NULL,
  PRIMARY KEY (provider, day)
);
INSERT INTO video_generation_provider_budget(provider, day, reserved_fen)
SELECT 'dashscope-cn', day, reserved_fen FROM video_generation_budget;
DROP TABLE video_generation_budget;
