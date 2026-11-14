package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

private data class AutomationIdea(val id: String, val titleRes: Int, val summaryRes: Int, val promptRes: Int, val iconRes: Int)

private val automationIdeas = listOf(
  AutomationIdea("morning", R.string.automation_idea_morning, R.string.automation_idea_morning_summary,
    R.string.automation_idea_morning_prompt, R.drawable.action_clock),
  AutomationIdea("weekly", R.string.automation_idea_weekly, R.string.automation_idea_weekly_summary,
    R.string.automation_idea_weekly_prompt, R.drawable.tab_notes),
  AutomationIdea("project", R.string.automation_idea_project, R.string.automation_idea_project_summary,
    R.string.automation_idea_project_prompt, R.drawable.action_folder),
  AutomationIdea("reminder", R.string.automation_idea_reminder, R.string.automation_idea_reminder_summary,
    R.string.automation_idea_reminder_prompt, R.drawable.action_clock),
)

@Composable
internal fun AutomationConfigurationWelcome(modifier: Modifier = Modifier) {
  Column(modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Text(stringResource(R.string.automation_setup_heading), style = MaterialTheme.typography.headlineSmall,
      textAlign = TextAlign.Center)
    Text(stringResource(R.string.automation_setup_hint), color = MaterialTheme.colorScheme.onSurfaceVariant,
      style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
  }
}

@Composable
internal fun AutomationIdeas(projectScoped: Boolean = false, showIntro: Boolean = false, onSelect: (String) -> Unit) {
  Column(Modifier.fillMaxWidth().testTag("automation-ideas"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    if (showIntro) {
      Icon(painterResource(R.drawable.action_clock), null, Modifier.align(Alignment.CenterHorizontally).size(28.dp),
        tint = MaterialTheme.colorScheme.onSurfaceVariant)
      AutomationConfigurationWelcome(Modifier.padding(bottom = 12.dp))
    }
    Text(stringResource(R.string.automation_ideas_title), Modifier.padding(horizontal = 8.dp),
      style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    automationIdeas.forEach { idea ->
      val prompt = stringResource(if (projectScoped && idea.id == "project")
        R.string.automation_idea_current_project_prompt else idea.promptRes)
      Card(onClick = { onSelect(prompt) }, modifier = Modifier.fillMaxWidth().testTag("automation-idea-${idea.id}"),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp),
          verticalAlignment = Alignment.CenterVertically) {
          Icon(painterResource(idea.iconRes), null, Modifier.size(20.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(stringResource(idea.titleRes), style = MaterialTheme.typography.titleSmall)
            Text(stringResource(idea.summaryRes), style = MaterialTheme.typography.bodySmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
          Icon(painterResource(R.drawable.action_chevron_right), null, Modifier.size(16.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}
