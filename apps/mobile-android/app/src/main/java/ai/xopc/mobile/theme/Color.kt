package ai.xopc.mobile.theme

import androidx.compose.ui.graphics.Color

internal data class XopcPalette(val surface: Color, val panel: Color, val foreground: Color,
  val secondary: Color, val accent: Color, val grouped: Color, val input: Color,
  val border: Color, val accentSoft: Color, val active: Color, val danger: Color)

/** Values mirror HarmonyOS base/element/color.json; keep both platforms' presets together. */
internal fun xopcPalette(scheme: String, dark: Boolean): XopcPalette = when (
  (scheme.takeIf(AppearancePreference.schemes::contains) ?: "default") to dark
) {
  "porcelain" to false -> XopcPalette(Color(0xFFF6F0E7), Color(0xFFFFFCF7), Color(0xFF352E2A),
    Color(0xFF665B54), Color(0xFF874F40), Color(0xFFF1EAE1), Color(0xFFEBDFD4),
    Color(0xFFE4DCD3), Color(0xFFE8D9CF), Color(0xFFE8D9CF), Color(0xFF9C3B3B))
  "porcelain" to true -> XopcPalette(Color(0xFF211C19), Color(0xFF2B2420), Color(0xFFF3EAE1),
    Color(0xFFC5B5A8), Color(0xFFD4A08C), Color(0xFF241E1A), Color(0xFF3B3029),
    Color(0xFF4A3E35), Color(0xFF493A32), Color(0xFF5E4B40), Color(0xFFE8A19A))
  "dawn" to false -> XopcPalette(Color(0xFFEDF2F7), Color(0xFFF8FBFF), Color(0xFF262626),
    Color(0xFF595F66), Color(0xFF34363A), Color(0xFFDAE3EC), Color(0xFFDBE4EF),
    Color(0xFFCFDAE5), Color(0xFFE1F1FF), Color(0xFFC9D7E5), Color(0xFFB32B3A))
  "dawn" to true -> XopcPalette(Color(0xFF172433), Color(0xFF253342), Color(0xFFF3F6FA),
    Color(0xFFBFC7D0), Color(0xFFD9DDE2), Color(0xFF0C1722), Color(0xFF344557),
    Color(0xFF415264), Color(0xFF263F58), Color(0xFF415264), Color(0xFFFF9599))
  "emerald" to false -> XopcPalette(Color(0xFFE8F5ED), Color(0xFFFFFFFF), Color(0xFF052E16),
    Color(0xFF166534), Color(0xFF087446), Color(0xFFE8F8ED), Color(0xFFCFE9D8),
    Color(0xFF86EFAC), Color(0xFFD1FAE5), Color(0xFFBDF2D1), Color(0xFFB91C1C))
  "emerald" to true -> XopcPalette(Color(0xFF000000), Color(0xFF131916), Color(0xFFD1FAE5),
    Color(0xFF6EE7B7), Color(0xFF10B981), Color(0xFF080D0A), Color(0xFF202A24),
    Color(0xFF134E2A), Color(0xFF063E2F), Color(0xFF13513E), Color(0xFFFF8080))
  "clay" to false -> XopcPalette(Color(0xFFF5EDE1), Color(0xFFFFFFFF), Color(0xFF0A0A0A),
    Color(0xFF565044), Color(0xFF0A0A0A), Color(0xFFF7F0E4), Color(0xFFE7DCCC),
    Color(0xFFE5E5E5), Color(0xFFF5F0E0), Color(0xFFECE4D3), Color(0xFFB42332))
  "clay" to true -> XopcPalette(Color(0xFF0A1A1A), Color(0xFF1A2A2A), Color(0xFFFFFAF0),
    Color(0xFFA4D4C5), Color(0xFFFFB084), Color(0xFF142222), Color(0xFF243636),
    Color(0xFF2A3A3A), Color(0xFF1A3A3A), Color(0xFF376058), Color(0xFFFF9292))
  "default" to true -> XopcPalette(Color(0xFF14171C), Color(0xFF1B1F26), Color(0xFFF4F6F8),
    Color(0xFFB8BEC8), Color(0xFF80A1FF), Color(0xFF171B21), Color(0xFF242933),
    Color(0xFF323844), Color(0xFF2A3559), Color(0xFF43516B), Color(0xFFFF8383))
  else -> XopcPalette(Color(0xFFE9EDF3), Color(0xFFFFFFFF), Color(0xFF142033),
    Color(0xFF46566C), Color(0xFF0054C6), Color(0xFFF2F5F9), Color(0xFFD8E0EB),
    Color(0xFFCBD4E1), Color(0xFFE5F0FF), Color(0xFFE5F0FF), Color(0xFFA12632))
}
