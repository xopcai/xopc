package ai.xopc.mobile.gateway

import android.graphics.Bitmap
import android.graphics.Color
import ai.xopc.mobile.ui.main.rgbaBitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Test

class PairingQrScannerTest {
  @Test fun cameraRgbaFramePreservesChannelOrderAndRowPadding() {
    val frame = ByteBuffer.wrap(byteArrayOf(
      -1, 0, 0, -1, 0, 0, -1, -1, 0, 0, 0, 0,
      0, -1, 0, -1, -1, -1, -1, -1, 0, 0, 0, 0,
    ))
    val bitmap = requireNotNull(rgbaBitmap(frame, width = 2, height = 2,
      pixelStride = 4, rowStride = 12))
    try {
      assertEquals(Color.RED, bitmap.getPixel(0, 0))
      assertEquals(Color.BLUE, bitmap.getPixel(1, 0))
      assertEquals(Color.GREEN, bitmap.getPixel(0, 1))
      assertEquals(Color.WHITE, bitmap.getPixel(1, 1))
    } finally {
      bitmap.recycle()
    }
  }

  @Test fun decodesTheExactPairingInvitationFromAQrImage() {
    val invitation = "xopc://pair/v4/test-invitation"
    val bits = QRCodeWriter().encode(invitation, BarcodeFormat.QR_CODE, 512, 512)
    val bitmap = Bitmap.createBitmap(bits.width, bits.height, Bitmap.Config.ARGB_8888)
    val pixels = IntArray(bits.width * bits.height) { index ->
      if (bits[index % bits.width, index / bits.width]) 0xff000000.toInt() else 0xffffffff.toInt()
    }
    bitmap.setPixels(pixels, 0, bits.width, 0, 0, bits.width, bits.height)
    try {
      assertEquals(invitation, PairingQrScanner.decode(bitmap))
    } finally {
      bitmap.recycle()
    }
  }
}
