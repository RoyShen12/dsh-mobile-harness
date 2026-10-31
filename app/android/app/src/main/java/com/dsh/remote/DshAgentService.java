package com.dsh.remote;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.app.KeyguardManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Path;
import android.graphics.Rect;
import android.os.Build;
import android.os.Bundle;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

/**
 * The hand. Every command the computer sends through the device channel ends up here, and every
 * limit the model must not cross lives here too: own pages are never read, money apps are never
 * driven, a stale row never gets tapped, and a locked phone only allows a read.
 */
public final class DshAgentService extends AccessibilityService {

    /** A failure the computer should show as-is instead of a stack trace. */
    static final class AgentError extends Exception {
        final String code;

        AgentError(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private static volatile DshAgentService instance;

    static boolean connected() {
        return instance != null;
    }

    @Override
    public void onServiceConnected() {
        super.onServiceConnected();
        instance = this;
    }

    @Override
    public void onDestroy() {
        instance = null;
        super.onDestroy();
    }

    @Override
    public void onInterrupt() {
        // Nothing to interrupt: reads and taps are synchronous and short.
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        // Snapshots are pulled on demand; pushing every window change would be pure noise.
    }

    /**
     * Runs one command and returns its data payload.
     *
     * @throws AgentError when the command is refused for a reason the model can act on
     */
    static JSONObject execute(String op, JSONObject args) throws AgentError {
        DshAgentService service = instance;
        if (service == null) {
            throw new AgentError("not_accessible",
                    "\u65e0\u969c\u788d\u670d\u52a1\u6ca1\u5f00\uff1a\u5728\u624b\u673a\u300c\u8bbe\u7f6e \u2192 \u65e0\u969c\u788d \u2192 DSH \u8fdc\u7a0b\u300d\u6253\u5f00\u540e\u518d\u8bd5");
        }
        boolean locked = service.isLocked();
        if (locked && !"screen".equals(op)) {
            throw new AgentError("device_locked", "\u624b\u673a\u9501\u7740\uff1a\u5148\u89e3\u9501\uff0c\u6216\u53ea\u7528 screen \u770b\u9501\u5c4f");
        }
        try {
            if ("screen".equals(op)) return service.screen();
            if ("tap".equals(op)) return service.click(args, false);
            if ("long_press".equals(op)) return service.click(args, true);
            if ("type".equals(op)) return service.type(args);
            if ("key".equals(op)) return service.key(args);
            if ("scroll".equals(op)) return service.scroll(args);
            if ("open_app".equals(op)) return service.openApp(args);
        } catch (AgentError error) {
            throw error;
        } catch (Exception error) {
            String message = error.getMessage();
            throw new AgentError("action_failed", message == null || message.isEmpty() ? "\u624b\u673a\u6267\u884c\u5931\u8d25" : message);
        }
        throw new AgentError("not_supported", "\u4e0d\u652f\u6301\u7684\u64cd\u4f5c\uff1a" + op);
    }

    boolean isLocked() {
        KeyguardManager keyguard = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
        return keyguard != null && keyguard.isKeyguardLocked();
    }

    // -- read ------------------------------------------------------------------

    private JSONObject screen() throws Exception {
        String own = getPackageName();
        ScreenReader.Snapshot snapshot = ScreenReader.capture(this, own, isLocked(), labelOf(own));
        JSONObject out = new JSONObject();
        out.put("snapshotId", snapshot.id);
        out.put("app", snapshot.app);
        out.put("pkg", snapshot.pkg);
        out.put("locked", snapshot.locked);
        out.put("truncated", snapshot.truncated);
        if (own.equals(snapshot.pkg)) {
            out.put("note", "\u5f53\u524d\u662f DSH \u8fdc\u7a0b\u81ea\u5df1\u7684\u9875\u9762\uff0c\u4e0d\u8bfb");
        }
        JSONArray items = new JSONArray();
        for (ScreenReader.Item item : snapshot.items) {
            JSONObject row = new JSONObject();
            row.put("n", item.n);
            row.put("text", item.text);
            if (!item.cls.isEmpty()) row.put("cls", item.cls);
            if (item.clickable) row.put("clickable", true);
            if (item.editable) row.put("editable", true);
            if (item.scrollable) row.put("scrollable", true);
            items.put(row);
        }
        out.put("items", items);
        return out;
    }

    // -- act -------------------------------------------------------------------

    private JSONObject click(JSONObject args, boolean longPress) throws Exception {
        ScreenReader.Snapshot snapshot = currentSnapshot(args);
        int n = args.optInt("n", -1);
        ScreenReader.Item item = snapshot.find(n);
        if (item == null) {
            throw new AgentError("bad_target",
                    "\u7f16\u53f7 " + n + " \u4e0d\u5728\u8fd9\u6b21\u5feb\u7167\u91cc\uff08\u5171 " + snapshot.items.size() + " \u9879\uff09\uff1a\u91cd\u65b0 screen \u4e00\u6b21");
        }
        if (AgentGuard.blockedPackage(snapshot.pkg)) {
            throw new AgentError("blocked_by_policy",
                    "\u300c" + snapshot.app + "\u300d\u5c5e\u4e8e\u4e0d\u4ee3\u64cd\u4f5c\u7684\u5e94\u7528\uff08\u652f\u4ed8/\u94f6\u884c/\u7cfb\u7edf\u8bbe\u7f6e\uff09\uff0c\u6211\u4e0d\u70b9");
        }
        if (AgentGuard.riskyText(item.text)) {
            throw new AgentError("confirm_required",
                    "\u8fd9\u4e00\u9879\u662f\u5371\u9669\u64cd\u4f5c\uff08" + item.text + "\uff09\uff1a\u5148\u95ee\u7528\u6237\u672c\u4eba\u8981\u4e0d\u8981\u70b9");
        }
        AccessibilityNodeInfo node = item.node;
        if (node == null || !refresh(node)) {
            throw new AgentError("stale_snapshot", "\u754c\u9762\u5df2\u7ecf\u53d8\u4e86\uff1a\u91cd\u65b0 screen \u4e00\u6b21");
        }
        if (!clickNode(node, longPress)) {
            throw new AgentError("bad_target", "\u8fd9\u4e00\u9879\u70b9\u4e0d\u52a8\uff08\u53ef\u80fd\u53ea\u662f\u6587\u5b57\u6216\u88ab\u906e\u6321\uff09\uff1a\u6362\u4e2a\u7f16\u53f7");
        }
        Thread.sleep(400);
        JSONObject out = new JSONObject();
        out.put("clicked", item.text);
        out.put("n", n);
        out.put("longPress", longPress);
        return out;
    }

    private JSONObject type(JSONObject args) throws Exception {
        ScreenReader.Snapshot snapshot = currentSnapshot(args);
        int n = args.optInt("n", -1);
        String text = args.optString("text", "");
        ScreenReader.Item item = snapshot.find(n);
        if (item == null) {
            throw new AgentError("bad_target", "\u7f16\u53f7 " + n + " \u4e0d\u5728\u8fd9\u6b21\u5feb\u7167\u91cc\uff1a\u91cd\u65b0 screen \u4e00\u6b21");
        }
        AccessibilityNodeInfo node = item.node;
        if (node == null || !refresh(node)) {
            throw new AgentError("stale_snapshot", "\u754c\u9762\u5df2\u7ecf\u53d8\u4e86\uff1a\u91cd\u65b0 screen \u4e00\u6b21");
        }
        if (!node.isEditable()) {
            throw new AgentError("bad_target", "\u7f16\u53f7 " + n + " \u4e0d\u662f\u8f93\u5165\u6846\uff1a\u5148\u70b9\u4e00\u4e0b\u8f93\u5165\u6846\u518d\u8bfb\u5c4f");
        }
        Bundle setText = new Bundle();
        setText.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
        boolean ok = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, setText);
        if (!ok) ok = paste(node, text);
        if (!ok) {
            throw new AgentError("action_failed", "\u8f93\u5165\u6846\u5199\u4e0d\u8fdb\u53bb\uff1a\u5148\u8ba9\u5b83\u83b7\u5f97\u7126\u70b9\u518d\u8bd5");
        }
        Thread.sleep(200);
        JSONObject out = new JSONObject();
        out.put("typed", text);
        out.put("n", n);
        return out;
    }

