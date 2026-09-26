CREATE INDEX idx_task_runs_contract
  ON task_runs(task_id, contract_version);
CREATE INDEX idx_task_runs_conversation
  ON task_runs(conversation_id);
CREATE INDEX idx_task_runs_parent
  ON task_runs(parent_run_id);
CREATE INDEX idx_task_runs_retry
  ON task_runs(retry_of_run_id);
CREATE INDEX idx_task_runs_context_snapshot
  ON task_runs(context_snapshot_id);
CREATE INDEX idx_task_run_feedback_run
  ON task_run_feedback(run_id);
CREATE INDEX idx_work_discovery_runs_conversation
  ON work_discovery_runs(conversation_id);
CREATE INDEX idx_connector_execution_audit_connection
  ON connector_execution_audit(connection_id);
CREATE INDEX idx_connector_execution_audit_installation
  ON connector_execution_audit(installation_id);
CREATE INDEX idx_connector_learning_jobs_connection
  ON connector_learning_jobs(connection_id);
CREATE INDEX idx_connector_approvals_connection
  ON connector_approvals(connection_id);
CREATE INDEX idx_knowledge_source_changes_item
  ON knowledge_source_changes(source_item_id);
CREATE INDEX idx_notification_deliveries_device
  ON notification_deliveries(device_id);
