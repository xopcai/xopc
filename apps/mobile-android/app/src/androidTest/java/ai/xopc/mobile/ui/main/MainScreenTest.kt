package ai.xopc.mobile.ui.main

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.content.ContentValues
import android.graphics.Bitmap
import android.provider.MediaStore
import android.view.accessibility.AccessibilityNodeInfo
import ai.xopc.mobile.R
import ai.xopc.mobile.theme.XopcTheme
import ai.xopc.mobile.gateway.ConversationSummary
import ai.xopc.mobile.gateway.ConversationTaskChild
import ai.xopc.mobile.gateway.ConversationTaskGroup
import ai.xopc.mobile.gateway.ConversationSharePreview
import ai.xopc.mobile.gateway.ConversationShare
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.gateway.PendingInput
import ai.xopc.mobile.gateway.ConversationModel
import ai.xopc.mobile.gateway.ConversationAgent
import ai.xopc.mobile.gateway.ConversationContext
import ai.xopc.mobile.gateway.ConversationMessage
import ai.xopc.mobile.gateway.ConversationMedia
import ai.xopc.mobile.gateway.ConversationReference
import ai.xopc.mobile.gateway.ConversationTarget
import ai.xopc.mobile.gateway.ConversationArtifact
import ai.xopc.mobile.gateway.ConversationOutcome
import ai.xopc.mobile.gateway.ExecutionDetail
import ai.xopc.mobile.gateway.ExecutionStep
import ai.xopc.mobile.gateway.ContextWorkItem
import ai.xopc.mobile.gateway.ContextEnvironment
import ai.xopc.mobile.gateway.ContextSource
import ai.xopc.mobile.gateway.TaskWelcomeInfo
import ai.xopc.mobile.gateway.ProjectWelcomeInfo
import ai.xopc.mobile.gateway.ProgressAction
import ai.xopc.mobile.gateway.ProgressHomeAction
import ai.xopc.mobile.gateway.ProgressItem
import ai.xopc.mobile.gateway.ProgressTask
import ai.xopc.mobile.gateway.ProgressProject
import ai.xopc.mobile.gateway.AutomationSummary
import ai.xopc.mobile.gateway.AutomationMetrics
import ai.xopc.mobile.gateway.AutomationMetricsNext
import ai.xopc.mobile.gateway.NoteSummary
import ai.xopc.mobile.gateway.NoteDetail
import ai.xopc.mobile.gateway.PersonalSummary
import ai.xopc.mobile.gateway.PersonalCounts
import ai.xopc.mobile.gateway.PersonalGoal
import ai.xopc.mobile.gateway.PersonalAssertion
import ai.xopc.mobile.gateway.ConversationContextRef
import ai.xopc.mobile.gateway.ChatAttachment
import ai.xopc.mobile.gateway.ChatAttachmentStore
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import ai.xopc.mobile.gateway.ShareItem
import java.time.Instant
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.runtime.mutableStateOf
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import java.io.File
import java.io.FileOutputStream
import java.io.ByteArrayOutputStream

class MainScreenTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun assistantComposerAndTabDockShareOneBottomSurface() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          selectedConversationId = "11111111-2222-3333-4444-555555555555"))
    }

    val composerBounds = composeTestRule.onAllNodesWithTag("assistant-bottom-surface")
      .fetchSemanticsNodes().single().boundsInRoot
    val dockBounds = composeTestRule.onAllNodesWithTag("main-tab-dock")
      .fetchSemanticsNodes().single().boundsInRoot
    val inputBounds = composeTestRule.onAllNodesWithTag("assistant-input")
      .fetchSemanticsNodes().single().boundsInRoot
    assertTrue(composerBounds.top <= inputBounds.top)
    assertTrue(composerBounds.bottom >= dockBounds.bottom)
    assertTrue(inputBounds.bottom <= dockBounds.top)
  }

  @Test fun tappingChatContentDismissesComposerFocus() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = "test"))
    }

    composeTestRule.onNodeWithTag("assistant-input").performClick()
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
    composeTestRule.onNodeWithTag("assistant-welcome").performTouchInput { click() }
    composeTestRule.onNodeWithTag("assistant-input").assertIsNotFocused()
  }

  @Test fun messageReferencesTargetsAndAttachmentPreviewAreInteractive() {
    val id = "11111111-2222-3333-4444-555555555555"
    val media = ConversationMedia("media-1", "brief.txt", "document", "text/plain", 5,
      "data:text/plain;base64,aGVsbG8=")
    val user = ConversationMessage("user-1", "user", "Review this", hasNonTextContent = true,
      media = listOf(media), references = listOf(ConversationReference("note", "note-1", "3", "Brief")))
    val assistant = ConversationMessage("assistant-1", "assistant", "Created [task](/tasks/task-1)",
      targets = listOf(ConversationTarget("task", "task-1", "Ship", capabilities = listOf("open"))),
      outcome = ConversationOutcome("succeeded", "Created report", listOf(ConversationArtifact(
        "artifact-1", "report.md", "document", "text/markdown", 6, "available", "artifact_store",
        listOf("preview"), "data:text/markdown;base64,cmVwb3J0", null, null))))
    var selectedTab = HomeTab.Assistant
    var openedNote = ""
    var openedTask = ""
    composeTestRule.setContent {
      XopcTheme {
      MainContent(selectedTab = selectedTab, onSelectTab = { selectedTab = it },
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, messages = listOf(user, assistant)),
        onOpenNote = { openedNote = it }, onOpenProgressTask = { openedTask = it },
        onLoadMessageMedia = { _, _ -> "hello".toByteArray() })
      }
    }
    saveAcceptanceScreenshot("message-parity-chat.png")
    val userBounds = composeTestRule.onNodeWithTag("message-more-user-1")
      .fetchSemanticsNode().boundsInRoot
    val assistantBounds = composeTestRule.onNodeWithTag("message-assistant-card-assistant-1", useUnmergedTree = true)
      .fetchSemanticsNode().boundsInRoot
    val actionsBounds = composeTestRule.onNodeWithTag("message-more-assistant-1")
      .fetchSemanticsNode().boundsInRoot
    assertTrue(userBounds.left > assistantBounds.left)
    assertTrue(userBounds.right > assistantBounds.right)
    assertTrue(actionsBounds.top >= assistantBounds.bottom)
    composeTestRule.onNodeWithTag("message-reference-note-note-1").performClick()
    composeTestRule.runOnIdle {
      assertEquals("note-1", openedNote)
      assertEquals(HomeTab.Notes, selectedTab)
      selectedTab = HomeTab.Assistant
    }
    composeTestRule.onNodeWithTag("message-media-media-1").performClick()
    composeTestRule.onNodeWithTag("message-media-preview-text").assertTextContains("hello")
    saveAcceptanceScreenshot("message-parity-preview.png", "message-media-preview")
    composeTestRule.onNodeWithTag("message-media-preview-close").performClick()
    composeTestRule.onNodeWithTag("message-artifact-artifact-1").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("message-media-preview-text").assertTextContains("hello")
    composeTestRule.onNodeWithTag("message-media-preview-close").performClick()
    composeTestRule.onNodeWithTag("message-target-task-task-1").performScrollTo().performClick()
    composeTestRule.runOnIdle {
      assertEquals("task-1", openedTask)
      assertEquals(HomeTab.Progress, selectedTab)
    }
  }

  @Test fun userImageVoiceAndFileAttachmentsMatchTheHarmonyDisclosureLayout() {
    val id = "11111111-2222-3333-4444-555555555555"
    val png = ByteArrayOutputStream().use { output ->
      Bitmap.createBitmap(12, 12, Bitmap.Config.ARGB_8888).also {
        it.eraseColor(android.graphics.Color.BLUE)
      }.compress(Bitmap.CompressFormat.PNG, 100, output)
      output.toByteArray()
    }
    val media = listOf(
      ConversationMedia("audio-1", "voice.m4a", "audio", "audio/mp4", 2048, "media://audio-1"),
      ConversationMedia("image-1", "one.png", "image", "image/png", png.size.toLong(), "media://image-1"),
      ConversationMedia("image-2", "two.png", "image", "image/png", png.size.toLong(), "media://image-2"),
      ConversationMedia("file-1", "one.txt", "document", "text/plain", 3, "media://file-1"),
      ConversationMedia("file-2", "two.pdf", "document", "application/pdf", 4, "media://file-2"),
      ConversationMedia("file-3", "three.json", "document", "application/json", 5, "media://file-3"),
      ConversationMedia("file-4", "four.csv", "document", "text/csv", 6, "media://file-4"))
    composeTestRule.setContent {
      XopcTheme {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id,
          messages = listOf(ConversationMessage("user-media", "user", "请查看", media = media))),
        onLoadMessageMedia = { _, item -> if (item.mimeType.startsWith("image/")) png else "abc".toByteArray() })
      }
    }
    composeTestRule.onNodeWithTag("message-audio-audio-1").assertExists()
    val audioBounds = composeTestRule.onNodeWithTag("message-audio-audio-1")
      .fetchSemanticsNode().boundsInRoot
    val bubbleBounds = composeTestRule.onNodeWithTag("message-more-user-media")
      .fetchSemanticsNode().boundsInRoot
    assertTrue(audioBounds.width < bubbleBounds.width)
    composeTestRule.onNodeWithTag("message-image-strip-user-media", useUnmergedTree = true).assertExists()
    composeTestRule.onNodeWithTag("message-image-thumbnail-image-1", useUnmergedTree = true).assertExists()
    saveAcceptanceScreenshot("message-media-layout.png")
    composeTestRule.onNodeWithTag("message-image-image-1").performClick()
    composeTestRule.onNodeWithTag("message-media-preview-image").assertExists()
    composeTestRule.onNodeWithTag("message-image-next").performClick()
    composeTestRule.onNodeWithText("two.png").assertExists()
    composeTestRule.onNodeWithTag("message-media-preview-close").performClick()

    composeTestRule.onNodeWithTag("message-attachments-toggle-user-media").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("message-media-file-4").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("message-media-preview-text").assertTextContains("abc")
    composeTestRule.onNodeWithTag("message-media-preview-close").performClick()

    composeTestRule.onNodeWithTag("message-media-file-2").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("message-media-preview-binary").assertExists()
    composeTestRule.onNodeWithTag("message-media-open-system").assertExists()
    composeTestRule.onNodeWithTag("message-media-preview-close").performClick()

    composeTestRule.onNodeWithTag("message-audio-audio-1").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("message-media-preview-audio").assertExists()
    saveAcceptanceScreenshot("message-audio-preview.png", "message-media-preview")
  }

  @Test fun failedAssistantOutcomeKeepsAVisibleStatusInsideItsCard() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      XopcTheme {
        MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
          connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
            selectedConversationId = id, messages = listOf(ConversationMessage("failed-answer", "assistant", "",
              outcome = ConversationOutcome("failed", null, emptyList())))))
      }
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.message_result_failed)).assertExists()
  }

  @Test fun assistantMarkdownLinkStaysInlineAndOpensItsTarget() {
    val id = "11111111-2222-3333-4444-555555555555"
    var openedTask = ""
    composeTestRule.setContent {
      XopcTheme {
        MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
          connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
            selectedConversationId = id,
            messages = listOf(ConversationMessage("linked-answer", "assistant", "[task](/tasks/task-1)"))),
          onOpenProgressTask = { openedTask = it })
      }
    }
    composeTestRule.onNodeWithText("task").performClick()
    assertEquals("task-1", openedTask)
  }

  private fun saveAcceptanceScreenshot(name: String, tag: String? = null) {
    val node = if (tag == null) composeTestRule.onAllNodes(isRoot()).onFirst()
      else composeTestRule.onNodeWithTag(tag)
    val image = node.captureToImage().asAndroidBitmap()
    val file = File(composeTestRule.activity.getExternalFilesDir(null), name)
    FileOutputStream(file).use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
  }

  @Test fun photoActionOpensSystemPickerAndCancelReturnsWithoutAddingAnAttachment() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val conversationId = "11111111-2222-3333-4444-555555555555"
    var added = 0
    composeTestRule.setContent {
      MainScreen(connection = ConnectionUiState(profile = profile,
        selectedConversationId = conversationId, realtimeStatus = "connected"),
        onAddDraftAttachment = { _, _, _ -> added++ })
    }
    val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
    val ownPackage = composeTestRule.activity.packageName
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-photos").performClick()
    try {
      composeTestRule.waitUntil(10_000) {
        val foreground = automation.rootInActiveWindow?.packageName?.toString()
        foreground != null && foreground != ownPackage
      }
    } finally {
      automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    }
    composeTestRule.waitUntil(10_000) {
      automation.rootInActiveWindow?.packageName?.toString() == ownPackage
    }
    composeTestRule.onNodeWithTag("assistant-input").assertExists()
    assertEquals(0, added)
  }

  @Test fun systemPhotoSelectionReturnsToTheSameConversationAndSnapshotsTheImage() {
    val context = composeTestRule.activity
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val name = "xopc-picker-e2e-${UUID.randomUUID()}.jpg"
    val source = context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
      ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, "image/jpeg")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }) ?: throw AssertionError("Test image creation failed")
    val store = ChatAttachmentStore(context)
    try {
      context.contentResolver.openOutputStream(source)!!.use { output ->
        Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.JPEG, 90, output)
      }
      context.contentResolver.update(source, ContentValues().apply {
        put(MediaStore.MediaColumns.IS_PENDING, 0)
      }, null, null)
      val expectedBytes = context.contentResolver.openInputStream(source)!!.use { it.readBytes() }
      val captured = AtomicReference<ChatAttachment?>()
      val returnedConversationId = AtomicReference<String?>()
      composeTestRule.setContent {
        MainScreen(connection = ConnectionUiState(profile = GatewayProfile(gatewayId,
          "Test", "key", "device", emptyList(), ""), selectedConversationId = conversationId,
          realtimeStatus = "connected"),
          onAddDraftAttachment = { returnedGatewayId, returnedId, uri ->
            assertEquals(gatewayId, returnedGatewayId)
            returnedConversationId.set(returnedId)
            captured.set(store.import(returnedGatewayId, returnedId, uri))
          })
      }
      val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
      composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
      composeTestRule.onNodeWithTag("assistant-action-photos").performClick()
      composeTestRule.waitUntil(10_000) {
        val foreground = automation.rootInActiveWindow?.packageName?.toString()
        foreground != null && foreground != context.packageName
      }
      fun findPhotoItem(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isClickable && node.className == "android.widget.FrameLayout") {
          fun hasThumbnail(child: AccessibilityNodeInfo?): Boolean {
            if (child == null) return false
            if (child.viewIdResourceName?.endsWith(":id/icon_thumbnail") == true) return true
            return (0 until child.childCount).any { hasThumbnail(child.getChild(it)) }
          }
          if (hasThumbnail(node)) return node
        }
        for (index in 0 until node.childCount) {
          findPhotoItem(node.getChild(index))?.let { return it }
        }
        return null
      }
      try {
        composeTestRule.waitUntil(10_000) { findPhotoItem(automation.rootInActiveWindow) != null }
        val item = findPhotoItem(automation.rootInActiveWindow)
        check(item?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true) { "PHOTO_PICKER_ITEM_UNAVAILABLE" }
        composeTestRule.waitUntil(10_000) { captured.get() != null }
      } finally {
        if (captured.get() == null) automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
      }
      assertEquals(conversationId, returnedConversationId.get())
      assertEquals("image", captured.get()?.type)
      assertEquals(listOf(captured.get()), store.list(gatewayId, conversationId))
      val payload = store.wirePayloads(gatewayId, conversationId, listOf(captured.get()!!))
      assert(expectedBytes.contentEquals(java.util.Base64.getDecoder().decode(
        payload.getJSONObject(0).getString("data"))))
    } finally {
      runCatching { context.contentResolver.delete(source, null, null) }
      store.removeGateway(gatewayId)
    }
  }

  @Test fun cameraCancelReturnsToConversationWithoutAttachment() {
    val profile = GatewayProfile(UUID.randomUUID().toString(), "Test", "key", "device", emptyList(), "")
    val conversationId = UUID.randomUUID().toString()
    var added = 0
    composeTestRule.setContent {
      MainScreen(connection = ConnectionUiState(profile = profile,
        selectedConversationId = conversationId, realtimeStatus = "connected"),
        onAddCapturedDraftAttachment = { _, _, _ -> added++ })
    }
    val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
    val ownPackage = composeTestRule.activity.packageName
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-camera").performClick()
    try {
      composeTestRule.waitUntil(10_000) {
        automation.rootInActiveWindow?.packageName?.toString() == "com.android.camera2"
      }
    } finally {
      automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
    }
    composeTestRule.waitUntil(10_000) {
      automation.rootInActiveWindow?.packageName?.toString() == ownPackage
    }
    composeTestRule.onNodeWithTag("assistant-input").assertExists()
    assertEquals(0, added)
  }

  @Test fun cameraShutterReturnsToTheSameConversationAndSnapshotsPhoto() {
    val context = composeTestRule.activity
    val gatewayId = UUID.randomUUID().toString()
    val conversationId = UUID.randomUUID().toString()
    val store = ChatAttachmentStore(context)
    val captured = AtomicReference<ChatAttachment?>()
    val returnedConversationId = AtomicReference<String?>()
    try {
      composeTestRule.setContent {
        MainScreen(connection = ConnectionUiState(profile = GatewayProfile(gatewayId,
          "Test", "key", "device", emptyList(), ""), selectedConversationId = conversationId,
          realtimeStatus = "connected"),
          onAddCapturedDraftAttachment = { returnedGatewayId, returnedId, uri ->
            assertEquals(gatewayId, returnedGatewayId)
            returnedConversationId.set(returnedId)
            captured.set(store.import(returnedGatewayId, returnedId, uri))
          })
      }
      val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
      composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
      composeTestRule.onNodeWithTag("assistant-action-camera").performClick()
      composeTestRule.waitUntil(10_000) {
        automation.rootInActiveWindow?.packageName?.toString() == "com.android.camera2"
      }
      fun findShutter(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        if (node == null) return null
        if (node.isClickable && (node.viewIdResourceName?.contains("shutter") == true ||
          node.contentDescription?.toString()?.contains("shutter", ignoreCase = true) == true)) return node
        for (index in 0 until node.childCount) {
          findShutter(node.getChild(index))?.let { return it }
        }
        return null
      }
      try {
        composeTestRule.waitUntil(10_000) { findShutter(automation.rootInActiveWindow) != null }
      } catch (error: androidx.compose.ui.test.ComposeTimeoutException) {
        val nodes = mutableListOf<String>()
        fun inspect(node: AccessibilityNodeInfo?) {
          if (node == null || nodes.size >= 80) return
          nodes += "${node.className}:${node.viewIdResourceName}:${node.contentDescription}:${node.isClickable}"
          for (index in 0 until node.childCount) inspect(node.getChild(index))
        }
        inspect(automation.rootInActiveWindow)
        throw AssertionError("Camera shutter not exposed: $nodes", error)
      }
      try {
        check(findShutter(automation.rootInActiveWindow)?.performAction(
          AccessibilityNodeInfo.ACTION_CLICK) == true) { "CAMERA_SHUTTER_UNAVAILABLE" }
        fun findDone(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
          if (node == null) return null
          if (node.viewIdResourceName == "com.android.camera2:id/done_button") return node
          for (index in 0 until node.childCount) {
            findDone(node.getChild(index))?.let { return it }
          }
          return null
        }
        composeTestRule.waitUntil(10_000) { findDone(automation.rootInActiveWindow) != null }
        check(findDone(automation.rootInActiveWindow)?.performAction(
          AccessibilityNodeInfo.ACTION_CLICK) == true) { "CAMERA_CONFIRM_UNAVAILABLE" }
        try {
          composeTestRule.waitUntil(15_000) { captured.get() != null }
        } catch (error: androidx.compose.ui.test.ComposeTimeoutException) {
          val nodes = mutableListOf<String>()
          fun inspect(node: AccessibilityNodeInfo?) {
            if (node == null || nodes.size >= 80) return
            nodes += "${node.className}:${node.viewIdResourceName}:${node.contentDescription}:${node.text}:${node.isClickable}"
            for (index in 0 until node.childCount) inspect(node.getChild(index))
          }
          inspect(automation.rootInActiveWindow)
          throw AssertionError("Camera after shutter: ${automation.rootInActiveWindow?.packageName}: $nodes", error)
        }
      } finally {
        if (captured.get() == null) automation.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
      }
      assertEquals(conversationId, returnedConversationId.get())
      assertEquals("image", captured.get()?.type)
      assertEquals(listOf(captured.get()), store.list(gatewayId, conversationId))
      val payload = store.wirePayloads(gatewayId, conversationId, listOf(captured.get()!!))
      assert(payload.getJSONObject(0).getString("data").isNotEmpty())
    } finally {
      store.removeGateway(gatewayId)
    }
  }

  @Test fun progressDockBadgeTracksCurrentGatewayAttention() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val item = ProgressItem("attention-1", "Decision", "Choose", null, null, null)
    var homeRefreshes = 0
    var taskRefreshes = 0
    val connection = mutableStateOf(ConnectionUiState(profile = profile,
      progress = ProgressUiState(gatewayId = "gateway", needsUser = listOf(item))))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = connection.value,
        onRefreshProgressHome = { homeRefreshes++ }, onRefreshProgressTasks = { taskRefreshes++ })
    }
    composeTestRule.runOnIdle { assert(homeRefreshes == 1 && taskRefreshes == 0) }
    composeTestRule.onNodeWithTag("progress-attention-badge", useUnmergedTree = true)
      .assertTextEquals("1")
    composeTestRule.runOnIdle {
      connection.value = connection.value.copy(progress = ProgressUiState(gatewayId = "gateway",
        needsUser = List(100) { index -> item.copy(id = "attention-$index") }))
    }
    composeTestRule.onNodeWithTag("progress-attention-badge", useUnmergedTree = true)
      .assertTextEquals("99+")
    composeTestRule.runOnIdle {
      connection.value = connection.value.copy(progress = ProgressUiState(gatewayId = "other",
        needsUser = listOf(item)))
    }
    composeTestRule.onNodeWithTag("progress-attention-badge", useUnmergedTree = true)
      .assertDoesNotExist()
  }

  @Test fun unpairedMeKeepsSettingsAndPairingReachable() {
    var pairCalls = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {},
        connection = ConnectionUiState(), onPair = { pairCalls++ })
    }
    composeTestRule.onNodeWithTag("personal-unpaired").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertExists()
    composeTestRule.onNodeWithTag("personal-settings").performClick()
    composeTestRule.onNodeWithTag("settings-screen").assertExists()
    composeTestRule.onNodeWithText("Language").performClick()
    composeTestRule.onNodeWithTag("language-zh-CN").assertExists()
    composeTestRule.onNodeWithTag("settings-back").performClick()
    composeTestRule.onNodeWithText("Appearance").performClick()
    composeTestRule.onNodeWithTag("appearance-dark").assertExists()
    composeTestRule.onNodeWithTag("settings-back").performClick()
    composeTestRule.onNodeWithTag("settings-back").performClick()
    composeTestRule.onNodeWithTag("personal-connect").performClick()
    composeTestRule.onNodeWithTag("pairing-scan").assertExists()
    composeTestRule.onNodeWithTag("pairing-manual").performClick()
    composeTestRule.onNodeWithTag("pairing-link").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertDoesNotExist()
    composeTestRule.onNodeWithTag("pairing-back").performClick()
    composeTestRule.onNodeWithTag("personal-unpaired").assertExists()
    assert(pairCalls == 0)
  }

  @Test fun unpairedGatewayUsesQrScanAsThePrimaryAction() {
    var scans = 0
    var pairs = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(), onPair = { pairs++ }, onScanPairing = { scans++ })
    }
    composeTestRule.onNodeWithTag("pairing-scan").assertIsEnabled().performClick()
    composeTestRule.runOnIdle {
      assertEquals(1, scans)
      assertEquals(0, pairs)
    }
    composeTestRule.onNodeWithTag("pairing-manual").performClick()
    composeTestRule.onNodeWithTag("pairing-link").assertExists()
    composeTestRule.onNodeWithTag("pairing-back-to-scan").performClick()
    composeTestRule.onNodeWithTag("pairing-scan").assertExists()
  }

  @Test fun gatewayQrScanOpensLiveCameraWithoutAPhotoShutter() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val packageName = composeTestRule.activity.packageName
    instrumentation.uiAutomation.executeShellCommand("pm grant $packageName ${Manifest.permission.CAMERA}").close()
    composeTestRule.setContent { MainScreen() }
    composeTestRule.onNodeWithTag("pairing-scan").performClick()
    composeTestRule.onNodeWithTag("pairing-scanner").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.pairing_scanner_hint)).assertExists()
    composeTestRule.onNodeWithTag("pairing-scanner-close").performClick()
    composeTestRule.onNodeWithTag("pairing-scanner").assertDoesNotExist()
  }

  @Test fun settingsOpensShareCenterWithoutTheTopLevelDockAndReturns() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val share = ShareItem("share-1", "note", "Test note", "https://share.example/s/1", null,
      "public", "", "2030-01-01T00:00:00Z", false, false)
    var loads = 0
    var closes = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          shares = ShareCenterUiState("gateway", listOf(share))),
        onLoadShares = { loads++ }, onCloseShares = { closes++ })
    }
    composeTestRule.onNodeWithTag("personal-settings").performClick()
    composeTestRule.onNodeWithText("Shared links").performClick()
    composeTestRule.onNodeWithTag("share-center").assertExists()
    composeTestRule.onNodeWithTag("share-share-1").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertDoesNotExist()
    composeTestRule.runOnIdle { assert(loads == 1) }
    composeTestRule.onNodeWithTag("shares-back").performClick()
    composeTestRule.onNodeWithTag("settings-screen").assertExists()
    composeTestRule.runOnIdle { assert(closes == 1) }
  }

  @Test fun meTabShowsGatewayBackedPersonalHierarchy() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val summary = PersonalSummary("Mia", "Designer", PersonalCounts(4, 2, 2, 1, 3),
      "Ship app", "Launch", listOf(PersonalGoal("g1", "Ship app", "Launch", "active", null, true)),
      emptyList(), emptyList())
    var loads = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {}, connection = ConnectionUiState(
        profile = profile, realtimeStatus = "connected",
        personal = PersonalUiState("gateway", summary)), onLoadPersonal = { loads++ })
    }
    composeTestRule.onNodeWithTag("personal-profile").assertExists()
    composeTestRule.onNodeWithText("Mia").assertExists()
    composeTestRule.onNodeWithText("Ship app").assertExists()
    assert(loads == 1)
  }

  @Test fun personalProfileOpensAboutYouAndHidesRootDockUntilBack() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val summary = PersonalSummary("Mia", "Designer", PersonalCounts(0, 0, 0, 0, 0),
      "", "", emptyList(), emptyList(), emptyList())
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {}, connection = ConnectionUiState(
        profile = profile, personal = PersonalUiState("gateway", summary)))
    }
    composeTestRule.onNodeWithTag("personal-profile").performClick()
    composeTestRule.onNodeWithTag("about-you-screen").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertDoesNotExist()
    composeTestRule.onNodeWithTag("about-you-back").performClick()
    composeTestRule.onNodeWithTag("personal-profile").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertExists()
  }

  @Test fun meSettingsAppearanceKeepsTheFiveTabHierarchyAndBackPath() {
    val profile = GatewayProfile("gateway", "Test Gateway", "key", "device", emptyList(), "")
    var chosenMode = "system"
    var chosenScheme = "default"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          personal = PersonalUiState(gatewayId = "gateway")),
        appearanceMode = chosenMode, onAppearanceModeChange = { chosenMode = it },
        colorScheme = chosenScheme, onColorSchemeChange = { chosenScheme = it })
    }
    composeTestRule.onNodeWithTag("personal-settings").performClick()
    composeTestRule.onNodeWithTag("settings-screen").assertExists()
    composeTestRule.onNodeWithText("Test Gateway").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertDoesNotExist()
    composeTestRule.onNodeWithText("Appearance").performClick()
    composeTestRule.onNodeWithTag("appearance-dark").performClick()
    assert(chosenMode == "dark")
    composeTestRule.onNodeWithTag("scheme-porcelain").performScrollTo().performClick()
    assert(chosenScheme == "porcelain")
    composeTestRule.onNodeWithTag("settings-back").performClick()
    composeTestRule.onNodeWithText("Current Gateway").assertExists()
    composeTestRule.onNodeWithTag("settings-back").performClick()
    composeTestRule.onNodeWithTag("personal-profile").assertExists()
    composeTestRule.onNodeWithTag("tab-Me").assertExists()
  }

  @Test fun languageSettingsFollowHarmonyOptionsAndReturnToSettings() {
    val profile = GatewayProfile("gateway", "Test Gateway", "key", "device", emptyList(), "")
    val selected = mutableStateOf("system")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          personal = PersonalUiState(gatewayId = "gateway")),
        language = selected.value, onLanguageChange = { selected.value = it })
    }
    composeTestRule.onNodeWithTag("personal-settings").performClick()
    composeTestRule.onNodeWithText("Language").performClick()
    composeTestRule.onNodeWithTag("language-system").assertExists()
    composeTestRule.onNodeWithTag("language-zh-CN").performClick()
    assert(selected.value == "zh-CN")
    composeTestRule.onNodeWithTag("tab-Me").assertDoesNotExist()
    composeTestRule.onNodeWithTag("settings-back").performClick()
    composeTestRule.onNodeWithText("中文").assertExists()
    composeTestRule.onNodeWithTag("language-en-US").assertDoesNotExist()
  }

  @Test fun assistantComposerAndActionPanelShareOneBottomSurface() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = "test"))
    }
    composeTestRule.onNodeWithTag("assistant-bottom-surface").assertExists()
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-panel").assertExists()
    composeTestRule.onNodeWithTag("assistant-bottom-surface").assertExists()
  }

  @Test fun assistantCompactComposerShowsActionInsteadOfEmptySend() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = "test"))
    }
    composeTestRule.onNodeWithTag("assistant-actions-toggle").assertExists()
    composeTestRule.onNodeWithTag("assistant-send").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-stop").assertDoesNotExist()
  }

  @Test fun assistantFirstKeystrokeExpandsComposerWithoutLosingEditorFocus() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = "test",
      realtimeStatus = "connected", draftModelReady = true))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
        onDraftChange = { state.value = state.value.copy(draftText = it) })
    }
    composeTestRule.onNodeWithTag("assistant-input").performClick()
    composeTestRule.onNodeWithTag("assistant-input").performTextInput("Hello")
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
    composeTestRule.onNodeWithTag("assistant-send").assertIsEnabled()
    composeTestRule.onNodeWithTag("assistant-actions-toggle").assertExists()
    composeTestRule.onNodeWithTag("assistant-input").performTextClearance()
    composeTestRule.onNodeWithTag("assistant-send").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
  }

  @Test fun gatewayManagementIsReachableFromMeAndRequiresAHealthyProbeToSwitch() {
    val first = GatewayProfile("gateway-a", "Home Gateway", "key", "device", emptyList(), "")
    val second = GatewayProfile("gateway-b", "Work Gateway", "key", "device", emptyList(), "")
    var opened = 0
    var switched = ""
    var removed = ""
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {},
        connection = ConnectionUiState(profile = first, gatewayProfiles = listOf(first, second),
          gatewayProbes = mapOf("gateway-b" to GatewayProbeUiState(phase = "offline")),
          personal = PersonalUiState(gatewayId = first.gatewayId)),
        onOpenGatewayProfiles = { opened++ }, onActivateGateway = { switched = it },
        onRemoveGateway = { removed = it })
    }
    composeTestRule.onNodeWithTag("personal-settings").performClick()
    composeTestRule.onNodeWithText("Home Gateway").performClick()
    composeTestRule.onNodeWithTag("gateway-profiles-screen").assertExists()
    assert(opened == 1)
    composeTestRule.onNodeWithTag("tab-Me").assertDoesNotExist()
    composeTestRule.onNodeWithTag("gateway-select-gateway-b").performClick()
    composeTestRule.onNodeWithTag("gateway-switch-gateway-b").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("gateway-remove-gateway-b").performClick()
    composeTestRule.onNodeWithTag("gateway-remove-confirm").performClick()
    assert(removed == "gateway-b" && switched.isEmpty())
    composeTestRule.onNodeWithTag("gateways-back").performClick()
    composeTestRule.onNodeWithTag("settings-screen").assertExists()
  }

  @Test fun verifiedGatewayCanBeSelectedFromTheExpandedCard() {
    val first = GatewayProfile("gateway-a", "Home Gateway", "key", "device", emptyList(), "")
    val second = GatewayProfile("gateway-b", "Work Gateway", "key", "device", emptyList(), "")
    var selected = ""
    composeTestRule.setContent {
      GatewayProfilesScreen(ConnectionUiState(profile = first, gatewayProfiles = listOf(first, second),
        gatewayProbes = mapOf("gateway-b" to GatewayProbeUiState(phase = "online"))),
        androidx.compose.foundation.layout.PaddingValues(), onBack = {}, onAdd = {}, onRefresh = {},
        onProbe = {}, onActivate = { selected = it }, onRename = { _, _ -> }, onRemove = {})
    }
    composeTestRule.onNodeWithTag("gateway-select-gateway-b").performClick()
    composeTestRule.onNodeWithTag("gateway-switch-gateway-b").assertIsEnabled().performClick()
    assert(selected == "gateway-b")
  }

  @Test fun understandingChatActionsPreserveSelectedAssertionAndDoNotSend() {
    val item = PersonalAssertion("assertion-1", "Prefers concise answers", "user_explicit", recordedAt = 123)
    val summary = PersonalSummary("Mia", "Designer", PersonalCounts(1, 1, 0, 0, 0),
      "", "", emptyList(), listOf(item), emptyList())
    val personal = PersonalUiState("gateway", summary, assertions = listOf(item), selectedAssertion = item,
      selectedAssertionId = item.id)
    var staged: PersonalAssertion? = item
    var starts = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Me, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          personal = personal),
        onStartUnderstandingChat = { staged = it; starts++ })
    }
    composeTestRule.onNodeWithTag("personal-profile").performClick()
    composeTestRule.onNodeWithTag("about-you-tab-understanding").performClick()
    composeTestRule.onNodeWithTag("about-you-chat-modify").performClick()
    assert(staged == null && starts == 1)
    composeTestRule.onNodeWithTag("assertion-assertion-1").performClick()
    composeTestRule.onNodeWithTag("about-you-detail-chat").performClick()
    assert(staged == item && starts == 2)
  }

  @Test fun assistantShowsRemovableVersionedUnderstandingReference() {
    val id = "11111111-2222-3333-4444-555555555555"
    var removed = ""
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, draftText = "I want to update this understanding to: ",
          draftRefs = listOf(ConversationContextRef("user_assertion", "assertion-1", "123", "Prefers concise answers"))),
        onRemoveDraftRef = { kind, sourceId -> removed = "$kind:$sourceId" })
    }
    composeTestRule.onNodeWithTag("assistant-ref-user_assertion-assertion-1").assertExists()
    composeTestRule.onNodeWithTag("assistant-remove-ref-user_assertion-assertion-1").performClick()
    assert(removed == "user_assertion:assertion-1")
  }

  @Test fun assistantReferenceActionLoadsNoteAndStagesItWithoutSending() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val item = ReferencePickerItem("note", "note-1", "Brief", "Launch notes", "123")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      realtimeStatus = "connected", draftModelReady = true))
    var sends = 0
    var searches = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
        onLoadReferences = { kind, query ->
          searches++
          state.value = state.value.copy(referencePicker = ReferencePickerUiState(
            "gateway", id, kind, query, listOf(item)))
        }, onAddDraftRef = { selected ->
          state.value = state.value.copy(draftRefs = state.value.draftRefs +
            ConversationContextRef(selected.kind, selected.id, selected.version, selected.title))
          true
        }, onSendMessage = { sends++ })
    }
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-reference-note").assertIsEnabled().performClick()
    composeTestRule.onNodeWithTag("assistant-reference-note-note-1").performClick()
    composeTestRule.onNodeWithTag("assistant-ref-note-note-1").assertExists()
    composeTestRule.onNodeWithTag("assistant-send").assertIsEnabled()
    composeTestRule.runOnIdle { assert(searches == 1 && sends == 0) }
    composeTestRule.onNodeWithTag("assistant-send").performClick()
    assert(sends == 1)
  }

  @Test fun goalEditorValidatesDateAndKeepsDraftUntilConfirmed() {
    val summary = PersonalSummary("Mia", "Designer", PersonalCounts(0, 0, 0, 0, 0),
      "", "", emptyList(), emptyList(), emptyList())
    val state = mutableStateOf(PersonalUiState("gateway", summary))
    var saved = ""
    composeTestRule.setContent {
      PersonalScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), true,
        onRefresh = {}, onSaveGoal = { id, title, outcome, _, target ->
          assert(id == null)
          saved = "$title|$outcome|$target"
          state.value = state.value.copy(savedGoalRevision = state.value.savedGoalRevision + 1)
        })
    }
    composeTestRule.onNodeWithTag("goal-add").performClick()
    composeTestRule.onNodeWithTag("goal-title").performTextInput("Ship app")
    composeTestRule.onNodeWithTag("goal-outcome").performTextInput("Launch")
    composeTestRule.onNodeWithTag("goal-date").performTextInput("2025-13-40")
    composeTestRule.onNodeWithTag("goal-save").performClick()
    assert(saved.isEmpty())
    composeTestRule.onNodeWithText("Enter a valid date in YYYY-MM-DD format.").assertExists()
    composeTestRule.onNodeWithTag("goal-date").performTextClearance()
    composeTestRule.onNodeWithTag("goal-save").performClick()
    composeTestRule.waitForIdle()
    assert(saved == "Ship app|Launch|null")
    composeTestRule.onNodeWithTag("personal-goal-sheet").assertDoesNotExist()
  }

  @Test fun editingGoalPrefillsFieldsAndSendsChangedStatus() {
    val summary = PersonalSummary("Mia", "", PersonalCounts(0, 0, 0, 0, 0), "", "",
      listOf(PersonalGoal("goal-1", "Ship app", "Launch", "active", null, false)),
      emptyList(), emptyList())
    var received = ""
    composeTestRule.setContent {
      PersonalScreen(PersonalUiState("gateway", summary),
        androidx.compose.foundation.layout.PaddingValues(), true, onRefresh = {},
        onSaveGoal = { id, title, outcome, status, target ->
          received = "$id|$title|$outcome|$status|$target"
        })
    }
    composeTestRule.onNodeWithTag("goal-goal-1").performClick()
    composeTestRule.onNodeWithTag("goal-title").assertTextContains("Ship app")
    composeTestRule.onNodeWithText("Paused").performClick()
    composeTestRule.onNodeWithTag("goal-save").performClick()
    assert(received == "goal-1|Ship app|Launch|paused|null")
  }

  @Test fun tabDockKeepsNotesSearchStateAcrossDestinations() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainScreen(connection = ConnectionUiState(profile = profile,
        notes = NotesUiState(gatewayId = "gateway")))
    }
    composeTestRule.onNodeWithTag("tab-Notes").performClick()
    composeTestRule.onNodeWithTag("tab-Notes").assertIsSelected()
    composeTestRule.onNodeWithTag("notes-search").performTextInput("persistent")
    Espresso.closeSoftKeyboard()
    composeTestRule.waitUntil(5_000) {
      composeTestRule.onAllNodesWithTag("tab-Me").fetchSemanticsNodes().isNotEmpty()
    }
    composeTestRule.onNodeWithTag("tab-Me").performClick()
    composeTestRule.onNodeWithTag("tab-Notes").performClick()
    composeTestRule.onNodeWithTag("notes-search").assertTextContains("persistent")
  }

  @Test fun notesTabLoadsAndOpensVerifiedDetailWithoutLeavingTab() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val note = NoteSummary("note-1", "Idea", "Preview", "inbox", "thought", 2000L,
      false, emptyList())
    val state = mutableStateOf(ConnectionUiState(profile = profile,
      notes = NotesUiState(gatewayId = "gateway", items = listOf(note))))
    var loads = 0
    var opened = ""
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Notes, onSelectTab = {}, connection = state.value,
        onLoadNotes = { _, _ -> loads++ }, onOpenNote = { id ->
          opened = id
          state.value = state.value.copy(notes = state.value.notes.copy(selectedId = id,
            detail = NoteDetail(id, "Idea", "# Idea", "inbox", "thought", 2000L,
              false, emptyList(), 3L)))
        })
    }
    composeTestRule.onNodeWithTag("note-note-1").performClick()
    assert(opened == "note-1")
    composeTestRule.onNodeWithTag("note-detail-body").assertExists()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertDoesNotExist()
    composeTestRule.onNodeWithTag("main-tab-dock").assertDoesNotExist()
    composeTestRule.onNodeWithTag("notes-back").performClick()
    composeTestRule.onNodeWithTag("note-note-1").assertExists()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertExists()
    composeTestRule.onNodeWithTag("main-tab-dock").assertExists()
    assert(loads == 1)
  }

  @Test fun progressSecondaryPagesHideComposerAndDockUntilReturningToOverview() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Progress, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          progress = ProgressUiState(gatewayId = "gateway")))
    }
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertExists()
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertDoesNotExist()
    composeTestRule.onNodeWithTag("main-tab-dock").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertExists()
    composeTestRule.onNodeWithTag("progress-projects").performClick()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-automations").performClick()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertExists()
  }

  @Test fun automationEditKeepsDraftAndRequiresDiscardConfirmation() {
    val item = AutomationSummary("auto-edit", "Morning brief", "", true, "schedule", "0 9 * * *",
      "Summarize", null, null, null, null, null, 123L,
      canEditDetails = true, canEditSchedule = true, canDelete = true)
    var current = item
    val state = mutableStateOf(ProgressUiState(gatewayId = "test-gateway",
      automations = AutomationUiState(items = listOf(item))))
    var saved = ""
    composeTestRule.setContent {
      ProgressScreen(state = state.value, insets = androidx.compose.foundation.layout.PaddingValues(),
        onRefreshHome = {}, onRefreshTasks = {}, onLoadMore = {}, onOpenTask = {},
        onSearchChange = {}, onSubmitSearch = {}, onTaskCommand = {}, onStartTask = {},
        onCreateTaskWithChat = {}, onLoadProjects = {}, onOpenProject = {},
        onCreateTask = { _, _, _ -> }, onOpenTaskChat = {}, onSaveTask = { _, _, _, _, _ -> },
        onOpenChat = {}, onLoadAutomations = {}, onOpenAutomation = { id ->
          state.value = state.value.copy(automations = state.value.automations.copy(selectedId = id, detail = current))
        }, onUpdateAutomation = { _, name, _, _, _ ->
          saved = name
          current = current.copy(name = name, updatedAtMs = 124L)
          state.value = state.value.copy(automations = state.value.automations.copy(detail = current,
            editedRevision = state.value.automations.editedRevision + 1))
        })
    }
    composeTestRule.onNodeWithTag("progress-automations").performClick()
    composeTestRule.onNodeWithTag("automation-auto-edit").performClick()
    composeTestRule.onNodeWithTag("automation-edit").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("automation-edit-name").performTextClearance()
    composeTestRule.onNodeWithTag("automation-edit-name").performTextInput("Morning brief updated")
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("automation-edit-discard-confirm").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.progress_cancel)).performClick()
    composeTestRule.onNodeWithTag("automation-edit-save").performScrollTo().performClick()
    assert(saved == "Morning brief updated")
    composeTestRule.onNodeWithTag("automation-edit").assertExists()
  }

  @Test fun progressOverviewOpensKnownChatAndShowsTaskDetails() {
    val task = ProgressTask("task-1", "Release checklist", "Verify build", "review", null, 10, null, null)
    val attention = ProgressItem("wait-1", "Review release", "Needs approval", "Needs you", null,
      ProgressAction("Open chat", "/chat/chat-1"))
    var openedChat: String? = null
    var openedTask: String? = null
    val progress = mutableStateOf(ProgressUiState(needsUser = listOf(attention), tasks = listOf(task), taskTotal = 1))
    composeTestRule.setContent {
      ProgressScreen(progress.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        openedTask = id
        progress.value = progress.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, { openedChat = it })
    }
    composeTestRule.onNodeWithText("Review release").performClick()
    assert(openedChat == "chat-1")
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-1").performClick()
    assert(openedTask == "task-1")
    composeTestRule.onNodeWithText("Verify build").assertExists()
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-1").assertExists()
  }

  @Test fun progressOverviewShowsAndOpensTheUpcomingAutomation() {
    val state = ProgressUiState(automationMetrics = AutomationMetrics(3, 2, 0, 0,
      AutomationMetricsNext("auto-next", "Morning brief", 2_000L)))
    var openedAutomation: String? = null
    composeTestRule.setContent {
      ProgressScreen(state, androidx.compose.foundation.layout.PaddingValues(),
        onRefreshHome = {}, onRefreshTasks = {}, onLoadMore = {}, onOpenTask = {},
        onSearchChange = {}, onSubmitSearch = {}, onTaskCommand = {}, onStartTask = {},
        onCreateTaskWithChat = {}, onLoadProjects = {}, onOpenProject = {},
        onCreateTask = { _, _, _ -> }, onOpenTaskChat = {}, onSaveTask = { _, _, _, _, _ -> },
        onOpenChat = {}, onOpenAutomation = { openedAutomation = it })
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.progress_upcoming))
      .performScrollTo().assertExists()
    composeTestRule.onNodeWithTag("progress-upcoming-auto-next").performScrollTo().performClick()
    assert(openedAutomation == "auto-next")
  }

  @Test fun progressOpensTaskOutsideLoadedPageAndCanRetryDetail() {
    val item = ProgressItem("wait-2", "Review unretrieved task", "Needs approval", null, null,
      ProgressAction("Open task", "/tasks/task-2"))
    val progress = mutableStateOf(ProgressUiState(needsUser = listOf(item)))
    var requested = ""
    var requests = 0
    composeTestRule.setContent {
      ProgressScreen(progress.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        requested = id
        requests++
        progress.value = progress.value.copy(detailTaskId = id, detailError = true)
      }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-item-wait-2").performClick()
    assert(requested == "task-2")
    composeTestRule.onNodeWithTag("progress-detail-retry").performClick()
    assert(requests == 2)
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-item-wait-2").assertExists()
  }

  @Test fun progressRejectsExternalRouteAndDisablesUnsupportedActions() {
    assert(progressDestination("https://example.com") == null)
    assert(progressDestination("//example.com/tasks/1") == null)
    val item = ProgressItem("unsafe", "Unsafe destination", "External", null, null,
      ProgressAction("Open", "https://example.com"))
    composeTestRule.setContent {
      ProgressScreen(ProgressUiState(needsUser = listOf(item)),
        androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, {}, {}, {}, {}, {}, {},
        {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-item-unsafe").assertIsNotEnabled()
  }

  @Test fun progressHomeDecisionShowsReviewAndRequiresConfirmation() {
    val approve = ProgressHomeAction("connector_decision", "Approve", "approval-1", "approve")
    val item = ProgressItem("approval", "Connector permission", "Review request", null, null, null,
      "Full permission scope", approve)
    val progress = mutableStateOf(ProgressUiState(needsUser = listOf(item)))
    var requested: ProgressHomeAction? = null
    composeTestRule.setContent {
      ProgressScreen(state = progress.value, insets = androidx.compose.foundation.layout.PaddingValues(),
        onRefreshHome = {}, onRefreshTasks = {}, onLoadMore = {}, onOpenTask = {},
        onSearchChange = {}, onSubmitSearch = {}, onTaskCommand = {}, onStartTask = {},
        onCreateTaskWithChat = {}, onLoadProjects = {}, onOpenProject = {},
        onCreateTask = { _, _, _ -> }, onOpenTaskChat = {},
        onSaveTask = { _, _, _, _, _ -> }, onHomeAction = { requested = it }, onOpenChat = {})
    }
    composeTestRule.onNodeWithTag("progress-review-approval").performClick()
    composeTestRule.onNodeWithTag("progress-review-detail-approval", useUnmergedTree = true).assertExists()
    composeTestRule.onNodeWithTag("progress-home-primary-approval").performClick()
    assert(requested == null)
    composeTestRule.onNodeWithTag("progress-home-action-confirm").performClick()
    assert(requested == approve)
    progress.value = progress.value.copy(homeActionBusy = true, homeActionError = true)
    composeTestRule.onNodeWithTag("progress-home-primary-approval").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("progress-home-action-error").assertExists()
  }

  @Test fun progressTaskSearchAndFiltersKeepTheirSeparateState() {
    val open = ProgressTask("task-open", "Open work", "", "active", null, 10, null, null)
    val closed = ProgressTask("task-closed", "Closed work", "", "closed", "done", 11, 11, null)
    val state = mutableStateOf(ProgressUiState(tasks = listOf(open, closed), taskTotal = 2))
    var submitted = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, {},
        { state.value = state.value.copy(taskSearchText = it) },
        { submitted = state.value.taskSearchText }, {}, {}, {}, {}, {}, { _, _, _ -> },
        {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-filter-open").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-open").assertExists()
    composeTestRule.onNodeWithTag("progress-task-task-closed").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-filter-closed").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-open").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-task-task-closed").assertExists()
    composeTestRule.onNodeWithTag("progress-task-task-closed").performClick()
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-open").assertDoesNotExist()
    composeTestRule.onNodeWithTag("progress-task-task-closed").assertExists()
    composeTestRule.onNodeWithTag("progress-task-search").performTextInput("release")
    composeTestRule.onNodeWithTag("progress-task-refresh").performClick()
    assert(submitted == "release")
  }

  @Test fun progressOverviewKeepsRecentClosedWhenTaskSearchChanges() {
    val closed = ProgressTask("task-done", "Previously done", "", "closed", "done", 11, 11, null)
    val searching = ProgressTask("task-found", "Search result", "", "active", null, 12, null, null)
    composeTestRule.setContent {
      ProgressScreen(ProgressUiState(tasks = listOf(searching), recentClosedTasks = listOf(closed),
        taskSearch = "search", taskTotal = 1), androidx.compose.foundation.layout.PaddingValues(),
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> },
        {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-closed-task-done").assertExists()
  }

  @Test fun progressNewTaskOpensCreationChatWithoutSubmitting() {
    val state = mutableStateOf(ProgressUiState())
    var prepared = 0
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, {},
        {}, {}, {}, {}, { prepared++ }, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-create-task-chat").assertIsEnabled().performClick()
    assert(prepared == 1)
    state.value = state.value.copy(creatingTaskChat = true)
    composeTestRule.onNodeWithTag("progress-create-task-chat").assertIsNotEnabled()
    state.value = state.value.copy(creatingTaskChat = false, createTaskChatError = true)
    composeTestRule.onNodeWithTag("progress-create-task-error").assertExists()
  }

  @Test fun progressProjectTaskCreateKeepsFormAndReturnsToProject() {
    val project = ProgressProject("project-1", "Alpha", "", "active", "Plan work")
    val state = mutableStateOf(ProgressUiState(projects = listOf(project)))
    var loadedProjects = 0
    var savedTitle = ""
    var savedProject = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, {},
        {}, {}, {}, {}, {}, { loadedProjects++ }, { id ->
          state.value = state.value.copy(projectId = id, project = project)
        }, { title, _, projectId ->
          savedTitle = title
          savedProject = projectId
          state.value = state.value.copy(createSavedRevision = 1)
        }, {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-projects").performClick()
    assert(loadedProjects == 1)
    composeTestRule.onNodeWithTag("progress-project-project-1").performClick()
    composeTestRule.onNodeWithTag("progress-project-add-task").performClick()
    composeTestRule.onNodeWithTag("progress-create-save").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("progress-create-title").performTextInput("New task")
    composeTestRule.onNodeWithTag("progress-create-body").performTextInput("Description")
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-create-discard-confirm").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.progress_cancel)).performClick()
    composeTestRule.onNodeWithTag("progress-task-create").assertExists()
    composeTestRule.onNodeWithTag("progress-create-save").performScrollTo().performClick()
    assert(savedTitle == "New task")
    assert(savedProject == "project-1")
    composeTestRule.onNodeWithTag("progress-project-detail").assertExists()
  }

  @Test fun progressTaskCloseRequiresConfirmationAndUsesAllowedCommandsOnly() {
    val task = ProgressTask("task-ready", "Ready work", "", "ready", null, 10, null, null,
      version = 2, allowedCommands = listOf("close", "mark_ready"))
    val state = mutableStateOf(ProgressUiState(tasks = listOf(task), taskTotal = 1))
    var command = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        state.value = state.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, { command = it }, {}, {}, {}, {}, { _, _, _ -> },
        {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-ready").performClick()
    composeTestRule.onNodeWithTag("progress-command-close").performScrollTo().performClick()
    assert(command.isEmpty())
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.progress_cancel)).performClick()
    assert(command.isEmpty())
    composeTestRule.onNodeWithTag("progress-command-close").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("progress-command-confirm").performClick()
    assert(command == "close")
    composeTestRule.onNodeWithTag("progress-command-reopen").assertDoesNotExist()
  }

  @Test fun progressTaskStartRequiresAgentAndConfirmation() {
    val task = ProgressTask("task-start", "Start work", "", "ready", null, 10, null, null,
      version = 5, allowedCommands = listOf("start"))
    val state = mutableStateOf(ProgressUiState(tasks = listOf(task), taskTotal = 1))
    var startedWith = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        state.value = state.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, {}, { startedWith = it }, {}, {}, {}, { _, _, _ -> },
        {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-start").performClick()
    composeTestRule.onNodeWithTag("progress-command-start").performScrollTo().assertIsNotEnabled()
    composeTestRule.onNodeWithTag("progress-start-agent").performScrollTo().performTextInput(" research ")
    composeTestRule.onNodeWithTag("progress-command-start").performScrollTo().assertIsEnabled().performClick()
    assert(startedWith.isEmpty())
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.progress_cancel)).performClick()
    assert(startedWith.isEmpty())
    composeTestRule.onNodeWithTag("progress-command-start").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("progress-start-confirm").performClick()
    assert(startedWith == "research")
  }

  @Test fun progressTaskConversationOpensOnlySelectedTaskAndShowsFailure() {
    val task = ProgressTask("task-chat", "Discuss work", "", "ready", null, 10, null, null,
      version = 2)
    val state = mutableStateOf(ProgressUiState(tasks = listOf(task), taskTotal = 1))
    var opened = ""
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        state.value = state.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, { opened = it },
        { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-chat").performClick()
    composeTestRule.onNodeWithTag("progress-task-chat").performScrollTo().performClick()
    assert(opened == "task-chat")
    state.value = state.value.copy(taskChatBusy = true)
    composeTestRule.onNodeWithTag("progress-task-chat").assertIsNotEnabled()
    state.value = state.value.copy(taskChatBusy = false, taskChatError = true)
    composeTestRule.onNodeWithTag("progress-task-chat-error").assertExists()
  }

  @Test fun progressTaskEditKeepsDraftUntilConfirmedSaveOrDiscard() {
    val task = ProgressTask("task-edit", "Original task", "Original body", "ready", null, 10, null,
      "project-1", version = 2)
    val state = mutableStateOf(ProgressUiState(tasks = listOf(task), taskTotal = 1))
    var savedTitle = ""
    var savedVersion = 0
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        state.value = state.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, version, title, _, _ ->
        savedTitle = title
        savedVersion = version
        state.value = state.value.copy(detailTask = task.copy(title = title, version = 3), editSavedRevision = 1)
      }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-edit").performClick()
    composeTestRule.onNodeWithTag("progress-task-edit").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("progress-edit-title").performTextClearance()
    composeTestRule.onNodeWithTag("progress-edit-title").performTextInput("Edited task")
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-discard-confirm").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.progress_cancel)).performClick()
    composeTestRule.onNodeWithTag("progress-task-editor").assertExists()
    composeTestRule.onNodeWithTag("progress-edit-save").performScrollTo().performClick()
    assert(savedTitle == "Edited task")
    assert(savedVersion == 2)
    composeTestRule.onNodeWithTag("progress-task-detail").assertExists()
  }

  @Test fun progressTaskEditDiscardRefreshesLatestDetail() {
    val task = ProgressTask("task-discard", "Original", "", "ready", null, 10, null, null, version = 2)
    val state = mutableStateOf(ProgressUiState(tasks = listOf(task), taskTotal = 1))
    var opens = 0
    composeTestRule.setContent {
      ProgressScreen(state.value, androidx.compose.foundation.layout.PaddingValues(), {}, {}, {}, { id ->
        opens++
        state.value = state.value.copy(detailTaskId = id, detailTask = task)
      }, {}, {}, {}, {}, {}, {}, {}, { _, _, _ -> }, {}, { _, _, _, _, _ -> }, {})
    }
    composeTestRule.onNodeWithTag("progress-all-work").performClick()
    composeTestRule.onNodeWithTag("progress-task-task-discard").performClick()
    composeTestRule.onNodeWithTag("progress-task-edit").performScrollTo().performClick()
    composeTestRule.onNodeWithTag("progress-edit-title").performTextInput(" changed")
    composeTestRule.onNodeWithTag("progress-back").performClick()
    composeTestRule.onNodeWithTag("progress-discard-confirm").performClick()
    composeTestRule.onNodeWithTag("progress-task-detail").assertExists()
    assert(opens == 2)
  }

  @Test
  fun fiveTabsSwitchWithoutPretendingToSendMessages() {
    composeTestRule.setContent { MainScreen() }
    HomeTab.entries.forEach { composeTestRule.onNodeWithTag("tab-${it.name}").assertExists() }
    composeTestRule.onNodeWithTag("tab-Conversations").performClick()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.pairing_hint)).assertExists()
  }

  @Test
  fun selectingConversationRoutesToSharedAssistantState() {
    val id = "11111111-2222-3333-4444-555555555555"
    var selected = ""
    var destination = HomeTab.Conversations
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = { destination = it },
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          conversations = listOf(ConversationSummary(id, "A chat", "2026-10-04", 2, "main"))),
        onSelectConversation = { selected = it })
    }
    composeTestRule.onNodeWithText("A chat").performClick()
    assert(selected == id)
    assert(destination == HomeTab.Assistant)
  }

  @Test fun conversationsLoadMoreIsStateDrivenAndRetryable() {
    var loads = 0
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversationsHasMore = true,
          conversationsMoreError = true), onLoadMoreConversations = { loads++ })
    }
    composeTestRule.onNodeWithTag("conversations-load-more").assertIsEnabled().performClick()
    assert(loads == 1)
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_more_error)).assertExists()
  }

  @Test fun conversationsLoadMoreCannotRepeatWhileLoading() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversationsHasMore = true,
          conversationsLoadingMore = true))
    }
    composeTestRule.onNodeWithTag("conversations-load-more").assertIsNotEnabled()
  }

  @Test fun localDraftDiscardRequiresConfirmationAndDoesNotOpenConversation() {
    val id = "11111111-2222-3333-4444-555555555555"
    var discarded: String? = null
    var selected: String? = null
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          conversations = listOf(ConversationSummary(id, "New conversation", Instant.now().toString(), 0, "main", true))),
        onSelectConversation = { selected = it }, onDiscardDraft = { discarded = it })
    }
    composeTestRule.onNodeWithTag("discard-draft-$id").performClick()
    assert(discarded == null)
    assert(selected == null)
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_cancel)).performClick()
    assert(discarded == null)
    composeTestRule.onNodeWithTag("discard-draft-$id").performClick()
    composeTestRule.onNodeWithTag("conversations-confirm-discard").performClick()
    assert(discarded == id)
    assert(selected == null)
  }

  @Test fun conversationsListShowsTodaySectionAndRelativeTime() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val entry = ConversationSummary("11111111-2222-3333-4444-555555555555", "Recent chat",
      Instant.now().toString(), 2, "main")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversations = listOf(entry)))
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_today)).assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_now)).assertExists()
  }

  @Test fun conversationSearchChangesWithoutSubmitAndCanBeCleared() {
    val query = mutableStateOf("")
    val changes = mutableListOf<String>()
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversationSearch = query.value),
        onConversationSearchChange = { text -> query.value = text; changes += text })
    }
    composeTestRule.onNodeWithTag("conversations-search").performTextInput("alpha")
    assert(changes.last() == "alpha")
    composeTestRule.onNodeWithTag("conversations-clear").performClick()
    assert(query.value == "")
    composeTestRule.onNodeWithTag("conversations-clear").assertDoesNotExist()
    composeTestRule.onNodeWithTag("conversations-open-search").performClick()
    composeTestRule.onNodeWithTag("conversations-search").assertExists()
  }

  @Test fun conversationsLoadNextPageWhenScrolledNearEnd() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val rows = (1..40).map { index ->
      ConversationSummary("00000000-0000-0000-0000-${index.toString().padStart(12, '0')}",
        "Chat $index", Instant.now().toString(), 1, "main")
    }
    val loadingMore = mutableStateOf(false)
    var requests = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversations = rows,
          conversationsHasMore = true, conversationsLoadingMore = loadingMore.value),
        onLoadMoreConversations = { requests++; loadingMore.value = true })
    }
    composeTestRule.runOnIdle { assert(requests == 0) }
    composeTestRule.onNodeWithTag("conversations-list").performScrollToIndex(40)
    composeTestRule.waitUntil(5_000) { requests == 1 }
    composeTestRule.runOnIdle { assert(requests == 1) }
  }

  @Test fun conversationsPullRefreshKeepsExistingRowsAndRetryWorks() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val row = ConversationSummary("11111111-2222-3333-4444-555555555555", "Keep this chat",
      Instant.now().toString(), 1, "main")
    val state = mutableStateOf(ConnectionUiState(profile = profile, conversations = listOf(row)))
    var refreshes = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {}, connection = state.value,
        onRefreshConversations = {
          refreshes++
          state.value = state.value.copy(conversationsLoading = true)
        })
    }
    composeTestRule.onNodeWithTag("conversations-list").performTouchInput { swipeDown() }
    composeTestRule.waitUntil(5_000) { refreshes == 1 }
    composeTestRule.onNodeWithText("Keep this chat").assertExists()
    composeTestRule.runOnIdle { state.value = state.value.copy(conversationsLoading = false, chatError = true) }
    composeTestRule.onNodeWithTag("conversations-retry").performClick()
    composeTestRule.runOnIdle { assert(refreshes == 2) }
  }

  @Test fun conversationTaskChildExpandsAndOpensTaskScopedConversation() {
    val parent = "11111111-2222-3333-4444-555555555555"
    val childId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    var opened: String? = null
    var selectedTab: HomeTab? = null
    composeTestRule.setContent {
      XopcTheme {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = { selectedTab = it },
        connection = ConnectionUiState(profile = profile,
          conversations = listOf(ConversationSummary(parent, "Parent chat", Instant.now().toString(), 1, "main")),
          conversationTaskGroups = mapOf(parent to ConversationTaskGroup(1, 1,
            listOf(ConversationTaskChild("task-1", "Research task", "active", "running", childId))))),
        onSelectTaskChildConversation = { taskId, conversationId -> opened = "$taskId:$conversationId" })
      }
    }
    composeTestRule.onNodeWithTag("conversation-task-task-1").assertDoesNotExist()
    composeTestRule.onNodeWithTag("conversation-tasks-$parent").performClick()
    composeTestRule.onNodeWithText("Research task").assertExists()
    composeTestRule.mainClock.advanceTimeBy(600)
    composeTestRule.waitForIdle()
    saveAcceptanceScreenshot("conversation-task-expanded.png")
    composeTestRule.onNodeWithTag("conversation-task-task-1").performClick()
    composeTestRule.runOnIdle {
      assert(opened == "task-1:$childId")
      assert(selectedTab == HomeTab.Assistant)
    }
  }

  @Test fun quickComposerKeepsInputSeparateFromSelectedConversation() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val quick = mutableStateOf("")
    var quickSubmits = 0
    var assistantSends = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, realtimeStatus = "connected",
          selectedConversationId = "11111111-2222-3333-4444-555555555555", quickDraftText = quick.value),
        onQuickDraftChange = { quick.value = it }, onQuickSubmit = { quickSubmits++ },
        onSendMessage = { assistantSends++ })
    }
    composeTestRule.onNodeWithTag("quick-send").assertDoesNotExist()
    composeTestRule.onNodeWithTag("secondary-bottom-surface").assertExists()
    composeTestRule.onNodeWithTag("quick-composer").performTextInput("New topic")
    composeTestRule.onNodeWithTag("quick-send").assertIsEnabled().performClick()
    assert(quick.value == "New topic")
    assert(quickSubmits == 1)
    assert(assistantSends == 0)
  }

  @Test fun quickComposerCannotSendWhileDisconnected() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Progress, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, quickDraftText = "Saved text"))
    }
    composeTestRule.onNodeWithTag("quick-send").assertIsNotEnabled()
  }

  @Test fun quickAttachmentCanBePickedRemovedAndSentWithoutText() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val item = ChatAttachment("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "document",
      "brief.txt", "text/plain", 3)
    var picked = ""
    var removed = ""
    var sent = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Progress, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, realtimeStatus = "connected",
          quickAttachments = listOf(item)),
        onPickQuickAttachment = { picked = it }, onRemoveQuickAttachment = { removed = it },
        onQuickSubmit = { sent++ })
    }
    composeTestRule.onNodeWithTag("quick-attachment-${item.id}").assertExists()
    composeTestRule.onNodeWithTag("quick-send").assertIsEnabled().performClick()
    assertEquals(1, sent)
    composeTestRule.onNodeWithTag("quick-attachment-remove-${item.id}").performClick()
    assertEquals(item.id, removed)
    composeTestRule.onNodeWithTag("quick-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("quick-action-photos").assertIsEnabled().performClick()
    assertEquals("photos", picked)
    composeTestRule.onNodeWithTag("quick-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("quick-action-camera").assertIsEnabled().performClick()
    assertEquals("camera", picked)
  }

  @Test fun quickActionsReplaceDockAndKeyboardFocusClosesActions() {
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    var newChats = 0
    var destination: HomeTab? = null
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Progress, onSelectTab = { destination = it },
        connection = ConnectionUiState(profile = profile, realtimeStatus = "connected"),
        onCreateConversation = { newChats++ })
    }
    composeTestRule.onNodeWithText("Ask about progress or move work forward").assertExists()
    composeTestRule.onNodeWithTag("quick-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("quick-action-panel").assertExists()
    composeTestRule.onNodeWithTag("tab-Progress").assertDoesNotExist()
    composeTestRule.onNodeWithTag("quick-composer").performClick()
    composeTestRule.onNodeWithTag("quick-action-panel").assertDoesNotExist()
    composeTestRule.onNodeWithTag("quick-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("quick-action-new-chat").performClick()
    assert(newChats == 1 && destination == HomeTab.Assistant)
  }

  @Test fun quickReferenceWaitsForTheNewConversationBeforeOpeningPicker() {
    val oldId = "11111111-2222-3333-4444-555555555555"
    val newId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val tab = mutableStateOf(HomeTab.Progress)
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = oldId))
    var createdKind = ""
    var handled = ""
    var loads = 0
    composeTestRule.setContent {
      MainContent(selectedTab = tab.value, onSelectTab = { tab.value = it }, connection = state.value,
        onCreateReferenceConversation = { kind -> createdKind = kind },
        onReferenceRequestHandled = { id, kind ->
          handled = "$id:$kind"
          state.value = state.value.copy(requestedReferenceConversationId = null,
            requestedReferenceKind = null)
        }, onLoadReferences = { _, _ -> loads++ })
    }
    composeTestRule.onNodeWithTag("quick-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("quick-action-reference-task").assertIsEnabled().performClick()
    composeTestRule.runOnIdle { assert(createdKind == "task" && tab.value == HomeTab.Progress) }
    composeTestRule.onNodeWithTag("assistant-reference-search").assertDoesNotExist()
    composeTestRule.runOnIdle { state.value = state.value.copy(chatError = true) }
    composeTestRule.runOnIdle { assert(tab.value == HomeTab.Progress) }
    composeTestRule.runOnIdle {
      state.value = state.value.copy(selectedConversationId = newId, historyLoading = true,
        requestedReferenceConversationId = newId, requestedReferenceKind = "task")
    }
    composeTestRule.runOnIdle { assert(tab.value == HomeTab.Assistant) }
    composeTestRule.onNodeWithTag("assistant-reference-search").assertDoesNotExist()
    composeTestRule.runOnIdle { state.value = state.value.copy(historyLoading = false) }
    composeTestRule.onNodeWithTag("assistant-reference-search").assertExists()
    composeTestRule.runOnIdle { assert(handled == "$newId:task" && loads == 1) }
  }

  @Test fun remoteConversationRenameRequiresNonblankNameAndKeepsDialogOnError() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val ui = mutableStateOf(ConnectionUiState(profile = profile,
      conversations = listOf(ConversationSummary(id, "Old title", Instant.now().toString(), 2, "main"))))
    var saved = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {}, connection = ui.value,
        onBeginRename = { ui.value = ui.value.copy(renameDraftId = it, renameDraftText = "Old title") },
        onRenameDraftChange = { ui.value = ui.value.copy(renameDraftText = it) },
        onSaveRename = { saved++ })
    }
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("rename-conversation-$id").performClick()
    composeTestRule.onNodeWithTag("conversations-rename-input").performTextClearance()
    composeTestRule.onNodeWithTag("conversations-rename-save").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("conversations-rename-input").performTextInput("New title")
    composeTestRule.onNodeWithTag("conversations-rename-save").assertIsEnabled().performClick()
    assert(saved == 1)
    composeTestRule.runOnIdle { ui.value = ui.value.copy(renameError = true) }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_rename_error)).assertExists()
  }

  @Test fun conversationShareWaitsForConfirmationAndShowsResult() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val state = mutableStateOf(ConnectionUiState(profile = profile,
      conversations = listOf(ConversationSummary(id, "Share test", Instant.now().toString(), 2, "main"))))
    var begins = 0
    var confirms = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {}, connection = state.value,
        onBeginConversationShare = {
          begins++
          state.value = state.value.copy(conversationSharePreview = ConversationSharePreview(
            id, "transcript-1", 9, "2026-10-05T00:00:00Z", "Share test", 2, 1))
        }, onConfirmConversationShare = {
          confirms++
          state.value = state.value.copy(conversationSharePreview = null,
            conversationShareResult = ConversationShare(id, "share-1", "Share test",
              "https://share.example/s/test", "public", "", "2030-01-01T00:00:00Z"))
        }, onDismissConversationShare = {
          state.value = state.value.copy(conversationSharePreview = null,
            conversationShareResult = null)
        })
    }
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("share-conversation-$id").performClick()
    composeTestRule.runOnIdle { assert(begins == 1 && confirms == 0) }
    composeTestRule.onNodeWithTag("conversations-share-confirm").performClick()
    composeTestRule.runOnIdle { assert(confirms == 1) }
    composeTestRule.onNodeWithTag("conversations-share-url").assertTextContains("https://share.example/s/test")
    composeTestRule.onNodeWithTag("conversations-share-copy").assertExists()
    composeTestRule.onNodeWithTag("conversations-share-system").assertExists()
  }

  @Test fun longPressOpensConversationActionsWithoutOpeningChat() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    var opened = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile,
          conversations = listOf(ConversationSummary(id, "Long press chat", Instant.now().toString(), 2, "main"))),
        onSelectConversation = { opened++ })
    }
    composeTestRule.onNodeWithText("Long press chat").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("pin-conversation-$id").assertExists()
    assert(opened == 0)
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_cancel)).performClick()
    composeTestRule.onNodeWithTag("pin-conversation-$id").assertDoesNotExist()
  }

  @Test fun remoteConversationPinActionReflectsStatusWithoutOpeningChat() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val item = mutableStateOf(ConversationSummary(id, "Pinned chat", Instant.now().toString(), 2, "main"))
    var selected = false
    var toggles = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversations = listOf(item.value)),
        onSelectConversation = { selected = true }, onTogglePin = {
          toggles++
          item.value = item.value.copy(status = if (item.value.status == "pinned") "active" else "pinned")
        })
    }
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("pin-conversation-$id").performClick()
    assert(toggles == 1)
    assert(!selected)
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_pinned)).assertExists()
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_unpin)).performClick()
    assert(toggles == 2)
    assert(item.value.status == "active")
  }

  @Test fun archivedConversationRemainsVisibleAndOffersUnarchive() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val item = mutableStateOf(ConversationSummary(id, "Archive test", Instant.now().toString(), 2, "main"))
    var toggles = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, conversations = listOf(item.value)),
        onToggleArchive = {
          toggles++
          item.value = item.value.copy(status = if (item.value.status == "archived") "active" else "archived")
        })
    }
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("archive-conversation-$id").performClick()
    assert(toggles == 1)
    composeTestRule.onNodeWithText("Archive test").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_archived)).assertExists()
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.conversations_unarchive)).performClick()
    assert(toggles == 2)
    assert(item.value.status == "active")
  }

  @Test fun deleteHidesRemoteRowUntilUndoWithoutCallingGatewayFromUi() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val ui = mutableStateOf(ConnectionUiState(profile = profile,
      conversations = listOf(ConversationSummary(id, "Delete test", Instant.now().toString(), 2, "main"))))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {}, connection = ui.value,
        onScheduleDelete = { ui.value = ui.value.copy(pendingDeleteId = it) },
        onUndoDelete = { ui.value = ui.value.copy(pendingDeleteId = null) })
    }
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("delete-conversation-$id").performClick()
    assert(ui.value.pendingDeleteId == id)
    composeTestRule.onNodeWithText("Delete test").assertDoesNotExist()
    composeTestRule.onNodeWithTag("conversations-undo-delete").performClick()
    composeTestRule.onNodeWithText("Delete test").assertExists()
  }

  @Test fun pendingDeleteDisablesSelectedAssistantComposer() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = id,
          pendingDeleteId = id, draftText = "Do not send", realtimeStatus = "connected"))
    }
    composeTestRule.onNodeWithTag("assistant-send").assertIsNotEnabled()
  }

  @Test fun assistantActionsAndKeyboardFocusAreMutuallyExclusive() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = id))
    }
    composeTestRule.onNodeWithTag("assistant-input").performClick()
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-panel").assertExists()
    composeTestRule.onNodeWithTag("assistant-input").assertIsNotFocused()
    composeTestRule.onNodeWithTag("tab-Assistant").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-action-photos").assertIsEnabled()
    composeTestRule.onNodeWithTag("assistant-input").performClick()
    composeTestRule.onNodeWithTag("assistant-action-panel").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
  }

  @Test fun assistantActionNewChatClosesPanelAndCallsExistingCreationPath() {
    var creates = 0
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id), onCreateConversation = { creates++ })
    }
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-new-chat").assertIsEnabled().performClick()
    assert(creates == 1)
    composeTestRule.onNodeWithTag("assistant-action-panel").assertDoesNotExist()
    composeTestRule.onNodeWithTag("tab-Assistant").assertExists()
  }

  @Test fun assistantSecondActionPageShowsVoiceModesWithoutOfferingUnimplementedCalls() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id))
    }
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-panel").performTouchInput { swipeLeft() }
    composeTestRule.onNodeWithTag("assistant-action-voice-natural").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("assistant-action-voice-assistant").assertIsNotEnabled()
  }

  @Test fun assistantKeepsConversationHeaderCompactAndMovesConfigurationIntoOptions() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, selectedAgentId = "main", selectedModelId = "test/one"))
    }
    composeTestRule.onNodeWithTag("assistant-agent").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-model").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-context").assertDoesNotExist()
    composeTestRule.onNodeWithTag("assistant-options").performClick()
    composeTestRule.onNodeWithTag("assistant-new").assertExists()
    composeTestRule.onNodeWithTag("assistant-agent").assertExists()
    composeTestRule.onNodeWithTag("assistant-model").assertExists()
    composeTestRule.onNodeWithTag("assistant-context").assertExists()
  }

  @Test fun emptyAssistantShowsWelcomeButNeverTreatsItAsAChatMessage() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val ui = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = ui.value)
    }
    composeTestRule.onNodeWithTag("assistant-welcome").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_welcome)).assertExists()
    composeTestRule.runOnIdle { ui.value = ui.value.copy(historyLoading = true) }
    composeTestRule.onNodeWithTag("assistant-welcome").assertDoesNotExist()
    composeTestRule.runOnIdle {
      ui.value = ui.value.copy(historyLoading = false,
        messages = listOf(ConversationMessage("message-1", "user", "A real message", "turn-1")))
    }
    composeTestRule.onNodeWithTag("assistant-welcome").assertDoesNotExist()
    composeTestRule.onNodeWithText("A real message").assertExists()
  }

  @Test fun taskWelcomeRecommendationFillsDraftWithoutSendingAndKeepsItEditable() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val task = ContextWorkItem("task-1", "Review release")
    val context = ConversationContext(id, null, task, null, emptyList(), false, emptyList(), false)
    val ui = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id, context = context,
      taskWelcome = TaskWelcomeInfo("Review release", "review", "verifying", "Approve the release", null, null)))
    var sends = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = ui.value,
        onDraftChange = { ui.value = ui.value.copy(draftText = it) }, onSendMessage = { sends++ })
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.welcome_task_attention_title,
      "Approve the release")).assertExists()
    composeTestRule.onNodeWithTag("assistant-welcome-recommendation").performClick()
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
    assert(ui.value.draftText.contains("Approve the release"))
    assert(sends == 0)
    composeTestRule.onNodeWithTag("assistant-input").performTextInput(" More context")
    assert(ui.value.draftText.endsWith(" More context"))
    assert(sends == 0)
  }

  @Test fun projectWelcomePrioritizesBlockerAndOnlyFillsComposer() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val project = ContextWorkItem("project-1", "Alpha")
    val context = ConversationContext(id, project, null, null, emptyList(), false, emptyList(), false)
    val ui = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id, context = context,
      projectWelcome = ProjectWelcomeInfo("Alpha", "Approval needed", "Retry build", "Ship release")))
    var sends = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = ui.value,
        onDraftChange = { ui.value = ui.value.copy(draftText = it) }, onSendMessage = { sends++ })
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.welcome_project_blocked_title,
      "Approval needed")).assertExists()
    composeTestRule.onNodeWithTag("assistant-welcome-recommendation").performClick()
    assert(ui.value.draftText.contains("Approval needed"))
    assert(sends == 0)
    composeTestRule.onNodeWithTag("assistant-input").assertIsFocused()
    composeTestRule.runOnIdle {
      ui.value = ui.value.copy(projectWelcome = ProjectWelcomeInfo("Alpha", null, "Retry build", "Ship release"))
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.welcome_project_failure_title,
      "Retry build")).assertExists()
  }

  @Test fun actionSheetBlocksDeletingTheSelectedActiveRun() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Conversations, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = id, activeRunId = "run-1",
          conversations = listOf(ConversationSummary(id, "Running chat", Instant.now().toString(), 2, "main"))))
    }
    composeTestRule.onNodeWithTag("conversation-row-$id").performTouchInput { longClick() }
    composeTestRule.onNodeWithTag("delete-conversation-$id").assertIsNotEnabled()
  }

  @Test fun assistantMessageDetailOpensGroupedExecutionAndReturns() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val ui = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      messages = listOf(ConversationMessage("message-1", "assistant", "Summary for user", "turn-1"))))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = ui.value,
        onOpenExecution = { ui.value = ui.value.copy(executionMessageId = it, executionLoading = true) },
        onCloseExecution = { ui.value = ui.value.copy(executionMessageId = null, executionDetail = null) })
    }
    composeTestRule.onNodeWithTag("message-more-message-1").performClick()
    composeTestRule.onNodeWithTag("message-detail-action").performClick()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_message_detail)).assertExists()
    composeTestRule.onNodeWithTag("message-execution").performClick()
    composeTestRule.onNodeWithTag("execution-loading").assertExists()
    composeTestRule.runOnIdle {
      ui.value = ui.value.copy(executionLoading = false, executionDetail = ExecutionDetail("turn-1", listOf(
        ExecutionStep("step-1", "tool", "search", "", "first query", "", "done"),
        ExecutionStep("step-2", "tool", "search", "", "second query", "", "done"))))
    }
    composeTestRule.onNodeWithTag("execution-group-step-1").performClick()
    composeTestRule.onNodeWithTag("execution-preview-step-2").assertExists()
    composeTestRule.onNodeWithTag("execution-back").performClick()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_message_detail)).assertExists()
  }

  @Test fun historicalLongAssistantUsesEightLinePreviewAndBottomSheetDetail() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val longAnswer = (1..9).joinToString("\n") { "第${it}行内容" }
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = id,
          messages = listOf(
            ConversationMessage("answer-long", "assistant", longAnswer, "turn-long"),
            ConversationMessage("answer-latest", "assistant", "最新消息保持展开", "turn-latest"))))
    }
    composeTestRule.onNodeWithTag("message-preview-answer-long").assertExists()
    composeTestRule.onNodeWithTag("message-view-more-answer-long").performClick()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_message_detail)).assertExists()
    composeTestRule.onNodeWithText("第9行内容").assertExists()
    composeTestRule.onNodeWithTag("message-view-more-answer-latest").assertDoesNotExist()
  }

  @Test fun assistantExecutionEntryOpensBottomSheetAndSingleToolExpands() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val ui = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      messages = listOf(ConversationMessage("answer-1", "assistant", "完成", "turn-1"))))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = ui.value,
        onOpenExecution = { ui.value = ui.value.copy(executionMessageId = it,
          executionDetail = ExecutionDetail("turn-1", listOf(
            ExecutionStep("tool-1", "tool", "fetch", "", "https://example.com/result", "", "done")))) },
        onCloseExecution = { ui.value = ui.value.copy(executionMessageId = null, executionDetail = null) })
    }
    composeTestRule.onNodeWithTag("message-steps-answer-1").performClick()
    composeTestRule.onNodeWithTag("execution-group-tool-1").assertExists()
    composeTestRule.onNodeWithTag("execution-group-tool-1").performClick()
    composeTestRule.onNodeWithTag("execution-detail-tool-1").assertExists()
    composeTestRule.onNodeWithTag("execution-preview-tool-1").assertExists()
  }

  @Test fun assistantMessageMenuCopiesAnswerOrOnlyItsCodeBlocks() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val answer = "Explanation\n```kotlin\nval x = 1\n```\nMore\n```sh\necho ok\n```"
    val copied = mutableListOf<String>()
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = id,
          messages = listOf(ConversationMessage("message-1", "assistant", answer))),
        onCopyMessageText = { copied += it })
    }
    composeTestRule.onNodeWithTag("message-more-message-1").performClick()
    composeTestRule.onNodeWithTag("message-copy-code-action").performClick()
    composeTestRule.runOnIdle { assert(copied == listOf("val x = 1\n\necho ok")) }
    composeTestRule.onNodeWithTag("message-copy-code-action").assertDoesNotExist()
    composeTestRule.onNodeWithTag("message-more-message-1").performClick()
    composeTestRule.onNodeWithTag("message-copy-action").performClick()
    composeTestRule.runOnIdle { assert(copied == listOf("val x = 1\n\necho ok", answer)) }
  }

  @Test fun assistantMessageMenuOmitsCopyCodeWithoutFencedCode() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = profile, selectedConversationId = id,
          messages = listOf(ConversationMessage("message-1", "assistant", "Plain answer"))))
    }
    composeTestRule.onNodeWithTag("message-more-message-1").performClick()
    composeTestRule.onNodeWithTag("message-copy-action").assertExists()
    composeTestRule.onNodeWithTag("message-copy-code-action").assertDoesNotExist()
  }

  @Test fun assistantMessageMenuSavesOnlyNonblankAnswerAndClosesOnSelection() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      messages = listOf(ConversationMessage("answer-1", "assistant", "Useful answer"))))
    val saved = mutableListOf<String>()
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
        onSaveMessageAsNote = { saved += it })
    }
    composeTestRule.onNodeWithTag("message-more-answer-1").performClick()
    composeTestRule.onNodeWithTag("message-save-note-action").assertIsEnabled().performClick()
    composeTestRule.runOnIdle { assertEquals(listOf("answer-1"), saved) }
    composeTestRule.onNodeWithTag("message-save-note-action").assertDoesNotExist()
    composeTestRule.runOnIdle { state.value = state.value.copy(savingMessageNoteId = "answer-1") }
    composeTestRule.onNodeWithTag("message-more-answer-1").performClick()
    composeTestRule.onNodeWithTag("message-save-note-action").assertIsNotEnabled()
  }

  @Test fun userMessageReuseFillsEditableDraftWithoutSending() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      messages = listOf(ConversationMessage("user-1", "user", "Original request")), draftText = "Other draft"))
    var reused = ""
    var sends = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
        onReuseMessage = { messageId ->
          reused = messageId
          state.value = state.value.copy(draftText = "Original request")
          true
        }, onSendMessage = { sends++ })
    }
    composeTestRule.onNodeWithTag("message-more-user-1").performClick()
    composeTestRule.onNodeWithTag("message-reuse-action").performClick()
    composeTestRule.onNodeWithTag("assistant-input").assertTextEquals("Original request")
    composeTestRule.runOnIdle {
      assertEquals("user-1", reused)
      assertEquals(0, sends)
    }
    composeTestRule.onNodeWithTag("message-reuse-action").assertDoesNotExist()
  }

  @Test fun userMessageReuseDoesNotDropMediaOrStagedReferences() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      messages = listOf(ConversationMessage("media", "user", "Look here", hasNonTextContent = true),
        ConversationMessage("plain", "user", "Text only")),
      draftRefs = listOf(ConversationContextRef("note", "note-1", "1", "Note"))))
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value)
    }
    composeTestRule.onNodeWithTag("message-more-media").performClick()
    composeTestRule.onNodeWithTag("message-reuse-action").assertDoesNotExist()
    composeTestRule.onNodeWithTag("message-copy-action").performClick()
    composeTestRule.onNodeWithTag("message-more-plain").performClick()
    composeTestRule.onNodeWithTag("message-reuse-action").assertIsNotEnabled()
  }

  @Test fun assistantAttachmentActionStagesAndCanSendWithoutText() {
    val id = "11111111-2222-3333-4444-555555555555"
    val profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), "")
    val item = ChatAttachment("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "document",
      "brief.txt", "text/plain", 3)
    val state = mutableStateOf(ConnectionUiState(profile = profile, selectedConversationId = id,
      realtimeStatus = "connected", draftAttachments = listOf(item)))
    var picked = ""
    var removed = ""
    var sent = 0
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {}, connection = state.value,
        onPickDraftAttachment = { picked = it }, onRemoveDraftAttachment = { removed = it },
        onSendMessage = { sent++ })
    }
    composeTestRule.onNodeWithTag("assistant-attachment-${item.id}").assertExists()
    composeTestRule.onNodeWithTag("assistant-send").assertIsEnabled().performClick()
    assertEquals(1, sent)
    composeTestRule.onNodeWithTag("assistant-attachment-remove-${item.id}").performClick()
    assertEquals(item.id, removed)
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-photos").assertIsEnabled().performClick()
    assertEquals("photos", picked)
    composeTestRule.onNodeWithTag("assistant-actions-toggle").performClick()
    composeTestRule.onNodeWithTag("assistant-action-camera").assertIsEnabled().performClick()
    assertEquals("camera", picked)
  }

  @Test
  fun localDraftCanOpenBeforeGatewayHasListedIt() {
    var created = 0
    var sent = 0
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, draftText = "Hello", realtimeStatus = "connected", draftModelReady = true),
        onCreateConversation = { created++ }, onSendMessage = { sent++ })
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_new_conversation)).assertExists()
    composeTestRule.onNodeWithTag("assistant-send").assertIsEnabled().performClick()
    composeTestRule.onNodeWithTag("assistant-options").performClick()
    composeTestRule.onNodeWithTag("assistant-new").performClick()
    assert(sent == 1)
    assert(created == 1)
  }

  @Test
  fun localDraftWaitsForModelBeforeSending() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, draftText = "Hello", realtimeStatus = "connected", draftModelLoading = true,
          draftModelReady = false))
    }
    composeTestRule.onNodeWithTag("assistant-send").assertIsNotEnabled()
  }

  @Test
  fun activeRunShowsStopAndInvokesCallback() {
    var stops = 0
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, activeRunId = "run-1", realtimeStatus = "connected"),
        onStopRun = { stops++ })
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_running)).assertExists()
    composeTestRule.onNodeWithTag("assistant-stop").assertIsEnabled().performClick()
    assert(stops == 1)
  }

  @Test fun contextDialogShowsScopeAndRefreshesOnOpen() {
    var refreshes = 0
    val id = "11111111-2222-3333-4444-555555555555"
    val context = ConversationContext(id, ContextWorkItem("p", "Alpha"), ContextWorkItem("t", "Review"),
      ContextEnvironment("managed_worktree", "/work/alpha", true, "main"),
      listOf(ContextSource("n", "Brief", false)), false, emptyList(), true)
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, context = context), onReloadContext = { refreshes++ })
    }
    composeTestRule.onNodeWithTag("assistant-options").performClick()
    composeTestRule.onNodeWithTag("assistant-context").performClick()
    assert(refreshes == 1)
    composeTestRule.onNodeWithText("/work/alpha").assertExists()
    composeTestRule.onNodeWithText("Brief").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_context_locked)).assertExists()
  }

  @Test
  fun stoppingRunDisablesRepeatedStop() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, activeRunId = "run-1", stoppingRun = true))
    }
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_stopping)).assertExists()
    composeTestRule.onNodeWithTag("assistant-stop").assertIsNotEnabled()
  }

  @Test
  fun activeRunRendersLiveOutputWithoutChangingSavedMessages() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, activeRunId = "run-1", liveText = "Partial answer"))
    }
    composeTestRule.onNodeWithText("Partial answer").assertExists()
    composeTestRule.onNodeWithText(composeTestRule.activity.getString(R.string.assistant_live_output)).assertExists()
  }

  @Test
  fun restoredPendingInputBlocksNewSendAndOffersExplicitRetry() {
    var retries = 0
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, draftText = "New draft", pendingInput = PendingInput(id, "Unconfirmed input"),
          realtimeStatus = "connected"), onRetryPendingInput = { retries++ })
    }
    composeTestRule.onNodeWithText("Unconfirmed input").assertExists()
    composeTestRule.onNodeWithTag("assistant-send").assertIsNotEnabled()
    composeTestRule.onNodeWithTag("assistant-retry").assertIsEnabled().performClick()
    assert(retries == 1)
  }

  @Test
  fun modelPickerShowsSelectedModelAndRoutesChoice() {
    var selected = ""
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, selectedModelId = "test/one",
          models = listOf(ConversationModel("test/one", "One", "off"), ConversationModel("test/two", "Two", "low"))),
        onSelectModel = { selected = it })
    }
    composeTestRule.onNodeWithTag("assistant-options").performClick()
    composeTestRule.onNodeWithTag("assistant-model").performClick()
    composeTestRule.onNodeWithTag("model-test/two").performClick()
    assert(selected == "test/two")
  }

  @Test
  fun modelPickerBlocksChangesDuringRun() {
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, selectedModelId = "test/one", activeRunId = "run-1",
          models = listOf(ConversationModel("test/two", "Two", "low"))))
    }
    composeTestRule.onNodeWithTag("assistant-options").performClick()
    composeTestRule.onNodeWithTag("assistant-model").performClick()
    composeTestRule.onNodeWithTag("model-test/two").assertIsNotEnabled()
  }

  @Test
  fun agentSwitchConfirmsDiscardBeforeCreatingNewConversation() {
    var chosen = ""
    var discarded = false
    val id = "11111111-2222-3333-4444-555555555555"
    composeTestRule.setContent {
      MainContent(selectedTab = HomeTab.Assistant, onSelectTab = {},
        connection = ConnectionUiState(profile = GatewayProfile("gateway", "Test", "key", "device", emptyList(), ""),
          selectedConversationId = id, selectedAgentId = "main", draftText = "Unsent draft",
          agents = listOf(ConversationAgent("main", "Main", ""), ConversationAgent("research", "Research", ""))),
        onSwitchAgent = { agent, discard -> chosen = agent; discarded = discard })
    }
    composeTestRule.onNodeWithTag("assistant-options").performClick()
    composeTestRule.onNodeWithTag("assistant-agent").performClick()
    composeTestRule.onNodeWithTag("agent-research").performClick()
    assert(chosen.isEmpty())
    composeTestRule.onNodeWithTag("agent-discard-confirm").performClick()
    assert(chosen == "research")
    assert(discarded)
  }
}
