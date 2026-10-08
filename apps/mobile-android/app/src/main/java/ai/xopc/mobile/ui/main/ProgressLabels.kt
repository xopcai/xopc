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
internal fun runStatusLabel(value: String): String = stringResource(when (value) {
  "queued" -> R.string.workflow_status_queued
  "running" -> R.string.workflow_status_running
  "cancelling" -> R.string.progress_status_cancelling
  "done", "succeeded" -> R.string.workflow_status_done
  "failed" -> R.string.workflow_status_failed
  "cancelled" -> R.string.workflow_status_cancelled
  "timeout" -> R.string.progress_status_timeout
  else -> R.string.workflow_status_unknown
})
