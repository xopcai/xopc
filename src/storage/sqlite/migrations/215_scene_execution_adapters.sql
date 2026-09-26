-- Direct cutover: task-backed scenes are claimed by the task execution adapter.
-- Existing activations keep their template identity; no compatibility runtime remains.
UPDATE scene_template_versions
SET manifest_json = json_set(manifest_json, '$.execution.kind', 'task'),
    content_hash = '4e0e6b0bfb597c06c81e34898f64af6b45b6d8705b65d1f4665d8027cddf5406'
WHERE template_key = 'task-follow-up' AND version = '1.0.0';