    /** Fallback for editors that ignore SET_TEXT: focus, then paste through the clipboard. */
    private boolean paste(AccessibilityNodeInfo node, String text) {
        node.performAction(AccessibilityNodeInfo.ACTION_FOCUS);
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard == null) return false;
        clipboard.setPrimaryClip(ClipData.newPlainText("dsh", text));
        return node.performAction(AccessibilityNodeInfo.ACTION_PASTE);
    }

    private JSONObject key(JSONObject args) throws Exception {
        String name = args.optString("key", "").trim().toLowerCase(Locale.ROOT);
        int action;
        switch (name) {
            case "back":
                action = GLOBAL_ACTION_BACK;
                break;
            case "home":
                action = GLOBAL_ACTION_HOME;
                break;
            case "recents":
                action = GLOBAL_ACTION_RECENTS;
                break;
            case "notifications":
                action = GLOBAL_ACTION_NOTIFICATIONS;
                break;
            default:
                throw new AgentError("bad_target", "\u53ea\u652f\u6301 back / home / recents / notifications\uff1a\u6536\u5230\u4e86 " + name);
        }
        boolean ok = performGlobalAction(action);
        if (!ok) throw new AgentError("action_failed", "\u8fd9\u4e2a\u952e\u6ca1\u751f\u6548\uff1a" + name);
        Thread.sleep(300);
        JSONObject out = new JSONObject();
        out.put("key", name);
        return out;
    }

