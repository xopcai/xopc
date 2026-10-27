package ai.xopc.phone;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.UiAutomation;
import android.graphics.Rect;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.Bundle;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import org.json.JSONObject;
import android.util.Xml;
import android.view.accessibility.AccessibilityNodeInfo;
import java.io.StringWriter;
import org.xmlpull.v1.XmlSerializer;

/** One accessibility owner; request-time snapshots and guarded native field transactions. */
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

    private static void clearCache(UiAutomation automation) throws Exception {
        try { UiAutomation.class.getMethod("clearCache").invoke(automation); }
        catch (NoSuchMethodException oldAndroid) {
            Class<?> client = Class.forName("android.view.accessibility.AccessibilityInteractionClient");
            Object instance = client.getMethod("getInstance").invoke(null);
            client.getMethod("clearCache").invoke(instance);
        }
    }

    private static String snapshot(UiAutomation automation) throws Exception {
        clearCache(automation);
        AccessibilityNodeInfo root = null;
        for (int i = 0; i < 20 && root == null; i++) {
            root = automation.getRootInActiveWindow();
            if (root == null) Thread.sleep(50);
        }
        if (root == null) throw new IllegalStateException("no-root");
        nodes = 0;
        StringWriter output = new StringWriter();
        XmlSerializer xml = Xml.newSerializer();
        xml.setOutput(output);
        xml.startDocument("UTF-8", true);
        xml.startTag(null, "hierarchy");
        dump(xml, root, 0);
        xml.endTag(null, "hierarchy");
        xml.endDocument();
        return output.toString();
    }

    private static String stableSnapshot(UiAutomation automation) throws Exception {
        String previous = snapshot(automation);
        // Observe a bounded quiet window without waiting indefinitely for global UI idle.
        for (int i = 0; i < 3; i++) {
            Thread.sleep(50);
            String current = snapshot(automation);
            if (current.equals(previous)) return current;
            previous = current;
        }
        return previous;
    }

    private static AccessibilityNodeInfo editor(UiAutomation automation, JSONObject request, boolean checkBounds) throws Exception {
        clearCache(automation);
        AccessibilityNodeInfo root = null;
        for (int i = 0; i < 20 && root == null; i++) {
            root = automation.getRootInActiveWindow();
            if (root == null) Thread.sleep(50);
        }
        if (root == null) throw new IllegalStateException("no-root");
        try {
            if (!request.getString("app").equals(String.valueOf(root.getPackageName()))) throw new IllegalStateException("app");
            AccessibilityNodeInfo field = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (field == null) throw new IllegalStateException("focus");
            Rect bounds = new Rect(); field.getBoundsInScreen(bounds);
            String identity = bounds.left + "," + bounds.top + "," + bounds.right + "," + bounds.bottom;
            if (!field.isEditable() || field.isPassword() || !field.isVisibleToUser() || !field.isEnabled()
                || !request.getString("app").equals(String.valueOf(field.getPackageName()))
                || !request.getString("resourceId").equals(text(field.getViewIdResourceName(), 500))
                || (checkBounds && !request.getString("bounds").equals(identity))) {
                field.recycle(); throw new IllegalStateException("target");
            }
            return field;
        } finally { root.recycle(); }
    }

    private static void setText(UiAutomation automation, JSONObject request) throws Exception {
        AccessibilityNodeInfo original = editor(automation, request, true);
        String expected = request.getString("before");
        String value = request.getString("text");
        try {
            if (value.length() > 4000 || !expected.equals(text(original.getText(), 4001))) throw new IllegalStateException("value");
            Bundle arguments = new Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value);
            if (!original.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) throw new IllegalStateException("write");
            // Text can resize a multiline editor. Require the same native node after the write.
            for (int i = 0; i < 5; i++) {
                Thread.sleep(30);
                AccessibilityNodeInfo current = editor(automation, request, false);
                try {
                    if (!original.equals(current)) throw new IllegalStateException("identity");
                    if (value.equals(text(current.getText(), 4001))) return;
                } finally { current.recycle(); }
            }
            throw new IllegalStateException("confirmation");
        } finally { original.recycle(); }
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
            if (args.length > 0 && args[0].equals("--resident")) {
                BufferedReader input = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
                String line;
                while ((line = input.readLine()) != null) {
                    if (line.length() > 65536) break;
                    JSONObject request = new JSONObject(line);
                    if (request.getString("op").equals("close")) break;
                    JSONObject response = new JSONObject().put("id", request.getInt("id"));
                    try {
                        if (request.getString("op").equals("snapshot")) response.put("xml", stableSnapshot(automation));
                        else if (request.getString("op").equals("setText")) setText(automation, request);
                        else throw new IllegalStateException("unsupported");
                        response.put("ok", true);
                    } catch (Exception error) {
                        // Fixed codes only: never echo editor values or system exception messages.
                        String reason = error.getMessage();
                        if (!java.util.Arrays.asList("no-root", "app", "focus", "target", "value", "write", "identity", "confirmation").contains(reason)) reason = "unconfirmed";
                        response.put("ok", false).put("error", reason);
                    }
                    System.out.println(response.toString());
                    System.out.flush();
                }
            } else System.out.println(snapshot(automation));
        } finally {
            if (connected) UiAutomation.class.getMethod("disconnect").invoke(automation);
            thread.quitSafely();
        }
    }
}
