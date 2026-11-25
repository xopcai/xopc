package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.PersonalAgentRecord
import ai.xopc.mobile.gateway.PersonalDelivery
import ai.xopc.mobile.gateway.PersonalDeliveryPage
import ai.xopc.mobile.gateway.PersonalWork
import ai.xopc.mobile.gateway.PersonalWorkPage
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class PersonalAgentOverviewTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun avatarFollowsScrollingAndLibraryOpensTheAssociatedDelivery() {
    val work = List(20) { index ->
      PersonalWork("task-$index", "Task $index", "active", "running", "running", index == 0, 123L)
    }
    val file = PersonalDelivery("delivery", "Weekly report", "Reporting", "source", null, null, null)
    val library = mutableStateOf(false)
    val deliveries = mutableStateOf(PersonalOverviewList<PersonalDeliveryPage>())
    var opened = ""
    var editOpened = false
    compose.setContent {
      MaterialTheme {
        PersonalOverviewContent(PersonalAgentRecord("ada", "personal", "ready", "Ada", "loopi", null),
          null, null, library.value, { library.value = it },
          PersonalOverviewList(PersonalWorkPage(work, emptyList(), 0), loading = false),
          PersonalOverviewList(emptyList(), loading = false),
          deliveries.value,
          {}, { editOpened = true }, {}, {}, {}, { opened = it.id }, {}, {}, {}, Modifier)
      }
    }
    val portrait = compose.onNodeWithTag("personal-overview-avatar")
    val name = compose.onNodeWithText("Ada")
    fun assertAvatarAboveName() {
      val avatarBounds = portrait.getUnclippedBoundsInRoot()
      val nameBounds = name.getUnclippedBoundsInRoot()
      val avatarCenter = (avatarBounds.left.value + avatarBounds.right.value) / 2
      val nameCenter = (nameBounds.left.value + nameBounds.right.value) / 2
      assertEquals(nameCenter, avatarCenter, 1f)
      assertTrue(avatarBounds.bottom <= nameBounds.top)
    }
    portrait.assertWidthIsEqualTo(116.dp)
    assertAvatarAboveName()
    val tasks = compose.onNodeWithTag("personal-overview-task-list")
    tasks.performTouchInput { swipeUp() }
    portrait.assertWidthIsEqualTo(68.dp)
    assertAvatarAboveName()
    portrait.performTouchInput { click() }
    compose.runOnIdle { assertTrue(editOpened) }
    tasks.performTouchInput { swipeDown() }
    portrait.assertWidthIsEqualTo(116.dp)
    assertAvatarAboveName()
    val indicator = compose.onNodeWithTag("segmented-tab-indicator")
    val taskEdge = indicator.getUnclippedBoundsInRoot().left
    tasks.performTouchInput {
      down(center)
      moveBy(Offset(-width * 0.22f, 0f))
    }
    assertTrue(indicator.getUnclippedBoundsInRoot().left > taskEdge)
    tasks.performTouchInput { cancel() }
    compose.onNodeWithTag("personal-overview-tasks-tab").assertIsSelected()
    tasks.performTouchInput { swipeLeft() }
    compose.onNodeWithTag("personal-overview-library-tab").assertIsSelected()
    val skeleton = compose.onNodeWithTag("personal-overview-library-loading")
    skeleton.assertExists()
    val item = compose.onNodeWithTag("personal-overview-delivery-delivery")
    item.assertDoesNotExist()
    compose.runOnIdle { deliveries.value = PersonalOverviewList(PersonalDeliveryPage(listOf(file), 15)) }
    skeleton.assertDoesNotExist()
    compose.onNodeWithTag("personal-overview-library-loading-more").assertExists()
    item.performClick()
    assertEquals("delivery", opened)
  }
}
