ALTER TABLE music_generation_jobs ADD COLUMN error_code TEXT;

UPDATE music_generation_jobs
SET error_code = 'provider_rate_limited'
WHERE state = 'failed' AND model_ref IN ('mureka-cn/mureka-9.5', 'mureka-global/mureka-9.5')
  AND error = 'Mureka returned HTTP 429.';
