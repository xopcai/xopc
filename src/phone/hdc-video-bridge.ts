/** Compiled against the user's DevEco libraries; no vendor binaries are redistributed. */
export const HDC_VIDEO_BRIDGE_SOURCE = String.raw`
import com.huawei.hosscrcpy.api.HosRemoteConfig;
import com.huawei.hosscrcpy.api.HosRemoteDevice;
import com.huawei.hosscrcpy.api.ScreenCapCallback;
import java.io.*;
import java.nio.ByteBuffer;
import java.util.jar.*;
import java.util.Enumeration;
import java.util.concurrent.atomic.AtomicBoolean;

public final class XopcHdcVideo {
  private static final DataOutputStream WIRE = new DataOutputStream(new FileOutputStream(FileDescriptor.out));
  private static final AtomicBoolean STOPPED = new AtomicBoolean(false);
  private static HosRemoteDevice device;
  private static synchronized void emit(int kind, byte[] bytes) {
    if (STOPPED.get()) return;
    try {
      if (bytes.length > 4 * 1024 * 1024) throw new IOException("Video packet exceeds limit");
      WIRE.writeByte(kind); WIRE.writeInt(bytes.length); WIRE.write(bytes); WIRE.flush();
    } catch (IOException error) { STOPPED.set(true); System.exit(2); }
  }
  private static void stop() {
    if (!STOPPED.compareAndSet(false, true)) return;
    if (device != null) {
      Thread cleanup = new Thread(() -> { try { device.stopCaptureScreen(); } catch (Throwable ignored) {} });
      cleanup.setDaemon(true); cleanup.start();
      try { cleanup.join(3000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }
  }
  private static String className(InputStream stream) throws IOException {
    DataInputStream input = new DataInputStream(stream);
    if (input.readInt() != 0xcafebabe) throw new IOException("Invalid library class");
    input.readInt(); int count = input.readUnsignedShort(); Object[] pool = new Object[count];
    for (int index = 1; index < count; index++) {
      switch (input.readUnsignedByte()) {
        case 1: pool[index] = input.readUTF(); break;
        case 7: pool[index] = input.readUnsignedShort(); break;
        case 8: case 16: case 19: case 20: input.skipNBytes(2); break;
        case 3: case 4: case 9: case 10: case 11: case 12: case 17: case 18: input.skipNBytes(4); break;
        case 5: case 6: input.skipNBytes(8); index++; break;
        case 15: input.skipNBytes(3); break;
        default: throw new IOException("Unsupported library class");
      }
    }
    input.readUnsignedShort(); return (String) pool[(Integer) pool[input.readUnsignedShort()]];
  }
  private static boolean validLibrary(String path) throws IOException {
    try (JarFile jar = new JarFile(path)) {
      Enumeration<JarEntry> entries = jar.entries();
      while (entries.hasMoreElements()) {
        JarEntry entry = entries.nextElement(); String name = entry.getName();
        // Some DevEco distributions contain incorrectly cased obfuscated class entries.
        if (!name.endsWith(".class") || !(name.startsWith("com/a/") || name.startsWith("com/huawei/hosscrcpy/"))) continue;
        try (InputStream input = jar.getInputStream(entry)) { if (!name.equals(className(input) + ".class")) return false; }
      }
    }
    return true;
  }
  public static void main(String[] args) throws Exception {
    // Vendor diagnostics must never corrupt the framed stdout transport.
    System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true, "UTF-8"));
    Runtime.getRuntime().addShutdownHook(new Thread(XopcHdcVideo::stop));
    if (!validLibrary(args[2])) { emit(4, new byte[0]); stop(); System.exit(2); }
    if (args[0].equals("--probe")) { HosRemoteConfig.class.getDeclaredMethods(); HosRemoteDevice.class.getDeclaredMethods(); ScreenCapCallback.class.getDeclaredMethods(); stop(); System.exit(0); }
    HosRemoteConfig config = new HosRemoteConfig(args[0]);
    config.setHdcPath(args[1]); config.setIp("127.0.0.1");
    config.setScale(2); config.setFrameRate(24); config.setBitRate(2); config.setIFrameInterval(1);
    device = new HosRemoteDevice(config);
    Thread capture = new Thread(() -> {
      try {
        device.startCaptureScreen(new ScreenCapCallback() {
          public void onReady() { emit(2, new byte[0]); }
          public void onData(ByteBuffer source) {
            if (source.remaining() > 4 * 1024 * 1024) { emit(3, new byte[0]); return; }
            byte[] bytes = new byte[source.remaining()]; source.get(bytes); emit(1, bytes);
          }
          public void onException(Throwable error) { error.printStackTrace(System.err); emit(3, new byte[0]); }
        });
      } catch (Throwable error) { error.printStackTrace(System.err); emit(3, new byte[0]); }
    });
    capture.setDaemon(true); capture.start();
    // A private pipe owns this bridge. EOF, explicit close and parent death stop capture.
    while (System.in.read() != -1) { break; }
    stop(); System.exit(0);
  }
}
`;
