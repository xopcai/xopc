package ai.xopc.mobile.ui.main

import ai.xopc.mobile.gateway.ExecutionStep

data class ExecutionGroup(val id: String, val kind: String, val category: String, val status: String,
  val steps: List<ExecutionStep>)

/** Group adjacent public tool steps without exposing private reasoning or raw tool payloads. */
object ExecutionGroups {
  fun group(steps: List<ExecutionStep>, live: Boolean): List<ExecutionGroup> {
    val groups = mutableListOf<ExecutionGroup>()
    steps.forEach { step ->
      if (step.kind == "thinking") return@forEach
      val status = if (step.status == "running" && !live) "stopped" else step.status
      val previous = groups.lastOrNull()
      if (step.kind == "tool" && previous?.kind == "tool" && previous.category == step.category &&
        previous.status == status && status != "error") {
        groups[groups.lastIndex] = previous.copy(steps = previous.steps + step)
      } else {
        groups += ExecutionGroup(step.id, step.kind, step.category, status, listOf(step))
      }
    }
    return groups
  }
}
