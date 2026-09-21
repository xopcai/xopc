-- Preserve experimental records and resources without automatically widening authority.
ALTER TABLE scene_development_bindings RENAME TO scene_task_bindings;
ALTER TABLE scene_development_revisions RENAME TO scene_task_revisions;
ALTER TABLE scene_development_branch_links RENAME TO scene_task_branch_links;
ALTER TABLE scene_task_bindings RENAME COLUMN applied_revision TO processed_revision;
ALTER TABLE scene_task_bindings ADD COLUMN continuation_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE scene_task_bindings ADD COLUMN continuation_requested INTEGER NOT NULL DEFAULT 0;
UPDATE scene_task_bindings SET input_json = json_patch(json_object(
  'source', json_object('provider', 'slack_thread', 'reference', json_extract(input_json, '$.thread')),
  'goal', json_extract(input_json, '$.goal'),
  'instruction', 'Follow the delegated goal using current discussion. Do not publish, commit, push, merge or deploy.',
  'projectId', json_extract(input_json, '$.projectId'),
  'resource', 'worktree',
  'capabilities', json(CASE WHEN json_extract(input_json, '$.mode') = 'code'
    THEN CASE WHEN json_extract(input_json, '$.verificationCommand') IS NOT NULL
      THEN '["workspace.read","workspace.write","verification.run"]' ELSE '["workspace.read","workspace.write"]' END
    ELSE '["workspace.read"]' END)
), json_object('sourceUrl', json_extract(input_json, '$.sourceUrl'), 'verificationCommand',
  CASE WHEN json_extract(input_json, '$.mode') = 'code' THEN json_extract(input_json, '$.verificationCommand') ELSE NULL END)),
  last_error = 'Configuration migrated. Review permissions and resume explicitly.', next_poll_at = 0;
-- Original verified receipts remain authoritative; processed is not a verification claim.
UPDATE scene_activations SET status = CASE WHEN status = 'archived' THEN status ELSE 'paused' END,
  revision = revision + 1,
  permissions_json = json_set(permissions_json, '$.contextProviders', json('["connected_source"]'),
    '$.effectHandlers', json((SELECT json_group_array(value) FROM scene_task_bindings b,
      json_each(b.input_json, '$.capabilities') WHERE b.activation_id = scene_activations.id AND value <> 'workspace.read')))
WHERE id IN (SELECT activation_id FROM scene_task_bindings);
