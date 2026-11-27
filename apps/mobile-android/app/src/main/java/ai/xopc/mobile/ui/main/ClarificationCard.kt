package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.ClarificationChoice
import ai.xopc.mobile.gateway.ClarificationCommand
import ai.xopc.mobile.gateway.ClarificationRequest
import ai.xopc.mobile.theme.ClarificationThemeColors
import ai.xopc.mobile.theme.LocalClarificationThemeColors
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

internal typealias ClarificationPalette = ClarificationThemeColors

@Composable
internal fun rememberClarificationPalette(): ClarificationPalette =
  LocalClarificationThemeColors.current

@Composable
internal fun ClarificationCardSurface(
  palette: ClarificationPalette,
  modifier: Modifier = Modifier,
  content: @Composable () -> Unit,
) {
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(20.dp),
    color = palette.surface,
    contentColor = palette.primaryText,
    content = content,
  )
}

@Composable
internal fun ClarificationCollapsedBar(
  title: String,
  progress: String?,
  palette: ClarificationPalette,
  onExpand: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(18.dp),
    color = palette.surface,
    contentColor = palette.primaryText,
  ) {
    Row(
      Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Box(Modifier.size(8.dp).clip(CircleShape).background(palette.accent))
      Text(
        title,
        style = MaterialTheme.typography.bodyMedium,
        fontWeight = FontWeight.Medium,
        color = palette.primaryText,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.weight(1f),
      )
      if (progress != null) {
        Text(progress, style = MaterialTheme.typography.labelSmall, color = palette.secondaryText)
      }
      Surface(
        shape = CircleShape,
        color = palette.tonalFill,
        modifier = Modifier.clip(CircleShape).clickable(role = Role.Button, onClick = onExpand),
      ) {
        Row(
          Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
          Text(
            stringResource(R.string.clarify_expand),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            color = palette.tonalText,
          )
          Icon(
            painterResource(R.drawable.action_chevron_down),
            contentDescription = null,
            tint = palette.tonalText,
            modifier = Modifier.size(12.dp).rotate(180f),
          )
        }
      }
    }
  }
}

@Composable
internal fun ClarificationHeaderActions(
  showMenu: Boolean,
  disabled: Boolean,
  palette: ClarificationPalette,
  onAgentDecide: () -> Unit,
  onCancel: () -> Unit,
  onCollapse: () -> Unit,
) {
  var menuOpen by remember { mutableStateOf(false) }
  Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
    if (showMenu) {
      Box {
        IconButton(
          onClick = { menuOpen = true },
          enabled = !disabled,
          modifier = Modifier.size(32.dp),
        ) {
          Icon(
            painterResource(R.drawable.action_more_horizontal),
            contentDescription = stringResource(R.string.clarify_more),
            tint = palette.secondaryText,
            modifier = Modifier.size(18.dp),
          )
        }
        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
          DropdownMenuItem(
            text = { Text(stringResource(R.string.voice_agent_decide)) },
            onClick = { menuOpen = false; onAgentDecide() },
          )
          DropdownMenuItem(
            text = { Text(stringResource(R.string.clarify_cancel), color = palette.danger) },
            onClick = { menuOpen = false; onCancel() },
          )
        }
      }
    }
    IconButton(onClick = onCollapse, modifier = Modifier.size(32.dp)) {
      Icon(
        painterResource(R.drawable.action_chevron_down),
        contentDescription = stringResource(R.string.clarify_collapse),
        tint = palette.secondaryText,
        modifier = Modifier.size(16.dp),
      )
    }
  }
}

