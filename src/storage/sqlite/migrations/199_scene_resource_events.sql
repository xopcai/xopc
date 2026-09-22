-- Scene resource revisions cover the aggregate (notes, runs, results), not activation edit revisions.
-- Triggers keep background producers and capability calls on the same durable outbox path.
CREATE TABLE scene_resource_revisions (
  resource_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK(revision >= 0)
);
INSERT INTO scene_resource_revisions SELECT id, 0 FROM scene_activations;

CREATE TRIGGER scene_activations_resource_insert
AFTER INSERT ON scene_activations
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.id, 1 WHERE NEW.id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.created', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.id;
END;

CREATE TRIGGER scene_activations_resource_update
AFTER UPDATE ON scene_activations
WHEN OLD.revision IS NOT NEW.revision OR OLD.status IS NOT NEW.status OR OLD.goal IS NOT NEW.goal OR OLD.scope_json IS NOT NEW.scope_json OR OLD.permissions_json IS NOT NEW.permissions_json
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.id, 1 WHERE NEW.id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.id;
END;

CREATE TRIGGER scene_activations_resource_delete
AFTER DELETE ON scene_activations
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.id, 1 WHERE OLD.id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.deleted', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.id;
END;

CREATE TRIGGER scene_notes_resource_insert
AFTER INSERT ON scene_notes
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_notes_resource_update
AFTER UPDATE ON scene_notes
WHEN OLD.revision IS NOT NEW.revision
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_notes_resource_delete
AFTER DELETE ON scene_notes
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_work_items_resource_insert
AFTER INSERT ON scene_work_items
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_work_items_resource_update
AFTER UPDATE ON scene_work_items
WHEN OLD.revision IS NOT NEW.revision OR OLD.status IS NOT NEW.status OR OLD.due_at IS NOT NEW.due_at
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_work_items_resource_delete
AFTER DELETE ON scene_work_items
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_schedule_cursors_resource_insert
AFTER INSERT ON scene_schedule_cursors
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_schedule_cursors_resource_update
AFTER UPDATE ON scene_schedule_cursors
WHEN OLD.revision IS NOT NEW.revision OR OLD.next_due_at IS NOT NEW.next_due_at
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_schedule_cursors_resource_delete
AFTER DELETE ON scene_schedule_cursors
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_trigger_intents_resource_insert
AFTER INSERT ON scene_trigger_intents
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_trigger_intents_resource_update
AFTER UPDATE ON scene_trigger_intents
WHEN OLD.status IS NOT NEW.status OR OLD.due_at IS NOT NEW.due_at
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_trigger_intents_resource_delete
AFTER DELETE ON scene_trigger_intents
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_runs_resource_insert
AFTER INSERT ON scene_runs
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_runs_resource_update
AFTER UPDATE ON scene_runs
WHEN OLD.status IS NOT NEW.status OR OLD.attempt IS NOT NEW.attempt OR OLD.reason IS NOT NEW.reason OR OLD.retry_at IS NOT NEW.retry_at
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_runs_resource_delete
AFTER DELETE ON scene_runs
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_presentations_resource_insert
AFTER INSERT ON scene_presentations
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = NEW.outcome_id), 1 WHERE (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = NEW.outcome_id) IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = NEW.outcome_id);
END;

CREATE TRIGGER scene_presentations_resource_update
AFTER UPDATE ON scene_presentations
WHEN OLD.status IS NOT NEW.status OR OLD.revision IS NOT NEW.revision OR OLD.withdrawn_at IS NOT NEW.withdrawn_at OR OLD.expires_at IS NOT NEW.expires_at OR OLD.snoozed_until IS NOT NEW.snoozed_until
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = NEW.outcome_id), 1 WHERE (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = NEW.outcome_id) IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = NEW.outcome_id);
END;

CREATE TRIGGER scene_presentations_resource_delete
AFTER DELETE ON scene_presentations
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = OLD.outcome_id), 1 WHERE (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = OLD.outcome_id) IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = (SELECT r.activation_id FROM scene_outcomes o JOIN scene_runs r ON r.id = o.run_id WHERE o.id = OLD.outcome_id);
END;

