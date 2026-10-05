package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ShareItem
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.unit.dp
import com.google.zxing.BinaryBitmap
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ShareCenterScreenTest {
  @get:Rule val composeTestRule = createAndroidComposeRule<ComponentActivity>()

  @Test fun activeShareSupportsPreviewExtendAndConfirmedRevokeWhileInactiveIsReadOnly() {
    val active = ShareItem("active", "note", "Active note", "https://share.example/a", null,
      "public", "", "2030-01-01T00:00:00Z", false, false)
    val inactive = active.copy(id = "inactive", title = "Old note", revoked = true)
    val state = mutableStateOf(ShareCenterUiState("gateway", listOf(active, inactive)))
    var extended: Pair<String, Int>? = null
    var revoked: String? = null
    composeTestRule.setContent {
      ShareCenterScreen(state.value, true, PaddingValues(0.dp), onBack = {}, onRefresh = {},
        onRevoke = { revoked = it }, onExtend = { id, days -> extended = id to days })
    }
    composeTestRule.onNodeWithTag("share-active").assertExists()
    composeTestRule.onNodeWithTag("share-inactive").assertDoesNotExist()
    composeTestRule.onNodeWithTag("share-active").performClick()
    composeTestRule.onNodeWithTag("share-preview-url").assertExists()
    composeTestRule.onNodeWithTag("share-qr").performClick()
    composeTestRule.onNodeWithTag("share-qr-view").assertExists()
    composeTestRule.onNodeWithTag("share-preview-back").performClick()
    composeTestRule.onNodeWithTag("share-preview-url").assertExists()
    composeTestRule.onNodeWithTag("share-preview-close").performClick()
    composeTestRule.onNodeWithTag("share-menu-active").performClick()
    composeTestRule.onNodeWithTag("share-extend").performClick()
    composeTestRule.onNodeWithTag("share-extend-3").performClick()
    assertEquals("active" to 3, extended)
    composeTestRule.onNodeWithTag("share-menu-active").performClick()
    composeTestRule.onNodeWithTag("share-revoke").performClick()
    assertEquals(null, revoked)
    composeTestRule.onNodeWithTag("share-revoke-confirm").performClick()
    assertEquals("active", revoked)
    composeTestRule.runOnIdle { state.value = state.value.copy(
      items = listOf(active.copy(revoked = true), inactive)) }
    composeTestRule.onNodeWithTag("share-active").assertDoesNotExist()
    composeTestRule.onNodeWithTag("shares-toggle-inactive").performClick()
    composeTestRule.onNodeWithTag("share-inactive").assertExists()
    composeTestRule.onNodeWithTag("share-menu-inactive").performClick()
    composeTestRule.onNodeWithTag("share-preview").assertExists()
    composeTestRule.onNodeWithTag("share-extend").assertDoesNotExist()
    composeTestRule.onNodeWithTag("share-revoke").assertDoesNotExist()
  }

  @Test fun webPreviewNavigationAllowsOnlyTheShareOrigin() {
    val source = "https://share.example/s/token"
    assertEquals(true, shareSameOrigin("https://share.example/another", source))
    assertEquals(false, shareSameOrigin("http://share.example/another", source))
    assertEquals(false, shareSameOrigin("https://evil.example/", source))
    assertEquals(false, shareSameOrigin("https://share.example.evil.test/", source))
    assertEquals(false, shareSameOrigin("javascript:alert(1)", source))
    assertEquals(false, shareSameOrigin("https://user@share.example/", source))
  }

  @Test fun shareQrEncodesTheExactLink() {
    val url = "https://share.example/s/token?x=1"
    val bitmap = shareQrBitmap(url)
    val pixels = IntArray(bitmap.width * bitmap.height)
    bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
    val image = BinaryBitmap(HybridBinarizer(RGBLuminanceSource(bitmap.width, bitmap.height, pixels)))
    assertEquals(url, QRCodeReader().decode(image).text)
  }

  @Test fun pullToRefreshRequestsAListReload() {
    val item = ShareItem("share-1", "note", "Test", "https://share.example/s/1", null,
      "public", "", "2030-01-01T00:00:00Z", false, false)
    var refreshes = 0
    composeTestRule.setContent {
      ShareCenterScreen(ShareCenterUiState("gateway", listOf(item)), true, PaddingValues(0.dp),
        onBack = {}, onRefresh = { refreshes++ }, onRevoke = {}, onExtend = { _, _ -> })
    }
    composeTestRule.onNodeWithTag("shares-list").performTouchInput { swipeDown() }
    composeTestRule.runOnIdle { assertEquals(1, refreshes) }
  }
}