@Composable
internal fun ClarificationOptionsGroup(
  choices: List<ClarificationChoice>,
  recommendedId: String?,
  selectedId: String?,
  customExpanded: Boolean,
  disabled: Boolean,
  palette: ClarificationPalette,
  onPick: (String) -> Unit,
  onToggleCustom: () -> Unit,
) {
  val haptic = LocalHapticFeedback.current
  Column(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(palette.grouped),
  ) {
    choices.forEachIndexed { index, choice ->
      if (index > 0) {
        HorizontalDivider(
          modifier = Modifier.padding(start = 14.dp),
          thickness = 0.5.dp,
          color = palette.divider,
        )
      }
      val isSelected = selectedId == choice.id
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .background(if (isSelected) palette.accentSoft else Color.Transparent)
          .semantics { selected = isSelected }
          .clickable(enabled = !disabled, role = Role.RadioButton) {
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onPick(choice.id)
          }
          .padding(horizontal = 14.dp, vertical = 12.dp)
          .defaultMinSize(minHeight = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
          Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            Text(
              choice.label,
              style = MaterialTheme.typography.bodyMedium,
              fontWeight = FontWeight.Medium,
              color = if (isSelected) palette.accentText else palette.primaryText,
            )
            if (choice.id == recommendedId) {
              Surface(shape = CircleShape, color = palette.accentSoft) {
                Text(
                  stringResource(R.string.clarify_recommended),
                  style = MaterialTheme.typography.labelSmall,
                  fontWeight = FontWeight.Medium,
                  color = palette.accentText,
                  modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                )
              }
            }
          }
          choice.description?.takeIf(String::isNotBlank)?.let { desc ->
            Text(desc, style = MaterialTheme.typography.bodySmall, color = palette.secondaryText)
          }
        }
        Box(
          modifier = Modifier
            .size(20.dp)
            .clip(CircleShape)
            .then(
              if (isSelected) Modifier.background(palette.accent)
              else Modifier.border(1.5.dp, palette.tertiaryText.copy(alpha = 0.55f), CircleShape),
            ),
          contentAlignment = Alignment.Center,
        ) {
          if (isSelected) {
            Text("✓", color = palette.onAccent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
          }
        }
      }
    }
    HorizontalDivider(modifier = Modifier.padding(start = 14.dp), thickness = 0.5.dp, color = palette.divider)
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .clickable(enabled = !disabled, role = Role.Button, onClick = onToggleCustom)
        .padding(horizontal = 14.dp, vertical = 12.dp),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Text(
        stringResource(if (selectedId == null) R.string.clarify_custom else R.string.clarify_supplement),
        style = MaterialTheme.typography.bodyMedium,
        color = palette.secondaryText,
        modifier = Modifier.weight(1f),
      )
      Icon(
        painterResource(R.drawable.action_chevron_right),
        contentDescription = null,
        tint = palette.tertiaryText,
        modifier = Modifier.size(14.dp).rotate(if (customExpanded) 90f else 0f),
      )
    }
  }
}

@Composable
internal fun ClarificationCustomEditor(
  selectedLabel: String?,
  text: String,
  onTextChange: (String) -> Unit,
  limit: Int,
  disabled: Boolean,
  palette: ClarificationPalette,
  onClearSelection: () -> Unit,
) {
  val trimmedLen = text.trim().length
  val tooLong = trimmedLen > limit
  Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
    if (selectedLabel != null) {
      Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
          selectedLabel,
          style = MaterialTheme.typography.labelSmall,
          color = palette.secondaryText,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f),
        )
        Text(
          stringResource(R.string.clarify_clear),
          style = MaterialTheme.typography.labelSmall,
          color = palette.tertiaryText,
          modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .clickable(enabled = !disabled, onClick = onClearSelection)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        )
      }
    }
    OutlinedTextField(
      value = text,
      onValueChange = onTextChange,
      minLines = 2,
      maxLines = 5,
      enabled = !disabled,
      isError = tooLong,
      modifier = Modifier.fillMaxWidth(),
      shape = RoundedCornerShape(12.dp),
      placeholder = {
        Text(
          stringResource(if (selectedLabel == null) R.string.clarify_placeholder else R.string.clarify_supplement),
          color = palette.tertiaryText,
        )
      },
      colors = OutlinedTextFieldDefaults.colors(
        focusedContainerColor = palette.inputFill,
        unfocusedContainerColor = palette.inputFill,
        disabledContainerColor = palette.inputFill,
        errorContainerColor = palette.inputFill,
        focusedBorderColor = Color.Transparent,
        unfocusedBorderColor = Color.Transparent,
        disabledBorderColor = Color.Transparent,
        errorBorderColor = Color.Transparent,
        focusedTextColor = palette.primaryText,
        unfocusedTextColor = palette.primaryText,
      ),
    )
    if (trimmedLen >= (limit * 4) / 5) {
      Text(
        "$trimmedLen/$limit",
        style = MaterialTheme.typography.labelSmall,
        color = if (tooLong) palette.danger else palette.tertiaryText,
      )
    }
  }
}

