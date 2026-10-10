package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.theme.AppearancePreference
import ai.xopc.mobile.theme.xopcPalette
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/** Settings content is state-driven; the Activity owns the durable appearance preference. */
@Composable
internal fun SettingsScreen(profile: GatewayProfile?, appearanceMode: String, colorScheme: String,
  language: String, section: String, insets: PaddingValues, onBack: () -> Unit,
  onOpenGateways: () -> Unit = {},
  onOpenSharing: () -> Unit = {},
  onOpenAppearance: () -> Unit, onOpenLanguage: () -> Unit = {},
  onAppearanceModeChange: (String) -> Unit,
  onColorSchemeChange: (String) -> Unit, onLanguageChange: (String) -> Unit = {}) {
  val context = LocalContext.current
  Column(Modifier.fillMaxSize().padding(insets).testTag("settings-screen")) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
      verticalAlignment = Alignment.CenterVertically) {
      Text(stringResource(when (section) {
        "appearance" -> R.string.settings_appearance
        "language" -> R.string.settings_language
        else -> R.string.settings_title
      }),
        style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    }
    AnimatedContent(targetState = section, modifier = Modifier.fillMaxSize(),
      transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(180)) },
      label = "settings-section") { currentSection ->
      Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (currentSection == "appearance") {
          SettingsSectionLabel(R.string.settings_display_mode)
          listOf("system" to R.string.settings_system, "light" to R.string.settings_light,
            "dark" to R.string.settings_dark).forEach { (mode, label) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
              .background(if (appearanceMode == mode) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(14.dp))
              .clickable { onAppearanceModeChange(mode) }
              .padding(horizontal = 16.dp).testTag("appearance-$mode"),
              verticalAlignment = Alignment.CenterVertically) {
              Text(stringResource(label), modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge)
              if (appearanceMode == mode) Text("✓", color = MaterialTheme.colorScheme.primary)
            }
          }
          SettingsSectionLabel(R.string.settings_color_scheme)
          AppearancePreference.schemes.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
              row.forEach { scheme ->
                val selected = colorScheme == scheme
                Column(Modifier.weight(1f).heightIn(min = 96.dp)
                  .background(if (selected) MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(12.dp))
                  .clickable { onColorSchemeChange(scheme) }
                  .padding(8.dp).testTag("scheme-$scheme"),
                  verticalArrangement = Arrangement.spacedBy(8.dp)) {
                  Row(Modifier.fillMaxWidth().height(44.dp)) {
                    SchemePreview(scheme, false, Modifier.weight(1f))
                    SchemePreview(scheme, true, Modifier.weight(1f))
                  }
                  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(stringResource(schemeLabel(scheme)), modifier = Modifier.weight(1f),
                      style = MaterialTheme.typography.labelMedium,
                      color = if (selected) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.onSurfaceVariant)
                    if (selected) Text("✓", color = MaterialTheme.colorScheme.primary)
                  }
                }
              }
              if (row.size == 1) Box(Modifier.weight(1f))
            }
          }
        } else if (currentSection == "language") {
          listOf("system" to R.string.settings_system,
            "zh-CN" to R.string.settings_language_zh,
            "en-US" to R.string.settings_language_en).forEach { (option, label) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp)
              .background(if (language == option) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(14.dp))
              .clickable { onLanguageChange(option) }
              .padding(horizontal = 16.dp).testTag("language-$option"),
              verticalAlignment = Alignment.CenterVertically) {
              Text(stringResource(label), modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge)
              if (language == option) Text("✓", color = MaterialTheme.colorScheme.primary)
            }
          }
        } else {
          if (profile != null) {
            SettingsSectionLabel(R.string.settings_connection_notifications)
            SettingsRow(profile.name, stringResource(R.string.settings_active_gateway), true,
              onOpenGateways)
          }
          SettingsSectionLabel(R.string.settings_data_sharing)
          SettingsRow(stringResource(R.string.share_center),
            stringResource(R.string.share_center_help), true, onOpenSharing)
          SettingsSectionLabel(R.string.settings_preferences)
          SettingsRow(stringResource(R.string.settings_language),
            stringResource(when (language) {
              "zh-CN" -> R.string.settings_language_zh
              "en-US" -> R.string.settings_language_en
              else -> R.string.settings_system
            }), true, onOpenLanguage)
          SettingsRow(stringResource(R.string.settings_appearance),
            stringResource(when (appearanceMode) {
              "dark" -> R.string.settings_dark
              "light" -> R.string.settings_light
              else -> R.string.settings_system
            }), true, onOpenAppearance)
          SettingsSectionLabel(R.string.settings_about)
          @Suppress("DEPRECATION")
          val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()
          SettingsRow("xopc", version, false, {})
        }
      }
    }
  }
}

private fun schemeLabel(scheme: String): Int = when (scheme) {
  "porcelain" -> R.string.settings_scheme_porcelain
  "dawn" -> R.string.settings_scheme_dawn
  "emerald" -> R.string.settings_scheme_emerald
  "clay" -> R.string.settings_scheme_clay
  else -> R.string.settings_scheme_default
}

@Composable
private fun SchemePreview(scheme: String, dark: Boolean, modifier: Modifier = Modifier) {
  val palette = xopcPalette(scheme, dark)
  Column(modifier.background(palette.panel).padding(8.dp),
    verticalArrangement = Arrangement.spacedBy(5.dp)) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
      Box(Modifier.height(7.dp).weight(0.15f)
        .background(palette.accent, RoundedCornerShape(4.dp)))
      Box(Modifier.height(7.dp).weight(0.85f)
        .background(palette.foreground, RoundedCornerShape(4.dp)))
    }
    Box(Modifier.fillMaxWidth(0.72f).height(5.dp)
      .background(palette.secondary, RoundedCornerShape(3.dp)))
  }
}

@Composable
private fun SettingsSectionLabel(label: Int) {
  Text(stringResource(label), style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
}

@Composable
private fun SettingsRow(title: String, summary: String, navigable: Boolean, onClick: () -> Unit) {
  Row(Modifier.fillMaxWidth().heightIn(min = 64.dp)
    .background(MaterialTheme.colorScheme.surfaceContainerLow, RoundedCornerShape(16.dp))
    .then(if (navigable) Modifier.clickable(onClick = onClick) else Modifier)
    .padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1,
        overflow = TextOverflow.Ellipsis)
      Text(summary, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
        overflow = TextOverflow.Ellipsis)
    }
    if (navigable) ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 16.dp)
  }
}
