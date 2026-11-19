package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ChatProjectComparison
import androidx.a2ui.compose.runtime.A2uiMessageParser
import androidx.a2ui.compose.ui.A2uiMessageProcessor
import androidx.a2ui.compose.ui.catalog.A2uiBasicCatalogV1
import androidx.a2ui.model.catalog.functions.A2uiLocaleProvider
import androidx.a2ui.model.processor.processInput
import androidx.a2ui.model.protocol.A2uiClientErrorMessage
import androidx.a2ui.model.protocol.A2uiClientEventMessage
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.material3.a2ui.A2uiSurface
import androidx.compose.material3.a2ui.catalog.MaterialA2uiBasicCatalogV1Defaults
import androidx.compose.material3.a2ui.catalog.materialA2uiBasicCatalogV1
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

private val comparisonPath = Regex("/(selection|project_[0-3]/status)")
private val patchesBySurface = LinkedHashMap<String, Map<String, JSONObject>>()
internal val LocalProjectComparisonAction = staticCompositionLocalOf<suspend (String) -> String> {
  { error("UNAVAILABLE") }
}

@Composable
internal fun ProjectComparisonPanel(comparison: ChatProjectComparison) {
  val context = LocalContext.current.applicationContext
  val submitAction by rememberUpdatedState(LocalProjectComparisonAction.current)
  val parser = remember { A2uiMessageParser() }
  val processor = remember(comparison) {
    A2uiMessageProcessor(catalogs = listOf(materialA2uiBasicCatalogV1(
      image = MaterialA2uiBasicCatalogV1Defaults.image { _, _, _, _, _ -> },
      video = MaterialA2uiBasicCatalogV1Defaults.video { _, _, _ -> },
      audioPlayer = MaterialA2uiBasicCatalogV1Defaults.audioPlayer { _, _, _, _ -> },
      functions = A2uiBasicCatalogV1.Functions(context, A2uiLocaleProvider.Default),
    )))
  }
  var failed by remember(comparison.surfaceId) { mutableStateOf(false) }
  val surfaces by processor.activeSurfaces.collectAsState()
  LaunchedEffect(processor) {
    launch(Dispatchers.Default) { processor.collectMessages() }
    launch(start = CoroutineStart.UNDISPATCHED) {
      processor.outboundEvents.collect { event ->
        when (event) {
          is A2uiClientErrorMessage -> failed = true
          is A2uiClientEventMessage -> {
            if (event.type != "inspectProject" || event.surfaceId != comparison.surfaceId) return@collect
            failed = false
            try {
              val body = JSONObject().put("version", "v0.9").put("action",
                JSONObject().put("name", event.type).put("surfaceId", event.surfaceId)
                  .put("sourceComponentId", event.componentId).put("timestamp", Instant.now().toString())
                  .put("context", JSONObject(event.context)))
              val response = JSONObject(submitAction(body.toString())).getJSONArray("messages")
              check(response.length() == 2)
              val patches = (0 until response.length()).associate { index ->
                val packet = response.getJSONObject(index)
                val update = packet.getJSONObject("updateDataModel")
                val path = update.getString("path")
                check(packet.getString("version") == "v0.9" && update.getString("surfaceId") == comparison.surfaceId &&
                  comparisonPath.matches(path))
                path to packet
              }
              val prior = patchesBySurface.remove(comparison.surfaceId).orEmpty()
              patchesBySurface[comparison.surfaceId] = prior + patches
              if (patchesBySurface.size > 100) patchesBySurface.remove(patchesBySurface.keys.first())
              patches.values.forEach { processor.processInput(parser, it.toString()) }
            } catch (error: CancellationException) {
              throw error
            } catch (_: Exception) {
              failed = true
            }
          }
        }
      }
    }
    comparison.messages.forEach { processor.processInput(parser, it) }
    patchesBySurface[comparison.surfaceId]?.values?.forEach { processor.processInput(parser, it.toString()) }
  }
  Column(Modifier.fillMaxWidth().testTag("project-comparison-${comparison.surfaceId}")) {
    surfaces.firstOrNull { it.id == comparison.surfaceId }?.let { A2uiSurface(surfaceModel = it) }
    if (failed) Text(stringResource(R.string.chat_project_comparison_failed))
  }
}