CREATE TRIGGER scene_feedback_resource_insert
AFTER INSERT ON scene_feedback
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = NEW.presentation_id), 1 WHERE (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = NEW.presentation_id) IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = NEW.presentation_id);
END;

CREATE TRIGGER scene_feedback_resource_update
AFTER UPDATE ON scene_feedback
WHEN OLD.revision IS NOT NEW.revision
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = NEW.presentation_id), 1 WHERE (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = NEW.presentation_id) IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = NEW.presentation_id);
END;

CREATE TRIGGER scene_feedback_resource_delete
AFTER DELETE ON scene_feedback
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = OLD.presentation_id), 1 WHERE (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = OLD.presentation_id) IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = (SELECT r.activation_id FROM scene_presentations p JOIN scene_outcomes o ON o.id = p.outcome_id JOIN scene_runs r ON r.id = o.run_id WHERE p.id = OLD.presentation_id);
END;

CREATE TRIGGER scene_source_health_resource_insert
AFTER INSERT ON scene_source_health
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_source_health_resource_update
AFTER UPDATE ON scene_source_health
WHEN OLD.reason IS NOT NEW.reason OR OLD.retry_at IS NOT NEW.retry_at OR OLD.consecutive_failures IS NOT NEW.consecutive_failures
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_source_health_resource_delete
AFTER DELETE ON scene_source_health
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_task_bindings_resource_insert
AFTER INSERT ON scene_task_bindings
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_task_bindings_resource_update
AFTER UPDATE ON scene_task_bindings
WHEN OLD.observed_revision IS NOT NEW.observed_revision OR OLD.delivered_revision IS NOT NEW.delivered_revision OR OLD.processed_revision IS NOT NEW.processed_revision OR OLD.executing_run_id IS NOT NEW.executing_run_id OR OLD.last_error IS NOT NEW.last_error
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_task_bindings_resource_delete
AFTER DELETE ON scene_task_bindings
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_task_revisions_resource_insert
AFTER INSERT ON scene_task_revisions
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_task_revisions_resource_update
AFTER UPDATE ON scene_task_revisions
WHEN OLD.revision IS NOT NEW.revision
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT NEW.activation_id, 1 WHERE NEW.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = NEW.activation_id;
END;

CREATE TRIGGER scene_task_revisions_resource_delete
AFTER DELETE ON scene_task_revisions
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT OLD.activation_id, 1 WHERE OLD.activation_id IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = OLD.activation_id;
END;

CREATE TRIGGER scene_preferences_resource_insert
AFTER INSERT ON scene_preferences
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT 'preferences', 1 WHERE 'preferences' IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = 'preferences';
END;

CREATE TRIGGER scene_preferences_resource_update
AFTER UPDATE ON scene_preferences
WHEN OLD.revision IS NOT NEW.revision
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT 'preferences', 1 WHERE 'preferences' IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = 'preferences';
END;

CREATE TRIGGER scene_preferences_resource_delete
AFTER DELETE ON scene_preferences
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT 'preferences', 1 WHERE 'preferences' IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = 'preferences';
END;

CREATE TRIGGER scene_template_versions_resource_insert
AFTER INSERT ON scene_template_versions
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT 'templates', 1 WHERE 'templates' IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = 'templates';
END;

CREATE TRIGGER scene_template_versions_resource_update
AFTER UPDATE ON scene_template_versions
WHEN OLD.content_hash IS NOT NEW.content_hash
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT 'templates', 1 WHERE 'templates' IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = 'templates';
END;

CREATE TRIGGER scene_template_versions_resource_delete
AFTER DELETE ON scene_template_versions
BEGIN
  INSERT INTO scene_resource_revisions(resource_id, revision)
    SELECT 'templates', 1 WHERE 'templates' IS NOT NULL
    ON CONFLICT(resource_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO domain_outbox(event_id, event_type, subject_kind, subject_id, correlation_id, payload_json, created_at, operation_id)
    SELECT lower(hex(randomblob(16))), 'scene.changed', 'scene', resource_id, resource_id,
      json_object('sceneId', resource_id, 'revision', revision), CAST(unixepoch('subsec') * 1000 AS INTEGER), xopc_operation_id()
    FROM scene_resource_revisions WHERE resource_id = 'templates';
END;
