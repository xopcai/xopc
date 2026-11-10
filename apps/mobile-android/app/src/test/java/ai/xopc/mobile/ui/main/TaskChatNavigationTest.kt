package ai.xopc.mobile.ui.main

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskChatNavigationTest {
  @Test fun nestedTasksReturnToTheirOriginConversation() {
    val navigation = TaskChatNavigation()
    val origin = ConnectionUiState(selectedConversationId = "origin")
    val task = origin.copy(selectedConversationId = "task-chat", taskConversationTaskId = "task")
    navigation.open("task", origin) {}
    navigation.settle(task)
    navigation.open("child", task) {}
    navigation.settle(task.copy(selectedConversationId = "child-chat", taskConversationTaskId = "child"))
    val returned = mutableListOf<String>()
    navigation.close(returned::add) {}
    navigation.close(returned::add) {}
    assertEquals(listOf("task-chat", "origin"), returned)
    assertFalse(navigation.canReturn)
  }

  @Test fun failedTaskOpeningPreservesTheOriginAndRemovesItsPendingReturn() {
    val navigation = TaskChatNavigation()
    val origin = ConnectionUiState(selectedConversationId = "origin")
    navigation.open("task", origin) {}
    assertTrue(navigation.settle(origin.copy(progress = origin.progress.copy(taskChatError = true))))
    assertFalse(navigation.canReturn)
    assertFalse(navigation.settle(origin))
  }
}
