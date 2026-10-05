package ai.xopc.mobile.ui.main

import ai.xopc.mobile.R
import ai.xopc.mobile.gateway.PairingQrScanner
import android.graphics.Bitmap
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@Composable
internal fun PairingQrScannerDialog(onDetected: (String) -> Unit, onClose: () -> Unit,
  onError: () -> Unit) {
  val context = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val previewView = remember {
    PreviewView(context).apply {
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      scaleType = PreviewView.ScaleType.FILL_CENTER
    }
  }
  val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
  val mainExecutor = remember(context) { ContextCompat.getMainExecutor(context) }

  DisposableEffect(lifecycleOwner, previewView) {
    val disposed = AtomicBoolean(false)
    val delivered = AtomicBoolean(false)
    var provider: ProcessCameraProvider? = null
    var preview: Preview? = null
    var analysis: ImageAnalysis? = null
    val providerFuture = ProcessCameraProvider.getInstance(context)
    providerFuture.addListener({
      if (disposed.get()) return@addListener
      runCatching {
        provider = providerFuture.get()
        preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
        analysis = ImageAnalysis.Builder()
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build().also { useCase ->
            useCase.setAnalyzer(analysisExecutor) { image ->
              try {
                val value = rgbaBitmap(image)?.let { bitmap ->
                  try { PairingQrScanner.decode(bitmap) } finally { bitmap.recycle() }
                }
                if (!value.isNullOrBlank() && delivered.compareAndSet(false, true)) {
                  useCase.clearAnalyzer()
                  mainExecutor.execute { if (!disposed.get()) onDetected(value) }
                }
              } finally {
                image.close()
              }
            }
          }
        val cameraSelector = if (provider?.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA) == true)
          CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
        provider?.unbindAll()
        provider?.bindToLifecycle(lifecycleOwner, cameraSelector, preview, analysis)
      }.onFailure { mainExecutor.execute { if (!disposed.get()) onError() } }
    }, mainExecutor)

    onDispose {
      disposed.set(true)
      analysis?.clearAnalyzer()
      if (preview != null && analysis != null) runCatching { provider?.unbind(preview, analysis) }
      analysisExecutor.shutdownNow()
    }
  }

  Dialog(onDismissRequest = onClose,
    properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
    Surface(modifier = Modifier.fillMaxSize().testTag("pairing-scanner"), color = Color.Black) {
      Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize())
        Box(modifier = Modifier.size(260.dp).align(Alignment.Center)
          .border(3.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(24.dp)))
        Column(modifier = Modifier.fillMaxWidth().align(Alignment.TopCenter)
          .background(Color.Black.copy(alpha = 0.62f)).padding(horizontal = 20.dp, vertical = 18.dp),
          verticalArrangement = Arrangement.spacedBy(4.dp)) {
          Text(stringResource(R.string.pairing_scanner_title), style = MaterialTheme.typography.titleLarge,
            color = Color.White)
          Text(stringResource(R.string.pairing_scanner_hint), style = MaterialTheme.typography.bodyMedium,
            color = Color.White.copy(alpha = 0.82f))
        }
        TextButton(onClick = onClose, modifier = Modifier.align(Alignment.BottomCenter)
          .fillMaxWidth().height(64.dp).background(Color.Black.copy(alpha = 0.62f))
          .testTag("pairing-scanner-close")) {
          Text(stringResource(R.string.assistant_close), color = Color.White)
        }
      }
    }
  }
}

private fun rgbaBitmap(image: ImageProxy): Bitmap? {
  val plane = image.planes.firstOrNull() ?: return null
  return rgbaBitmap(plane.buffer, image.width, image.height, plane.pixelStride, plane.rowStride)
}

internal fun rgbaBitmap(buffer: ByteBuffer, width: Int, height: Int,
  pixelStride: Int, rowStride: Int): Bitmap? {
  if (width <= 0 || height <= 0 || pixelStride < 4 || rowStride < width * pixelStride ||
    buffer.limit() < (height - 1) * rowStride + (width - 1) * pixelStride + 4) return null
  val pixels = IntArray(width * height)
  for (y in 0 until height) {
    val row = y * rowStride
    for (x in 0 until width) {
      val offset = row + x * pixelStride
      val red = buffer.get(offset).toInt() and 0xff
      val green = buffer.get(offset + 1).toInt() and 0xff
      val blue = buffer.get(offset + 2).toInt() and 0xff
      val alpha = buffer.get(offset + 3).toInt() and 0xff
      pixels[y * width + x] = (alpha shl 24) or (red shl 16) or (green shl 8) or blue
    }
  }
  return Bitmap.createBitmap(pixels, width, height, Bitmap.Config.ARGB_8888)
}