    private JSONObject scroll(JSONObject args) throws Exception {
        String direction = args.optString("direction", "forward").trim().toLowerCase(Locale.ROOT);
        boolean forward = !"backward".equals(direction) && !"up".equals(direction);
        AccessibilityNodeInfo target = null;
        ScreenReader.Snapshot snapshot = ScreenReader.last();
        int n = args.optInt("n", -1);
        if (snapshot != null && n > 0) {
            ScreenReader.Item item = snapshot.find(n);
            if (item == null) throw new AgentError("bad_target", "\u7f16\u53f7 " + n + " \u4e0d\u5728\u8fd9\u6b21\u5feb\u7167\u91cc\uff1a\u91cd\u65b0 screen \u4e00\u6b21");
            target = item.node;
        }
        if (target == null) target = findScrollable();
        if (target != null && refresh(target)) {
            int action = forward
                    ? AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
                    : AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD;
            if (target.performAction(action)) {
                Thread.sleep(400);
                JSONObject out = new JSONObject();
                out.put("scroll", forward ? "forward" : "backward");
                return out;
            }
        }
        if (!swipe(forward)) {
            throw new AgentError("action_failed", "\u8fd9\u4e00\u9875\u6eda\u4e0d\u52a8\uff1a\u53ef\u80fd\u5df2\u7ecf\u5230\u5934\u4e86");
        }
        Thread.sleep(400);
        JSONObject out = new JSONObject();
        out.put("scroll", forward ? "forward" : "backward");
        out.put("gesture", true);
        return out;
    }

