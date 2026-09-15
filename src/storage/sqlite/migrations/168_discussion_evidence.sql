CREATE TABLE discussion_transcript_revisions (
  discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  segments_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(discussion_id, revision)
);
ALTER TABLE discussion_organizations ADD COLUMN transcript_revision INTEGER NOT NULL DEFAULT 0;
UPDATE discussion_organizations SET transcript_revision = COALESCE((SELECT transcript_revision FROM discussion_captures WHERE id = discussion_id), 0);
UPDATE discussion_organizations SET organization_json = json_set(organization_json, '$.decisions', json(COALESCE((SELECT json_group_array(json_object('id', lower(hex(randomblob(8))), 'text', value, 'evidenceSegmentIds', json('[]'))) FROM json_each(organization_json, '$.decisions')), '[]'))) WHERE organization_json IS NOT NULL;
UPDATE discussion_organizations SET organization_json = json_set(organization_json, '$.risks', json(COALESCE((SELECT json_group_array(json_object('id', lower(hex(randomblob(8))), 'text', value, 'evidenceSegmentIds', json('[]'))) FROM json_each(organization_json, '$.risks')), '[]'))) WHERE organization_json IS NOT NULL;
UPDATE discussion_organizations SET organization_json = json_set(organization_json, '$.openQuestions', json(COALESCE((SELECT json_group_array(json_object('id', lower(hex(randomblob(8))), 'text', value, 'evidenceSegmentIds', json('[]'))) FROM json_each(organization_json, '$.openQuestions')), '[]'))) WHERE organization_json IS NOT NULL;
UPDATE discussion_organizations SET organization_json = json_set(organization_json, '$.chapters', json('[]'), '$.actionItems', json(COALESCE((SELECT json_group_array(json_set(value, '$.evidenceSegmentIds', json('[]'))) FROM json_each(organization_json, '$.actionItems')), '[]'))) WHERE organization_json IS NOT NULL;

ALTER TABLE discussion_captures ADD COLUMN organization_template TEXT NOT NULL DEFAULT 'general';
CREATE TABLE discussion_analysis_chunks (discussion_id TEXT NOT NULL REFERENCES discussion_captures(id) ON DELETE CASCADE, input_hash TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY (discussion_id, input_hash));
