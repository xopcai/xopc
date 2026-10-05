package ai.xopc.mobile.gateway

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader

/** Decodes a camera image locally. Pairing invitations must never be logged or persisted here. */
object PairingQrScanner {
  private const val MAX_DECODE_EDGE = 2048

  fun decode(context: Context, uri: Uri): String? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_DECODE_EDGE) sample *= 2
    val bitmap = context.contentResolver.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: return null
    return try { decode(bitmap) } finally { bitmap.recycle() }
  }

  internal fun decode(bitmap: Bitmap): String? {
    for (degrees in intArrayOf(0, 90, 180, 270)) {
      val candidate = if (degrees == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0,
        bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
      try {
        val pixels = IntArray(candidate.width * candidate.height)
        candidate.getPixels(pixels, 0, candidate.width, 0, 0, candidate.width, candidate.height)
        val source = RGBLuminanceSource(candidate.width, candidate.height, pixels)
        val hints = mapOf(
          DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
          DecodeHintType.TRY_HARDER to true,
          DecodeHintType.CHARACTER_SET to "UTF-8",
        )
        runCatching { QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source)), hints).text }
          .getOrNull()?.let { return it }
        runCatching { QRCodeReader().decode(BinaryBitmap(HybridBinarizer(source.invert())), hints).text }
          .getOrNull()?.let { return it }
      } finally {
        if (candidate !== bitmap) candidate.recycle()
      }
    }
    return null
  }
}