@Composable
internal fun ClarificationCard(
  request: ClarificationRequest,
  submitting: Boolean,
  error: String?,
  onCommand: (ClarificationCommand) -> Unit,
  modifier: Modifier = Modifier,
) {
  if (request.schemaVersion == 2) {
    ClarificationWizard(request, submitting, error, onCommand, modifier)
    return
  }
  val palette = rememberClarificationPalette()
  val haptic = LocalHapticFeedback.current
  var draft by rememberSaveable(request.id) { mutableStateOf("") }
  var selected by rememberSaveable(request.id) { mutableStateOf<String?>(null) }
  var editing by rememberSaveable(request.id) { mutableStateOf(false) }
  var collapsed by rememberSaveable(request.id) { mutableStateOf(false) }
  var paramsOpen by rememberSaveable(request.id) { mutableStateOf(false) }
  var now by remember(request.id) { mutableLongStateOf(System.currentTimeMillis()) }
  LaunchedEffect(request.id, request.expiresAt) {
    if (request.expiresAt != null) while (true) { now = System.currentTimeMillis(); delay(1000) }
  }
  val expired = request.expired(now)
  val disabled = submitting || expired
  val compose = editing || request.choiceDetails.isEmpty()
  val text = draft.trim()
  val remainingSeconds = request.expiresAt?.let { ((it - now - request.clockOffset).coerceAtLeast(0) + 999) / 1000 }

  if (collapsed && request.kind != "approval") {
    ClarificationCollapsedBar(
      title = request.question,
      progress = null,
      palette = palette,
      onExpand = { collapsed = false },
      modifier = modifier,
    )
    return
  }

  if (request.kind == "approval") {
    val approval = request.approval
    val operation = approval?.optString("operation")?.takeIf(String::isNotBlank) ?: request.question
    val target = approval?.optString("target")?.takeIf(String::isNotBlank)
    val impact = approval?.optString("impact")?.takeIf(String::isNotBlank)
    val argsPreview = if (approval?.has("argumentsPreview") == true) approval.optJSONObject("argumentsPreview") else null
    val urgent = remainingSeconds != null && remainingSeconds in 1..60

    ClarificationCardSurface(palette, modifier) {
      Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Box(
            Modifier.size(34.dp).clip(RoundedCornerShape(10.dp)).background(palette.badgeAmberFill),
            contentAlignment = Alignment.Center,
          ) {
            Icon(
              painterResource(R.drawable.action_check_circle),
              contentDescription = null,
              tint = palette.badgeAmberTint,
              modifier = Modifier.size(18.dp),
            )
          }
          Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(stringResource(R.string.clarify_approval_title), style = MaterialTheme.typography.labelMedium, color = palette.secondaryText)
            Text(operation, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.primaryText)
          }
          remainingSeconds?.let { seconds ->
            Surface(
              shape = CircleShape,
              color = when {
                seconds == 0L -> palette.danger.copy(alpha = 0.12f)
                urgent -> palette.badgeAmberFill
                else -> palette.grouped
              },
            ) {
              Text(
                if (seconds == 0L) stringResource(R.string.clarify_expired)
                else stringResource(R.string.clarify_remaining, seconds / 60, seconds % 60),
                style = MaterialTheme.typography.labelSmall,
                color = when {
                  seconds == 0L -> palette.danger
                  urgent -> palette.badgeAmberTint
                  else -> palette.secondaryText
                },
                modifier = Modifier.padding(horizontal = 9.dp, vertical = 4.dp),
              )
            }
          }
        }

        if (request.question.isNotBlank() && request.question.trim() != operation.trim()) {
          Text(request.question, style = MaterialTheme.typography.bodySmall, color = palette.secondaryText)
        }

        if (target != null || impact != null || argsPreview != null) {
          Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(palette.grouped)) {
            var hasRow = false
            if (target != null) {
              ApprovalKeyValueRow(stringResource(R.string.clarify_target), target, palette)
              hasRow = true
            }
            if (impact != null) {
              if (hasRow) HorizontalDivider(Modifier.padding(start = 14.dp), thickness = 0.5.dp, color = palette.divider)
              ApprovalKeyValueRow(stringResource(R.string.clarify_impact), impact, palette)
              hasRow = true
            }
            if (argsPreview != null) {
              if (hasRow) HorizontalDivider(Modifier.padding(start = 14.dp), thickness = 0.5.dp, color = palette.divider)
              Row(
                Modifier.fillMaxWidth().clickable { paramsOpen = !paramsOpen }.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
              ) {
                Text(stringResource(R.string.clarify_details), style = MaterialTheme.typography.labelSmall, color = palette.tertiaryText, modifier = Modifier.width(44.dp))
                Text(stringResource(R.string.clarify_params_count, argsPreview.length()), style = MaterialTheme.typography.bodySmall, color = palette.secondaryText, modifier = Modifier.weight(1f))
                Icon(
                  painterResource(R.drawable.action_chevron_right),
                  contentDescription = null,
                  tint = palette.tertiaryText,
                  modifier = Modifier.size(14.dp).rotate(if (paramsOpen) 90f else 0f),
                )
              }
              if (paramsOpen) {
                Box(Modifier.heightIn(max = 140.dp).verticalScroll(rememberScrollState()).padding(start = 14.dp, end = 14.dp, bottom = 10.dp)) {
                  Text(argsPreview.toString(2), style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), color = palette.secondaryText)
                }
              }
            }
          }
        }

        error?.let { Text(it, color = palette.danger, style = MaterialTheme.typography.bodySmall) }
        Text(stringResource(R.string.clarify_once), style = MaterialTheme.typography.labelSmall, color = palette.tertiaryText)

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Button(
            onClick = { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onCommand(ClarificationCommand(decision = "deny")) },
            enabled = !disabled,
            modifier = Modifier.weight(1f).height(44.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = palette.tonalFill, contentColor = palette.tonalText),
            elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp),
          ) { Text(stringResource(R.string.clarify_deny), fontWeight = FontWeight.Medium) }
          Button(
            onClick = { haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove); onCommand(ClarificationCommand(decision = "approve")) },
            enabled = !disabled,
            modifier = Modifier.weight(1f).height(44.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = palette.accent, contentColor = palette.onAccent),
            elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp),
          ) {
            if (submitting) CircularProgressIndicator(Modifier.size(18.dp), color = palette.onAccent, strokeWidth = 2.dp)
            else Text(stringResource(R.string.clarify_approve), fontWeight = FontWeight.SemiBold)
          }
        }
      }
    }
    return
  }

  ClarificationCardSurface(palette, modifier) {
    Column(Modifier.fillMaxWidth()) {
      Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        remainingSeconds?.let { seconds ->
          Text(
            if (seconds == 0L) stringResource(R.string.clarify_expired)
            else stringResource(R.string.clarify_remaining, seconds / 60, seconds % 60),
            style = MaterialTheme.typography.labelSmall,
            color = if (seconds == 0L) palette.danger else palette.secondaryText,
          )
        }
        Spacer(Modifier.weight(1f))
        ClarificationHeaderActions(
          showMenu = true,
          disabled = disabled,
          palette = palette,
          onAgentDecide = { onCommand(ClarificationCommand(action = "agent_decide")) },
          onCancel = { onCommand(ClarificationCommand(action = "cancel")) },
          onCollapse = { collapsed = true },
        )
      }

      Column(
        Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Text(request.question, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = palette.primaryText)

        if (request.choiceDetails.isNotEmpty()) {
          ClarificationOptionsGroup(
            choices = request.choiceDetails,
            recommendedId = request.recommendedChoiceId,
            selectedId = selected,
            customExpanded = compose,
            disabled = disabled,
            palette = palette,
            onPick = { choiceId ->
              if (request.interactionMode == "compose" || compose || draft.isNotEmpty()) {
                editing = true
                selected = choiceId
              } else {
                selected = choiceId
                onCommand(ClarificationCommand(choiceId = choiceId))
              }
            },
            onToggleCustom = { editing = !editing },
          )
        }

        if (compose) {
          ClarificationCustomEditor(
            selectedLabel = request.choiceDetails.find { it.id == selected }?.label,
            text = draft,
            onTextChange = { draft = it; if (it.isNotEmpty()) editing = true },
            limit = 8000,
            disabled = disabled,
            palette = palette,
            onClearSelection = { selected = null },
          )
        }

        error?.let { Text(it, color = palette.danger, style = MaterialTheme.typography.bodySmall) }
      }

      if (compose || submitting) {
        HorizontalDivider(thickness = 0.5.dp, color = palette.divider)
        Row(
          Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
          horizontalArrangement = Arrangement.End,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Button(
            onClick = {
              haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
              onCommand(ClarificationCommand(choiceId = selected, text = text.ifEmpty { null }))
            },
            enabled = !disabled && text.length <= 8000 && (selected != null || text.isNotEmpty()),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(containerColor = palette.accent, contentColor = palette.onAccent),
            elevation = ButtonDefaults.buttonElevation(0.dp, 0.dp, 0.dp),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
          ) {
            if (submitting) CircularProgressIndicator(Modifier.size(16.dp), color = palette.onAccent, strokeWidth = 2.dp)
            else Text(stringResource(R.string.voice_answer_send), fontWeight = FontWeight.SemiBold)
          }
        }
      }
    }
  }
}

@Composable
private fun ApprovalKeyValueRow(label: String, value: String, palette: ClarificationPalette) {
  Row(
    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
    horizontalArrangement = Arrangement.spacedBy(10.dp),
  ) {
    Text(label, style = MaterialTheme.typography.labelSmall, color = palette.tertiaryText, modifier = Modifier.width(44.dp))
    Text(value, style = MaterialTheme.typography.bodySmall, color = palette.primaryText, modifier = Modifier.weight(1f))
  }
}
