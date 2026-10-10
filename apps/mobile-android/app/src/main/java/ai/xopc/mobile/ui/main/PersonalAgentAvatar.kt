package ai.xopc.mobile.ui.main

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp

@Composable
internal fun PersonalAgentAvatar(avatar: Bitmap?, appearance: String, extent: Dp,
  active: Boolean, modifier: Modifier = Modifier) {
  if (avatar != null && appearance == "custom") {
    Image(avatar.asImageBitmap(), contentDescription = null, contentScale = ContentScale.Crop,
      modifier = modifier.size(extent).clip(CircleShape))
  } else {
    val background = when (appearance) {
      "loopi-care" -> MaterialTheme.colorScheme.tertiaryContainer
      "loopi-curious" -> MaterialTheme.colorScheme.secondaryContainer
      else -> MaterialTheme.colorScheme.surface
    }
    Box(modifier.size(extent).clip(CircleShape).background(background),
      contentAlignment = Alignment.Center) {
      LoopiIcon(extent = extent, compact = extent.value < 32f, active = active)
    }
  }
}


@Composable
internal fun AgentAvatar(avatar: Bitmap?, reference: String, agentId: String, extent: Dp, active: Boolean,
  modifier: Modifier = Modifier) {
  if (avatar != null) PersonalAgentAvatar(avatar, "custom", extent, active, modifier)
  else if (reference.startsWith("xopc:loopi:")) PersonalAgentAvatar(null,
    when (reference.substringAfterLast(':')) { "care" -> "loopi-care"; "curious" -> "loopi-curious"; else -> "loopi" }, extent, active, modifier)
  else Box(modifier.size(extent).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer),
    contentAlignment = Alignment.Center) {
    androidx.compose.material3.Text(agentId.take(1).uppercase(), color = MaterialTheme.colorScheme.onSecondaryContainer)
  }
}
