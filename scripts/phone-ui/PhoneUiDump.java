package ai.xopc.phone;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.HandlerThread;
import android.os.Looper;
import android.util.Xml;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

/** Read-only, one-shot accessibility snapshot without waiting for global UI idle. */
public final class PhoneUiDump {
    private static int nodes;

    private static String text(CharSequence value, int limit) {
        if (value == null) return "";
        String result = value.toString();
        return result.substring(0, Math.min(result.length(), limit));
    }

    private static void dump(XmlSerializer xml, AccessibilityNodeInfo node, int depth) throws Exception {
        if (node == null) return;
        try {
            if (depth > 50 || nodes >= 500 || !node.isVisibleToUser()) return;
            nodes++;
            Rect bounds = new Rect();
            node.getBoundsInScreen(bounds);
            xml.startTag(null, "node");
            xml.attribute(null, "package", text(node.getPackageName(), 300));
            xml.attribute(null, "class", text(node.getClassName(), 300));
            xml.attribute(null, "resource-id", text(node.getViewIdResourceName(), 500));
            xml.attribute(null, "password", String.valueOf(node.isPassword()));
            xml.attribute(null, "text", node.isPassword() ? "" : text(node.getText(), 500));
            xml.attribute(null, "content-desc", node.isPassword() ? "" : text(node.getContentDescription(), 300));
            xml.attribute(null, "clickable", String.valueOf(node.isClickable()));
            xml.attribute(null, "focused", String.valueOf(node.isFocused()));
            xml.attribute(null, "bounds", "[" + Math.max(0, bounds.left) + "," + Math.max(0, bounds.top) + "][" + Math.max(0, bounds.right) + "," + Math.max(0, bounds.bottom) + "]");
            for (int i = 0; i < node.getChildCount() && nodes < 500; i++) dump(xml, node.getChild(i), depth + 1);
            xml.endTag(null, "node");
        } finally { node.recycle(); }
    }

    public static void main(String[] args) throws Exception {
        // Newer Android accessibility clients create handlers on the main looper.
        if (Looper.getMainLooper() == null) Looper.prepareMainLooper();
        HandlerThread thread = new HandlerThread("xopc-phone-observation");
        thread.start();
        UiAutomation automation = null;
        boolean connected = false;
        try {
            Class<?> connectionType = Class.forName("android.app.IUiAutomationConnection");
            Object connection = Class.forName("android.app.UiAutomationConnection").getDeclaredConstructor().newInstance();
            automation = (UiAutomation) UiAutomation.class.getDeclaredConstructor(Looper.class, connectionType).newInstance(thread.getLooper(), connection);
            // Preserve the user's accessibility services while taking this temporary snapshot.
            UiAutomation.class.getMethod("connect", int.class).invoke(automation, 1);
            connected = true;
            AccessibilityServiceInfo info = automation.getServiceInfo();
            info.flags |= AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
            info.flags &= ~AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS;
            automation.setServiceInfo(info);
            AccessibilityNodeInfo root = null;
            for (int i = 0; i < 20 && root == null; i++) {
                root = automation.getRootInActiveWindow();
                if (root == null) Thread.sleep(50);
            }
            if (root == null) throw new IllegalStateException("No active accessibility root");
            StringWriter output = new StringWriter();
            XmlSerializer xml = Xml.newSerializer();
            xml.setOutput(output);
            xml.startDocument("UTF-8", true);
            xml.startTag(null, "hierarchy");
            dump(xml, root, 0);
            xml.endTag(null, "hierarchy");
            xml.endDocument();
            System.out.println(output.toString());
        } finally {
            if (connected) UiAutomation.class.getMethod("disconnect").invoke(automation);
            thread.quitSafely();
        }
    }
}
