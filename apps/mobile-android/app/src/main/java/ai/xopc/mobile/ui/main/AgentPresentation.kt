package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ConversationAgent
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource

private data class BuiltInAgent(val avatar: Int, val name: Int, val description: Int,
  val defaultNames: List<String>, val defaultDescriptions: List<String>)

private val builtIns = mapOf(
  "main" to BuiltInAgent(R.drawable.agent_main, R.string.agent_builtin_assistant_name, R.string.agent_builtin_assistant_description,
    listOf("Main", "Smart Assistant"), listOf("General assistant", "General-purpose personal assistant.",
      "Your personal intelligent assistant for answering questions, handling everyday tasks, and chatting with you anytime.")),
  "conductor" to BuiltInAgent(R.drawable.agent_conductor, R.string.agent_builtin_conductor_name, R.string.agent_builtin_conductor_description,
    listOf("Conductor"), listOf("Talks with the user, delegates complex work to specialist Agents, and delivers verified results.",
      "User-facing coordination Agent for task planning, delegation, progress, verification, and reporting to the user.")),
  "task-router" to BuiltInAgent(R.drawable.agent_task_router, R.string.agent_builtin_task_router_name, R.string.agent_builtin_task_router_description,
    listOf("Task Router"), listOf("Selects one suitable specialist for a delegated task.")),
  "coder" to BuiltInAgent(R.drawable.agent_coder, R.string.agent_builtin_coding_name, R.string.agent_builtin_coding_description,
    listOf("Coder", "Coding Expert"), listOf("Software development, debugging, refactoring, and tests.",
      "Software engineering agent for repository understanding, implementation, debugging, refactoring, tests, and review.")),
  "writer" to BuiltInAgent(R.drawable.agent_writer, R.string.agent_builtin_writing_name, R.string.agent_builtin_writing_description,
    listOf("Writer", "Writing Assistant"), listOf("Drafting, editing, rewriting, and audience-aware content.")),
  "researcher" to BuiltInAgent(R.drawable.agent_researcher, R.string.agent_builtin_research_name, R.string.agent_builtin_research_description,
    listOf("Researcher", "Research Assistant"), listOf("Deep research, source comparison, and fact synthesis.")),
  "data-analyst" to BuiltInAgent(R.drawable.agent_data_analyst, R.string.agent_builtin_data_name, R.string.agent_builtin_data_description,
    listOf("Data Analyst"), listOf("Data cleaning, analysis, visualization, and reproducible reports.")),
  "creative" to BuiltInAgent(R.drawable.agent_creative, R.string.agent_builtin_creative_name, R.string.agent_builtin_creative_description,
    listOf("Creative", "Creative Assistant"), listOf("Visual direction, image prompts, design critique, and creative options.")),
)

internal fun builtInAgentAvatar(id: String): Int? = builtIns[id]?.avatar

private fun String.matchesDefault(values: List<String>): Boolean = isBlank() || values.any { equals(it, ignoreCase = true) }

@Composable
internal fun agentDisplayName(agent: ConversationAgent): String {
  val name = agent.name.trim()
  val builtIn = builtIns[agent.id]
  return if (builtIn != null && name.matchesDefault(builtIn.defaultNames + agent.id)) stringResource(builtIn.name)
  else name.ifBlank { agent.id }
}

@Composable
internal fun agentDisplayDescription(agent: ConversationAgent): String {
  val description = agent.description.trim()
  if (agent.id.matches(Regex("personal-[a-f0-9]{12}")) && description.matchesDefault(
    listOf("A personal AI that adapts its responses to the user and coordinates work.")))
    return stringResource(R.string.agent_personal_description)
  val builtIn = builtIns[agent.id]
  return if (builtIn != null && description.matchesDefault(builtIn.defaultDescriptions)) stringResource(builtIn.description)
  else description
}
