package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ProgressProject
import ai.xopc.mobile.gateway.ProjectMutation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.util.UUID

@Composable
internal fun ProjectActions(name: String, onChat: () -> Unit, onTask: () -> Unit, onNote: () -> Unit,
  onAutomation: () -> Unit, onManage: () -> Unit) {
  Column(Modifier.fillMaxWidth().padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(name, style = MaterialTheme.typography.titleLarge)
    ContextRow(stringResource(R.string.assistant_new_conversation), "", "project-action-chat", iconRes = R.drawable.action_new_chat, onClick = onChat)
    ContextRow(stringResource(R.string.progress_new_task), "", "project-action-task", iconRes = R.drawable.action_task_list, onClick = onTask)
    ContextRow(stringResource(R.string.notes_new), "", "project-action-note", iconRes = R.drawable.tab_notes, onClick = onNote)
    ContextRow(stringResource(R.string.automation_new), "", "project-action-automation", iconRes = R.drawable.action_clock, onClick = onAutomation)
    ContextRow(stringResource(R.string.project_manage), "", "project-action-settings", iconRes = R.drawable.settings_sliders, onClick = onManage)
  }
}

@Composable
internal fun ProjectEditor(project: ProgressProject?, busy: Boolean, error: Boolean, onWrite: (ProjectMutation) -> Unit) {
  var name by rememberSaveable(project?.id) { mutableStateOf(project?.name.orEmpty()) }
  var description by rememberSaveable(project?.id) { mutableStateOf(project?.description.orEmpty()) }
  var key by rememberSaveable(project?.id) { mutableStateOf(UUID.randomUUID().toString()) }
  Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(18.dp).testTag("project-editor"),
    verticalArrangement = Arrangement.spacedBy(10.dp)) {
    Text(stringResource(if (project == null) R.string.project_new else R.string.project_manage),
      style = MaterialTheme.typography.titleLarge)
    OutlinedTextField(name, { name = it.take(160); key = UUID.randomUUID().toString() }, singleLine = true, enabled = !busy,
      modifier = Modifier.fillMaxWidth().testTag("project-edit-name"), label = { Text(stringResource(R.string.project_name)) })
    OutlinedTextField(description, { description = it.take(4000); key = UUID.randomUUID().toString() }, minLines = 3, enabled = !busy,
      modifier = Modifier.fillMaxWidth().testTag("project-edit-description"),
      label = { Text(stringResource(R.string.progress_description)) })
    if (error) Text(stringResource(R.string.project_save_error), color = MaterialTheme.colorScheme.error,
      modifier = Modifier.testTag("project-edit-error"))
    Button(onClick = { onWrite(ProjectMutation.Save(project, name, description, key)) },
      enabled = !busy && name.isNotBlank() && (project == null || name != project.name || description != project.description),
      modifier = Modifier.fillMaxWidth().testTag("project-edit-save")) { Text(stringResource(R.string.progress_save)) }
    if (project != null) {
      val pinned = project.pinnedAt != null
      val archived = project.status == "archived"
      ContextRow(stringResource(if (pinned) R.string.conversations_unpin else R.string.conversations_pin), "",
        "project-edit-pin", enabled = !busy) { onWrite(ProjectMutation.SetPinned(project, !pinned)) }
      ContextRow(stringResource(if (archived) R.string.conversations_unarchive else R.string.conversations_archive), "",
        "project-edit-archive", enabled = !busy) { onWrite(ProjectMutation.SetArchived(project, !archived)) }
    }
  }
}
