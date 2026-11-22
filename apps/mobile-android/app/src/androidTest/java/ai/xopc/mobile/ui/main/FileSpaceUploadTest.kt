package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.GatewayHttpException
import ai.xopc.mobile.gateway.ManagedFile
import ai.xopc.mobile.gateway.ManagedFileSpace
import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.app.ActivityOptionsCompat
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class FileSpaceUploadTest {
  @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

  @Test fun writableFolderUploadsAndRefreshesAfterRenamingConflict() {
    val selected = Uri.parse("content://xopc.test/report.txt")
    val picker = object : ActivityResultRegistryOwner {
      override val activityResultRegistry = object : ActivityResultRegistry() {
        override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>,
          input: I, options: ActivityOptionsCompat?) {
          dispatchResult(requestCode, Activity.RESULT_OK, Intent().setData(selected))
        }
      }
    }
    val attempts = mutableListOf<List<String?>>()
    val folder = ManagedFile("folder", "writable", "Reports", "Reports", "directory", "", 0)
    var uploaded: ManagedFile? = null
    rule.setContent {
      CompositionLocalProvider(LocalActivityResultRegistryOwner provides picker) {
        NotesScreen(NotesUiState(gatewayId = "gateway"), PaddingValues(), { _, _ -> }, {}, {},
          onNoteFileSpaces = { listOf(ManagedFileSpace("readonly", "Read only", false),
            ManagedFileSpace("writable", "Writable", true)) },
          onNoteFiles = { space, path, _ ->
            when {
              space != "writable" -> emptyList()
              path.isEmpty() -> listOf(folder)
              else -> listOfNotNull(uploaded)
            }
          },
          onUploadSpaceFile = { gatewayId, space, path, uri, renamed ->
            attempts += listOf(gatewayId, space, path, uri.toString(), renamed)
            if (renamed == null) throw GatewayHttpException(409)
            ManagedFile("uploaded", space, renamed, "$path/$renamed", "file", "text/plain", 8)
              .also { uploaded = it }
          },
          onExit = {})
      }
    }
    rule.onNodeWithTag("notes-open-files").performClick()
    rule.onNodeWithTag("notes-file-upload").assertDoesNotExist()
    rule.onNodeWithTag("notes-space-readonly").performClick()
    rule.onNodeWithTag("notes-file-upload").assertDoesNotExist()
    rule.onNodeWithTag("notes-back").performClick()
    rule.onNodeWithTag("notes-space-writable").performClick()
    rule.onNodeWithTag("notes-file-folder").performClick()
    rule.onNodeWithTag("notes-file-upload").performClick()
    rule.onNodeWithTag("notes-file-upload-name").performTextInput("report-copy.txt")
    rule.onNodeWithTag("notes-file-upload-rename").performClick()
    rule.onNodeWithTag("notes-file-uploaded").assertExists()
    assertEquals(listOf(listOf("gateway", "writable", "Reports", selected.toString(), null),
      listOf("gateway", "writable", "Reports", selected.toString(), "report-copy.txt")), attempts)
  }
}
