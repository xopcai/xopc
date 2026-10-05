package ai.xopc.mobile.theme

import androidx.compose.ui.graphics.Color

internal data class XopcPalette(val surface: Color, val panel: Color, val foreground: Color,
  val secondary: Color, val accent: Color, val grouped: Color, val input: Color,
  val border: Color, val accentSoft: Color)

/** Values mirror HarmonyOS base/element/color.json; keep both platforms' presets together. */
internal fun xopcPalette(scheme: String, dark: Boolean): XopcPalette = when (
  (scheme.takeIf(AppearancePreference.schemes::contains) ?: "default") to dark
) {
  "porcelain" to false -> XopcPalette(Color(0xFFF6F0E7), Color(0xFFFFFCF7), Color(0xFF352E2A),
    Color(0xFF665B54), Color(0xFF985D4D), Color(0xFFF1EAE1), Color(0xFFEFE5DC),
    Color(0xFFE4DCD3), Color(0xFFE8D9CF))
  "porcelain" to true -> XopcPalette(Color(0xFF211C19), Color(0xFF2B2420), Color(0xFFF3EAE1),
    Color(0xFFC5B5A8), Color(0xFFD4A08C), Color(0xFF241E1A), Color(0xFF3B3029),
    Color(0xFF4A3E35), Color(0xFF493A32))
  "dawn" to false -> XopcPalette(Color(0xFFEDF2F7), Color(0xFFF8FBFF), Color(0xFF262626),
    Color(0xFF595F66), Color(0xFF34363A), Color(0xFFDAE3EC), Color(0xFFE7EBF4),
    Color(0xFFCFDAE5), Color(0xFFE1F1FF))
  "dawn" to true -> XopcPalette(Color(0xFF172433), Color(0xFF253342), Color(0xFFF3F6FA),
    Color(0xFFBFC7D0), Color(0xFFD9DDE2), Color(0xFF0C1722), Color(0xFF415264),
    Color(0xFF415264), Color(0xFF263F58))
  "emerald" to false -> XopcPalette(Color(0xFFF0FDF4), Color(0xFFFFFFFF), Color(0xFF052E16),
    Color(0xFF166534), Color(0xFF059669), Color(0xFFE8F8ED), Color(0xFFDCFCE7),
    Color(0xFF86EFAC), Color(0xFFD1FAE5))
  "emerald" to true -> XopcPalette(Color(0xFF000000), Color(0xFF0A0A0A), Color(0xFFD1FAE5),
    Color(0xFF6EE7B7), Color(0xFF10B981), Color(0xFF050B07), Color(0xFF111111),
    Color(0xFF134E2A), Color(0xFF063E2F))
  "clay" to false -> XopcPalette(Color(0xFFFFFAF0), Color(0xFFFFFFFF), Color(0xFF0A0A0A),
    Color(0xFF6A6A6A), Color(0xFF0A0A0A), Color(0xFFF7F0E4), Color(0xFFFAF5E8),
    Color(0xFFE5E5E5), Color(0xFFF5F0E0))
  "clay" to true -> XopcPalette(Color(0xFF0A1A1A), Color(0xFF1A2A2A), Color(0xFFFFFAF0),
    Color(0xFFA4D4C5), Color(0xFFFFB084), Color(0xFF142222), Color(0xFF243636),
    Color(0xFF2A3A3A), Color(0xFF1A3A3A))
  "default" to true -> XopcPalette(Color(0xFF14171C), Color(0xFF1B1F26), Color(0xFFF4F6F8),
    Color(0xFFB8BEC8), Color(0xFF3A6BFF), Color(0xFF171B21), Color(0xFF242933),
    Color(0xFF323844), Color(0xFF2A3559))
  else -> XopcPalette(Color(0xFFEEF1F5), Color(0xFFFFFFFF), Color(0xFF111111),
    Color(0xFF666666), Color(0xFF3A6BFF), Color(0xFFF1F3F6), Color(0xFFE8ECF1),
    Color(0xFFECECEC), Color(0xFFEEF3FF))
}
