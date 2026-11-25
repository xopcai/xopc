package ai.xopc.mobile.ui.main

import ai.xopc.mobile.theme.themedCorners
import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.GatewayProfile
import ai.xopc.mobile.theme.AppearancePreference
import ai.xopc.mobile.theme.xopcPalette
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
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
  onOpenModelSettings: (() -> Unit)? = null,
  onOpenAppAbout: () -> Unit = {}, onOpenAbout: () -> Unit = {}, onOpenGoals: () -> Unit = {},
  personalAgent: @Composable () -> Unit = {},
  notifications: @Composable () -> Unit = {},
  onOpenNotifications: (() -> Unit)? = null,
  onOpenAppearance: () -> Unit, onOpenLanguage: () -> Unit = {},
  onAppearanceModeChange: (String) -> Unit,
  onColorSchemeChange: (String) -> Unit, onLanguageChange: (String) -> Unit = {}) {
  val context = LocalContext.current
  @Suppress("DEPRECATION")
  val version = context.packageManager.getPackageInfo(context.packageName, 0).versionName.orEmpty()
  val motionAllowed = rememberMotionAllowed()
  val headerTitle = when (section) {
    "notifications" -> stringResource(R.string.push_title)
    "appearance" -> stringResource(R.string.settings_appearance)
    "language" -> stringResource(R.string.settings_language)
    "about" -> stringResource(R.string.settings_about_xopc)
    else -> stringResource(R.string.settings_title)
  }
  Column(Modifier.fillMaxSize().padding(insets).testTag("settings-screen")) {
    XopcPageHeader("settings-back", onBack, title = headerTitle)
    AnimatedContent(targetState = section, modifier = Modifier.fillMaxSize(),
      transitionSpec = { xopcScreenTransition(motionAllowed) },
      label = "settings-section") { currentSection ->
      Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
        .padding(horizontal = 20.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (currentSection == "appearance") {
          SettingsSectionLabel(R.string.settings_display_mode)
          listOf("system" to R.string.settings_system, "light" to R.string.settings_light,
            "dark" to R.string.settings_dark).forEach { (mode, label) ->
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(themedCorners(14))
              .background(if (appearanceMode == mode) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceContainerLow)
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
                Column(Modifier.weight(1f).heightIn(min = 96.dp).clip(themedCorners(12))
                  .background(if (selected) MaterialTheme.colorScheme.primaryContainer
                    else MaterialTheme.colorScheme.surfaceContainerLow)
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
            Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(themedCorners(14))
              .background(if (language == option) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceContainerLow)
              .clickable { onLanguageChange(option) }
              .padding(horizontal = 16.dp).testTag("language-$option"),
              verticalAlignment = Alignment.CenterVertically) {
              Text(stringResource(label), modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodyLarge)
              if (language == option) Text("✓", color = MaterialTheme.colorScheme.primary)
            }
          }
        } else if (currentSection == "notifications") {
          notifications()
        } else if (currentSection == "about") {
          AboutAppContent(version)
        } else {
          if (profile != null) {
            SettingsSectionLabel(R.string.settings_personalization)
            personalAgent()
            SettingsRow(stringResource(R.string.settings_privacy_memory), "", true, onOpenAbout,
              "settings-privacy-memory")
            SettingsRow(stringResource(R.string.personal_goals), "", true, onOpenGoals, "settings-goals")
          }
          SettingsSectionLabel(R.string.settings_connection_notifications)
          SettingsRow(profile?.name ?: stringResource(R.string.gateways_title),
            if (profile != null) stringResource(R.string.settings_active_gateway) else "", true, onOpenGateways)
          if (profile != null && onOpenModelSettings != null) {
            SettingsRow(stringResource(R.string.ms_title), "", true, onOpenModelSettings, "settings-models")
          }
          onOpenNotifications?.let {
            SettingsRow(stringResource(R.string.push_title), "", true, it, "settings-notifications")
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
          SettingsRow(stringResource(R.string.settings_about_xopc), version, true, onOpenAppAbout, "settings-about")
        }
      }
    }
  }
}

@Composable
private fun AboutAppContent(version: String) {
  val uriHandler = LocalUriHandler.current
  val context = LocalContext.current
  val language = if (LocalConfiguration.current.locales[0].language == "zh") "zh" else "en"
  Column(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 20.dp), horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(8.dp)) {
    Image(painterResource(R.drawable.brand_mark), contentDescription = null, modifier = Modifier.size(64.dp))
    Text("xopc", style = MaterialTheme.typography.headlineSmall)
    Text(version, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.testTag("settings-about-version"))
  }
  listOf(
    Triple(R.string.settings_website, "", "website"),
    Triple(R.string.settings_support, "/support", "support"),
    Triple(R.string.settings_privacy_policy, "/privacy", "privacy"),
    Triple(R.string.settings_terms, "/terms", "terms"),
  ).forEach { (label, path, id) ->
    SettingsRow(stringResource(label), "", true, {
      try { uriHandler.openUri("https://xopc.ai/$language$path") }
      catch (_: IllegalArgumentException) {
        android.widget.Toast.makeText(context, R.string.settings_link_error, android.widget.Toast.LENGTH_SHORT).show()
      }
    }, "settings-about-$id")
  }
}

private fun schemeLabel(scheme: String): Int = when (scheme) {
  "porcelain" -> R.string.settings_scheme_porcelain
  "emerald" -> R.string.settings_scheme_emerald
  "clay" -> R.string.settings_scheme_clay
  else -> R.string.settings_scheme_default
}

@Composable
private fun SchemePreview(scheme: String, dark: Boolean, modifier: Modifier = Modifier) {
  val palette = xopcPalette(scheme, dark)
  Box(modifier.background(palette.surface).padding(4.dp)) {
    Column(Modifier.fillMaxWidth().background(palette.panel, RoundedCornerShape(5.dp)).padding(4.dp),
      verticalArrangement = Arrangement.spacedBy(5.dp)) {
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        Box(Modifier.height(7.dp).weight(0.15f)
          .background(palette.accent, RoundedCornerShape(4.dp)))
        Box(Modifier.height(7.dp).weight(0.85f)
          .background(palette.foreground, RoundedCornerShape(4.dp)))
      }
      Box(Modifier.fillMaxWidth(0.72f).height(5.dp)
        .background(palette.input, RoundedCornerShape(3.dp)))
    }
  }
}

@Composable
private fun SettingsSectionLabel(label: Int) {
  Text(stringResource(label), style = MaterialTheme.typography.labelMedium,
    color = MaterialTheme.colorScheme.onSurfaceVariant,
    modifier = Modifier.padding(top = 16.dp, bottom = 4.dp))
}

@Composable
private fun SettingsRow(title: String, summary: String, navigable: Boolean, onClick: () -> Unit, tag: String = "") {
  Row(Modifier.fillMaxWidth().heightIn(min = 58.dp)
    .then(if (tag.isEmpty()) Modifier else Modifier.testTag(tag))
    .clip(themedCorners(16)).background(MaterialTheme.colorScheme.surfaceContainerLow)
    .then(if (navigable) Modifier.clickable(onClick = onClick) else Modifier)
    .padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
      Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1,
        overflow = TextOverflow.Ellipsis)
      if (summary.isNotBlank()) Text(summary, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
        overflow = TextOverflow.Ellipsis)
    }
    if (navigable) ActionIcon(R.drawable.action_chevron_right, color = MaterialTheme.colorScheme.onSurfaceVariant, size = 16.dp)
  }
}
