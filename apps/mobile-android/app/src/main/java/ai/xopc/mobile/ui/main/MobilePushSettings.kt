package ai.xopc.mobile.ui.main

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.MobilePushClient
import ai.xopc.mobile.gateway.MobilePushInbox
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun MobilePushSettings(profile: GatewayProfile, client: MobilePushClient) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val registered by client.enabled.collectAsStateWithLifecycle()
  val revision by MobilePushInbox.tokenRevision.collectAsStateWithLifecycle()
  val device = client.scope(profile)
  val enabled = device in registered
  var busy by remember(device) { mutableStateOf(false) }
  var error by remember(device) { mutableStateOf<Int?>(null) }
  fun update(value: Boolean) {
    scope.launch {
      busy = true
      error = null
      try { client.setEnabled(profile, value, revision) }
      catch (failure: CancellationException) { throw failure }
      catch (failure: Exception) {
        error = when (failure.message) {
          "PUSH_NOT_CONFIGURED" -> R.string.push_unconfigured
          "PUSH_PERMISSION_DENIED" -> R.string.push_permission
          else -> R.string.push_registration_failed
        }
      } finally { busy = false }
    }
  }
  val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) update(true) else error = R.string.push_permission
  }
  Column(Modifier.fillMaxWidth().padding(12.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Column(Modifier.weight(1f)) {
        Text(stringResource(R.string.push_title))
        Text(stringResource(if (enabled) R.string.push_on else R.string.push_off),
          style = MaterialTheme.typography.bodySmall)
      }
      Button(enabled = !busy, onClick = {
        if (enabled) update(false)
        else if (Build.VERSION.SDK_INT >= 33 && !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
          permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else update(true)
      }) {
        Text(stringResource(if (enabled) R.string.push_disable else R.string.push_enable))
      }
    }
    error?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
  }
}
