package ai.xopc.mobile.ui.main

import android.Manifest
import android.content.Intent
import android.provider.Settings
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayHttpException
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.MobilePushClient
import ai.xopc.mobile.gateway.MobilePushInbox
import ai.xopc.mobile.theme.themedCorners
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable
internal fun MobilePushSettings(profile: GatewayProfile, client: MobilePushClient) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  val registered by client.enabled.collectAsStateWithLifecycle()
  val restoreFailures by client.restoreFailures.collectAsStateWithLifecycle()
  val revision by MobilePushInbox.tokenRevision.collectAsStateWithLifecycle()
  val device = client.scope(profile)
  val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsStateWithLifecycle()
  val title = stringResource(R.string.push_setting_title)
  var permissionBlocked by remember { mutableStateOf(!NotificationManagerCompat.from(context).areNotificationsEnabled()) }
  var busy by remember(device) { mutableStateOf(false) }
  var retryValue by remember(device) { mutableStateOf(true) }
  var error by remember(device) { mutableStateOf<Int?>(null) }
  LaunchedEffect(lifecycle) {
    if (lifecycle.isAtLeast(Lifecycle.State.RESUMED)) {
      permissionBlocked = !NotificationManagerCompat.from(context).areNotificationsEnabled()
    }
  }

  fun update(value: Boolean) {
    scope.launch {
      busy = true
      retryValue = value
      error = null
      try { client.setEnabled(profile, value, revision) }
      catch (failure: CancellationException) { throw failure }
      catch (failure: Exception) {
        if (failure.message == "PUSH_PERMISSION_DENIED") permissionBlocked = true
        else error = pushFailureMessage(failure)
      } finally { busy = false }
    }
  }

  val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    permissionBlocked = !granted
    if (granted) update(true)
  }
  Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainerLow, themedCorners(16))
    .padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(12.dp)) {
      Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(stringResource(R.string.push_description),
          style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
      else Switch(checked = device in registered && !permissionBlocked,
        modifier = Modifier.testTag("push-switch").semantics { contentDescription = title },
        onCheckedChange = { value ->
          if (value && Build.VERSION.SDK_INT >= 33 && permissionBlocked) {
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
          } else update(value)
        })
    }
    if (!busy && permissionBlocked) {
      Text(stringResource(R.string.push_permission), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
      TextButton(onClick = {
        context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
          .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName))
      }, modifier = Modifier.testTag("push-system-settings")) { Text(stringResource(R.string.push_system_settings)) }
    } else if (!busy) {
      (error ?: restoreFailures[device]?.let(::pushFailureMessage))?.let {
        Text(stringResource(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick = { update(if (error == null) true else retryValue) }, modifier = Modifier.testTag("push-retry")) {
          Text(stringResource(R.string.push_retry))
        }
      }
    }
  }
}

private fun pushFailureMessage(failure: Exception): Int = when {
  failure.message == "PUSH_NOT_CONFIGURED" -> R.string.push_unconfigured
  (failure as? GatewayHttpException)?.code == "PUSH_CLOUD_AUTH_REQUIRED" -> R.string.push_cloud_auth_required
  (failure as? GatewayHttpException)?.code == "PUSH_PLATFORM_UNAVAILABLE" -> R.string.push_cloud_unavailable
  failure is java.io.IOException -> R.string.push_gateway_unreachable
  failure is java.util.concurrent.ExecutionException || failure is java.util.concurrent.TimeoutException -> R.string.push_token_unavailable
  else -> R.string.push_registration_failed
}
