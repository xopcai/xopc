package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import android.animation.ValueAnimator
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
private fun rememberLoopiMotionAllowed(): Boolean {
  val context = LocalContext.current
  var allowed by remember(context) { mutableStateOf(ValueAnimator.areAnimatorsEnabled()) }
  DisposableEffect(context) {
    val observer = object : ContentObserver(Handler(Looper.getMainLooper())) {
      override fun onChange(selfChange: Boolean) {
        allowed = ValueAnimator.areAnimatorsEnabled()
      }
    }
    context.contentResolver.registerContentObserver(
      Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false, observer)
    onDispose { context.contentResolver.unregisterContentObserver(observer) }
  }
  return allowed
}

/** The ring and face move independently, like HarmonyOS Loopi. */
@Composable
internal fun LoopiIcon(extent: Dp, active: Boolean, compact: Boolean = false,
  interactive: Boolean = false, modifier: Modifier = Modifier) {
  val motionAllowed = rememberLoopiMotionAllowed()
  val motionActive = active && motionAllowed
  var greeting by remember { mutableStateOf(false) }
  val scope = rememberCoroutineScope()
  var greetingJob by remember { mutableStateOf<Job?>(null) }
  val label = stringResource(R.string.tab_assistant)
  val touchModifier = if (interactive) Modifier.clip(CircleShape).clickable(role = Role.Button,
    onClickLabel = label) {
    if (motionActive) {
      greetingJob?.cancel()
      greetingJob = scope.launch {
        greeting = true
        delay(450)
        greeting = false
      }
    }
  } else Modifier
  LaunchedEffect(motionActive) { if (!motionActive) greeting = false }
  Box(modifier = modifier.size(extent).then(touchModifier), contentAlignment = Alignment.Center) {
    if (motionActive) AnimatedLoopiArtwork(extent, compact, greeting)
    else LoopiArtwork(extent, lift = 0f, ringAngle = 0f, eyeOpen = 1f)
  }
}

@Composable
private fun AnimatedLoopiArtwork(extent: Dp, compact: Boolean, greeting: Boolean) {
  if (compact) {
    CompactLoopiArtwork(extent)
    return
  }
  val cycle = rememberInfiniteTransition(label = "loopi-breathe")
  val breathing by cycle.animateFloat(initialValue = 0f, targetValue = 1f,
    animationSpec = infiniteRepeatable(tween(1700, easing = LinearEasing), RepeatMode.Reverse),
    label = "loopi-lift")
  val blink by cycle.animateFloat(initialValue = 1f, targetValue = 1f,
    animationSpec = infiniteRepeatable(keyframes {
      durationMillis = 4600
      1f at 0
      1f at 1400
      0.12f at 1510
      1f at 1690
    }), label = "loopi-blink")
  val greetingLift by animateFloatAsState(if (greeting) -5f else 0f,
    animationSpec = tween(if (greeting) 160 else 360), label = "loopi-greeting-lift")
  val greetingAngle by animateFloatAsState(if (greeting) 7f else 0f,
    animationSpec = tween(if (greeting) 160 else 360), label = "loopi-greeting-ring")
  val greetingEyes by animateFloatAsState(if (greeting) 0.25f else 1f,
    animationSpec = tween(if (greeting) 160 else 180), label = "loopi-greeting-eyes")
  LoopiArtwork(extent, lift = -4f * breathing + greetingLift,
    ringAngle = -1.2f * breathing + greetingAngle,
    eyeOpen = blink * greetingEyes)
}

@Composable
private fun CompactLoopiArtwork(extent: Dp) {
  val lift = remember { Animatable(0f) }
  val eyes = remember { Animatable(1f) }
  LaunchedEffect(Unit) {
    delay(120)
    lift.animateTo(-2f, tween(220))
    delay(40)
    eyes.animateTo(0.12f, tween(110))
    eyes.animateTo(1f, tween(180))
  }
  LoopiArtwork(extent, lift = lift.value, ringAngle = 0f, eyeOpen = eyes.value)
}

@Composable
private fun LoopiArtwork(extent: Dp, lift: Float, ringAngle: Float, eyeOpen: Float) {
  val extentPx = with(LocalDensity.current) { extent.toPx() }
  val face = MaterialTheme.colorScheme.surface.copy(red = 0.96f, green = 0.95f, blue = 0.91f)
  Box(modifier = Modifier.size(extent), contentAlignment = Alignment.Center) {
    Image(painterResource(R.drawable.brand_mark), contentDescription = null,
      modifier = Modifier.size(extent).graphicsLayer {
        rotationZ = ringAngle
        translationY = lift * extentPx / 304f
      })
    Canvas(modifier = Modifier.size(extent * 0.38f).graphicsLayer {
      translationY = lift * extentPx / 200f
    }) {
      val width = size.width
      val height = size.height
      drawOval(face, topLeft = Offset(width * 0.03f, height * 0.09f),
        size = Size(width * 0.94f, height * 0.82f))
      val ink = Color(0xFF293438)
      val eyeHeight = height * 0.14f * eyeOpen.coerceIn(0.08f, 1f)
      listOf(0.35f, 0.65f).forEach { x ->
        drawOval(ink, topLeft = Offset(width * x - width * 0.035f, height * 0.48f - eyeHeight / 2f),
          size = Size(width * 0.07f, eyeHeight))
      }
      val smile = Path().apply {
        moveTo(width * 0.44f, height * 0.67f)
        quadraticTo(width * 0.5f, height * 0.75f, width * 0.56f, height * 0.67f)
      }
      drawPath(smile, ink, style = Stroke(width = width * 0.025f))
    }
  }
}
