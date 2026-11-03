package com.dsh.remote;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Rect;
import android.view.accessibility.AccessibilityNodeInfo;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Random;

/**
 * Turns whatever is on screen into a short, numbered list the model can point at.
 *
 * <p>Numbers only mean something inside one snapshot: the list is rebuilt on every read, and a
 * command that arrives later than {@link #SNAPSHOT_TTL_MS} (or after the screen moved on) is
 * rejected instead of hitting the wrong row.
 */
final class ScreenReader {

    static final int MAX_ITEMS = 60;
    static final int MAX_TEXT_CHARS = 60;
    static final int MAX_NODES = 900;
    static final long SNAPSHOT_TTL_MS = 60000L;

    private static final String PASSWORD_MASK = "\u2022\u2022\u2022\u2022";
    private static final Random RANDOM = new Random();

    /** One addressable row of the current screen. */
    static final class Item {
        final int n;
        final String text;
        final String cls;
        final boolean clickable;
        final boolean editable;
        final boolean scrollable;
        final Rect bounds;
        final AccessibilityNodeInfo node;

        Item(int n, String text, String cls, boolean clickable, boolean editable, boolean scrollable,
             Rect bounds, AccessibilityNodeInfo node) {
            this.n = n;
            this.text = text;
            this.cls = cls;
            this.clickable = clickable;
            this.editable = editable;
            this.scrollable = scrollable;
            this.bounds = bounds;
            this.node = node;
        }
    }

    /** The screen as it looked at one moment; {@code id} ties later commands back to it. */
    static final class Snapshot {
        final String id;
        final long at;
        final String pkg;
        final String app;
        final boolean locked;
        final boolean truncated;
        final List<Item> items;

        Snapshot(String id, long at, String pkg, String app, boolean locked, boolean truncated, List<Item> items) {
            this.id = id;
            this.at = at;
            this.pkg = pkg;
            this.app = app;
            this.locked = locked;
            this.truncated = truncated;
            this.items = items;
        }

        Item find(int n) {
            for (Item item : items) {
                if (item.n == n) return item;
            }
            return null;
        }

        boolean expired() {
            return System.currentTimeMillis() - at > SNAPSHOT_TTL_MS;
        }
    }

    private static Snapshot last;

    static synchronized Snapshot remember(Snapshot snapshot) {
        last = snapshot;
        return snapshot;
    }

    static synchronized Snapshot last() {
        return last;
    }

    static synchronized void invalidate() {
        last = null;
    }

    /**
     * Reads the active window. {@code ownPackage} is skipped entirely: the app's own pages carry the
     * pairing code and the access password, and a screen reader must never hand those back.
     */
    static Snapshot capture(AccessibilityService service, String ownPackage, boolean locked, String appLabel) {
        List<Item> items = new ArrayList<>();
        AccessibilityNodeInfo root = null;
        try {
            root = service.getRootInActiveWindow();
        } catch (Exception ignored) {
            // The active window can vanish mid-call; an empty snapshot is the honest answer.
        }

        String pkg = "";
        boolean truncated = false;
        if (root != null) {
            pkg = textOf(root.getPackageName());
            truncated = walk(root, ownPackage, items);
        }

        String app = appLabel == null || appLabel.isEmpty() ? pkg : appLabel;
        String id = "s" + Long.toString(System.currentTimeMillis(), 36) + Integer.toHexString(RANDOM.nextInt(4096));
        return remember(new Snapshot(id, System.currentTimeMillis(), pkg, app, locked, truncated, items));
    }

    /** Depth-first walk: parents before children, which is how a person reads a screen. */
    private static boolean walk(AccessibilityNodeInfo root, String ownPackage, List<Item> items) {
        Deque<AccessibilityNodeInfo> stack = new ArrayDeque<>();
        stack.push(root);
        int seen = 0;
        while (!stack.isEmpty()) {
            AccessibilityNodeInfo node = stack.pop();
            seen += 1;
            if (seen > MAX_NODES) return true;

            String nodePackage = textOf(node.getPackageName());
            if (ownPackage != null && ownPackage.equals(nodePackage)) continue;

            if (items.size() >= MAX_ITEMS) return true;

            String text = nodeText(node);
            boolean clickable = node.isClickable();
            boolean editable = node.isEditable();
            boolean scrollable = node.isScrollable();
            if (!text.isEmpty() || clickable || editable) {
                Rect bounds = new Rect();
                node.getBoundsInScreen(bounds);
                items.add(new Item(items.size() + 1, text, shortClass(node), clickable, editable,
                        scrollable, bounds, node));
            }

            int count = node.getChildCount();
            for (int i = count - 1; i >= 0; i--) {
                AccessibilityNodeInfo child = null;
                try {
                    child = node.getChild(i);
                } catch (Exception ignored) {
                    // A stale child throws; the rest of the tree is still readable.
                }
                if (child != null) stack.push(child);
            }
        }
        return false;
    }

    /** Visible label first, then the accessibility description, then the input hint. */
    private static String nodeText(AccessibilityNodeInfo node) {
        String text = textOf(node.getText());
        if (text.isEmpty()) text = textOf(node.getContentDescription());
        if (text.isEmpty() && node.isEditable()) {
            CharSequence hint = null;
            try {
                hint = node.getHintText();
            } catch (Exception ignored) {
                // getHintText needs API 26; older phones simply have no hint.
            }
            text = textOf(hint);
        }
        if (node.isPassword() && !text.isEmpty()) return PASSWORD_MASK;
        return shorten(text);
    }

    private static String shorten(String text) {
        if (text.length() <= MAX_TEXT_CHARS) return text;
        return text.substring(0, MAX_TEXT_CHARS - 1) + "\u2026";
    }

    private static String textOf(CharSequence value) {
        if (value == null) return "";
        return value.toString().replace('\n', ' ').trim();
    }

    private static String shortClass(AccessibilityNodeInfo node) {
        String name = textOf(node.getClassName());
        int dot = name.lastIndexOf('.');
        return dot >= 0 ? name.substring(dot + 1) : name;
    }
}
