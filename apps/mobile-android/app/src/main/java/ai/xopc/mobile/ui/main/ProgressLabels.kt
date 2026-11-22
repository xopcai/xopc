package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

@Composable
internal fun taskResolutionLabel(value: String): String {
  val label = when (value) {
    "done" -> R.string.progress_resolution_done
    "cancelled" -> R.string.progress_resolution_cancelled
    "wont_do" -> R.string.progress_resolution_wont_do
    "duplicate" -> R.string.progress_resolution_duplicate
    else -> return value
  }
  return stringResource(label)
}

@Composable
internal fun taskPriorityLabel(value: String): String {
  val label = when (value) {
    "low" -> R.string.progress_priority_low
    "normal" -> R.string.progress_priority_normal
    "high" -> R.string.progress_priority_high
    "critical" -> R.string.progress_priority_critical
    else -> return value
  }
  return stringResource(label)
}

@Composable
internal fun taskPresentationLabel(status: String): String = when (status) {
  "allocating" -> stringResource(R.string.task_status_allocating)
  "captured", "backlog" -> progressPhaseLabel("backlog")
  "ready" -> progressPhaseLabel("ready")
  "queued" -> stringResource(R.string.execution_status_queued)
  "running", "active", "in_progress" -> progressPhaseLabel("active")
  "verifying" -> stringResource(R.string.task_status_verifying)
  "waiting" -> stringResource(R.string.task_status_waiting)
  "paused" -> stringResource(R.string.automation_paused)
  "blocked" -> stringResource(R.string.task_status_blocked)
  "needsUser", "needs_user", "waiting_for_user" -> stringResource(R.string.personal_overview_attention)
  "review" -> progressPhaseLabel("review")
  "failed" -> stringResource(R.string.execution_status_failed)
  "cancelled" -> stringResource(R.string.execution_status_cancelled)
  "completed", "done" -> taskResolutionLabel("done")
  "ended" -> stringResource(R.string.task_status_ended)
  "closed" -> progressPhaseLabel("closed")
  "duplicate" -> taskResolutionLabel("duplicate")
  "wont_do" -> taskResolutionLabel("wont_do")
  else -> progressPhaseLabel(status)
}

@Composable
internal fun runStatusLabel(value: String): String = stringResource(when (value) {
  "queued" -> R.string.execution_status_queued
  "running" -> R.string.execution_status_running
  "cancelling" -> R.string.progress_status_cancelling
  "done", "succeeded" -> R.string.execution_status_done
  "failed" -> R.string.execution_status_failed
  "cancelled" -> R.string.execution_status_cancelled
  "timeout" -> R.string.progress_status_timeout
  else -> R.string.execution_status_unknown
})
