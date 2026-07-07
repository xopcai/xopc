CREATE VIRTUAL TABLE IF NOT EXISTS projects_fts USING fts5(
  content,
  project_id UNINDEXED,
  tokenize='unicode61'
);

DELETE FROM projects_fts;

INSERT INTO projects_fts (content, project_id)
SELECT
  trim(
    coalesce(name, '') || char(10) ||
    coalesce(slug, '') || char(10) ||
    coalesce(description, '') || char(10) ||
    coalesce(workspace_root, '') || char(10) ||
    coalesce(brief, '') || char(10) ||
    coalesce(instructions, '') || char(10) ||
    coalesce(default_agent_id, '')
  ) AS content,
  project_id
FROM projects;
