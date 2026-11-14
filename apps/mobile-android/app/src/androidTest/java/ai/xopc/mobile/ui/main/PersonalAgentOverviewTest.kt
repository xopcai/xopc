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
import androidx.compose.ui.test.assertWidthIsEqualTo
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeDown
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
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
    var opened = ""
    compose.setContent {
      MaterialTheme {
        PersonalOverviewContent(PersonalAgentRecord("ada", "personal", "ready", "Ada", "loopi", null),
          null, null, library.value, { library.value = it },
          PersonalOverviewList(PersonalWorkPage(work, emptyList(), 0), loading = false),
          PersonalOverviewList(emptyList(), loading = false),
          PersonalOverviewList(PersonalDeliveryPage(listOf(file), null), loading = false),
          {}, {}, {}, {}, {}, { opened = it.id }, {}, {}, {}, Modifier)
      }
    }
    val portrait = compose.onNodeWithTag("personal-overview-avatar")
    portrait.assertWidthIsEqualTo(116.dp)
    val tasks = compose.onNodeWithTag("personal-overview-task-list")
    tasks.performTouchInput { swipeUp() }
    portrait.assertWidthIsEqualTo(68.dp)
    tasks.performTouchInput { swipeDown() }
    portrait.assertWidthIsEqualTo(116.dp)
    compose.onNodeWithTag("personal-overview-library-tab").performClick()
    compose.onNodeWithTag("personal-overview-delivery-delivery").performClick()
    assertEquals("delivery", opened)
  }
}