    private AccessibilityNodeInfo findScrollable() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) return null;
        java.util.ArrayDeque<AccessibilityNodeInfo> stack = new java.util.ArrayDeque<>();
        stack.push(root);
        int seen = 0;
        while (!stack.isEmpty() && seen < 300) {
            AccessibilityNodeInfo node = stack.pop();
            seen += 1;
            if (node.isScrollable()) return node;
            for (int i = node.getChildCount() - 1; i >= 0; i--) {
                AccessibilityNodeInfo child = node.getChild(i);
                if (child != null) stack.push(child);
            }
        }
        return null;
    }

    /** Gesture fallback for lists that expose no scroll action (WebView, games, some chat lists). */
    private boolean swipe(boolean forward) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return false;
        android.util.DisplayMetrics metrics = getResources().getDisplayMetrics();
        float x = metrics.widthPixels / 2f;
        float top = metrics.heightPixels * 0.72f;
        float bottom = metrics.heightPixels * 0.28f;
        float from = forward ? top : bottom;
        float to = forward ? bottom : top;
        Path path = new Path();
        path.moveTo(x, from);
        path.lineTo(x, to);
        GestureDescription gesture = new GestureDescription.Builder()
                .addStroke(new GestureDescription.StrokeDescription(path, 0, 320))
                .build();
        return dispatchGesture(gesture, null, null);
    }

    private JSONObject openApp(JSONObject args) throws Exception {
        String target = args.optString("target", "").trim();
        if (target.isEmpty()) {
            throw new AgentError("bad_target", "open_app \u9700\u8981 target\uff08\u5e94\u7528\u5305\u540d\u6216\u540d\u5b57\uff09");
        }
        String pkg = resolvePackage(target);
        if (pkg == null) {
            throw new AgentError("not_found", "\u627e\u4e0d\u5230\u5e94\u7528\uff1a" + target);
        }
        if (AgentGuard.blockedPackage(pkg)) {
            throw new AgentError("blocked_by_policy", "\u300c" + labelOf(pkg) + "\u300d\u5c5e\u4e8e\u4e0d\u4ee3\u64cd\u4f5c\u7684\u5e94\u7528\uff08\u652f\u4ed8/\u94f6\u884c/\u7cfb\u7edf\u8bbe\u7f6e\uff09");
        }
        Intent launch = getPackageManager().getLaunchIntentForPackage(pkg);
        if (launch == null) {
            throw new AgentError("not_found", "\u300c" + labelOf(pkg) + "\u300d\u6ca1\u6709\u53ef\u6253\u5f00\u7684\u9875\u9762");
        }
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
        Thread.sleep(700);
        JSONObject out = new JSONObject();
        out.put("opened", labelOf(pkg));
        out.put("pkg", pkg);
        return out;
    }

    /** Accepts an exact package name or a piece of the launcher label, e.g. 微信 / wechat / com.tencent.mm. */
    private String resolvePackage(String target) {
        PackageManager manager = getPackageManager();
        String needle = target.toLowerCase(Locale.ROOT);
        if (target.indexOf('.') > 0 && target.indexOf(' ') < 0) {
            try {
                manager.getPackageInfo(target, 0);
                return target;
            } catch (Exception ignored) {
                // Not an installed package name; fall through to the label search.
            }
        }
        Intent launcher = new Intent(Intent.ACTION_MAIN);
        launcher.addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> apps = manager.queryIntentActivities(launcher, 0);
        String partial = null;
        for (ResolveInfo info : apps) {
            if (info.activityInfo == null) continue;
            String pkg = info.activityInfo.packageName;
            String label = labelOf(pkg).toLowerCase(Locale.ROOT);
            if (label.equals(needle) || pkg.equalsIgnoreCase(target) || label.contains(needle)) {
                if (label.equals(needle) || pkg.equalsIgnoreCase(target)) return pkg;
                if (partial == null) partial = pkg;
            }
        }
        return partial;
    }

    private String labelOf(String pkg) {
        try {
            PackageManager manager = getPackageManager();
            return manager.getApplicationLabel(manager.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception ignored) {
            return pkg;
        }
    }

    // -- helpers ---------------------------------------------------------------

    /** Rejects a command aimed at a screen that has since changed or aged out. */
    private ScreenReader.Snapshot currentSnapshot(JSONObject args) throws AgentError {
        ScreenReader.Snapshot snapshot = ScreenReader.last();
        if (snapshot == null) {
            throw new AgentError("stale_snapshot", "\u8fd8\u6ca1\u6709\u5c4f\u5e55\u5feb\u7167\uff1a\u5148\u8c03\u7528 phone screen \u8bfb\u5c4f");
        }
        String id = args.optString("snapshotId", "");
        if (!id.isEmpty() && !id.equals(snapshot.id)) {
            throw new AgentError("stale_snapshot", "\u5feb\u7167\u5df2\u8fc7\u671f\uff08\u754c\u9762\u53d8\u4e86\uff09\uff1a\u91cd\u65b0\u8c03\u7528 phone screen");
        }
        if (snapshot.expired()) {
            throw new AgentError("stale_snapshot", "\u5feb\u7167\u8d85\u8fc7 60 \u79d2\uff1a\u91cd\u65b0\u8c03\u7528 phone screen");
        }
        return snapshot;
    }

    private boolean refresh(AccessibilityNodeInfo node) {
        try {
            return node.refresh();
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Clicks the row itself or the nearest clickable ancestor, which is where the listener lives. */
    private boolean clickNode(AccessibilityNodeInfo node, boolean longPress) {
        AccessibilityNodeInfo candidate = node;
        for (int depth = 0; candidate != null && depth < 6; depth++) {
            if (candidate.isClickable()) {
                int action = longPress
                        ? AccessibilityNodeInfo.ACTION_LONG_CLICK
                        : AccessibilityNodeInfo.ACTION_CLICK;
                return candidate.performAction(action);
            }
            candidate = candidate.getParent();
        }
        return false;
    }
}
