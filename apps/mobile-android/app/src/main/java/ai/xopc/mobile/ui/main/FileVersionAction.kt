package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ManagedFile
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun FileVersionAction(file: ManagedFile?, save: suspend (ManagedFile, String) -> Unit) {
  if (file?.canSaveVersion != true) return
  var pendingId by rememberSaveable(file.id, file.revision) { mutableStateOf<String?>(null) }
  var saving by remember(file.id, file.revision) { mutableStateOf(false) }
  var feedback by remember(file.id, file.revision) { mutableStateOf<Int?>(null) }
  val scope = rememberCoroutineScope()
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    TextButton(onClick = {
      if (!saving) {
        val requestId = pendingId ?: UUID.randomUUID().toString().also { pendingId = it }
        saving = true
        feedback = null
        scope.launch {
          try {
            save(file, requestId)
            pendingId = null
            feedback = R.string.file_version_saved
          } catch (error: CancellationException) {
            throw error
          } catch (_: Exception) {
            feedback = R.string.file_version_error
          } finally {
            saving = false
          }
        }
      }
    }, enabled = !saving, modifier = Modifier.testTag("file-save-version")) {
      Text(stringResource(R.string.file_save_version))
    }
    if (saving) BrandLoadingIndicator(extent = 20.dp)
    feedback?.let {
      Text(stringResource(it), style = MaterialTheme.typography.bodySmall,
        color = if (it == R.string.file_version_error) MaterialTheme.colorScheme.error
        else MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
