package com.dsh.remote;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.ArrayAdapter;
import android.widget.ListView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Receives streamed downloads from the WebView and keeps a small on-device history.
 *
 * The gateway session cookie is HttpOnly, so the system DownloadManager cannot fetch the file
 * with the page's credentials. The page therefore reads the bytes itself (it is same-origin and
 * already authenticated) and pushes them here in base64 chunks. Completed files land in the
 * phone's public Download/DSH folder on Android 10+ (app-private on older releases) and every
 * finished file is listed in 「下载记录」 so it can be reopened or deleted later.
 */
final class DownloadCenter {

    private static final String PREFS = "dsh-remote";
    private static final String HISTORY_KEY = "downloads";
    private static final int MAX_HISTORY = 100;

    private final Activity activity;
    private final Map<String, Sink> sinks = new ConcurrentHashMap<>();

    DownloadCenter(Activity activity) {
        this.activity = activity;
    }

    private static final class Sink {
        String id;
        String name;
        String mime;
        long total;
        long written;
        long createdAt;
        OutputStream stream;
        Uri uri;
        File file;
    }

    // ── streaming ───────────────────────────────────────────────────────────

    String begin(String name, String mime, long total) {
        String safeName = sanitize(name);
        String safeMime = mime == null || mime.trim().isEmpty() ? "application/octet-stream" : mime.trim();
        try {
            Sink sink = openSink(safeName, safeMime);
            sink.id = UUID.randomUUID().toString();
            sink.name = safeName;
            sink.mime = safeMime;
            sink.total = total;
            sink.createdAt = System.currentTimeMillis();
            sinks.put(sink.id, sink);
            toast("开始下载：" + safeName);
            return sink.id;
        } catch (Exception error) {
            toast("无法开始下载：" + error.getMessage());
            return "";
        }
    }

    void append(String id, String base64) {
        if (id == null || base64 == null || base64.isEmpty()) return;
        Sink sink = sinks.get(id);
        if (sink == null) return;
        try {
            byte[] chunk = Base64.decode(base64, Base64.DEFAULT);
            synchronized (sink) {
                sink.stream.write(chunk);
                sink.written += chunk.length;
            }
        } catch (Exception error) {
            abort(id);
            toast("写入失败：" + error.getMessage());
        }
    }

    void finish(String id) {
        Sink sink = sinks.remove(id);
        if (sink == null) return;
        try {
            sink.stream.flush();
            sink.stream.close();
            if (sink.uri != null) {
                ContentValues done = new ContentValues();
                done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                activity.getContentResolver().update(sink.uri, done, null, null);
            }
            record(sink);
            toast("已保存到 下载/DSH：" + sink.name);
        } catch (Exception error) {
            deleteQuietly(sink);
            toast("保存失败：" + error.getMessage());
        }
    }

    void abort(String id) {
        Sink sink = sinks.remove(id);
        if (sink == null) return;
        deleteQuietly(sink);
        toast("下载已取消");
    }

    private Sink openSink(String name, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/DSH");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = activity.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("无法创建媒体库条目");
            OutputStream stream = activity.getContentResolver().openOutputStream(uri);
            if (stream == null) {
                activity.getContentResolver().delete(uri, null, null);
                throw new Exception("无法打开目标文件");
            }
            Sink sink = new Sink();
            sink.uri = uri;
            sink.stream = stream;
            return sink;
        }
        File dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = new File(activity.getFilesDir(), "Download");
        File folder = new File(dir, "DSH");
        if (!folder.exists() && !folder.mkdirs()) throw new Exception("无法创建下载目录");
        File target = uniqueFile(folder, name);
        Sink sink = new Sink();
        sink.file = target;
        sink.stream = new FileOutputStream(target);
        return sink;
    }

    private static File uniqueFile(File folder, String name) {
        File candidate = new File(folder, name);
        if (!candidate.exists()) return candidate;
        int dot = name.lastIndexOf('.');
        String stem = dot > 0 ? name.substring(0, dot) : name;
        String suffix = dot > 0 ? name.substring(dot) : "";
        for (int attempt = 1; attempt < 500; attempt++) {
            File next = new File(folder, stem + " (" + attempt + ")" + suffix);
            if (!next.exists()) return next;
        }
        return new File(folder, stem + "-" + System.currentTimeMillis() + suffix);
    }

    private void deleteQuietly(Sink sink) {
        try {
            sink.stream.close();
        } catch (Exception ignored) {
            // best effort
        }
        try {
            if (sink.uri != null) activity.getContentResolver().delete(sink.uri, null, null);
            else if (sink.file != null) sink.file.delete();
        } catch (Exception ignored) {
            // best effort
        }
    }

    // ── history ─────────────────────────────────────────────────────────────

    private SharedPreferences prefs() {
        return activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private void record(Sink sink) {
        try {
            JSONObject entry = new JSONObject();
            entry.put("id", sink.id);
            entry.put("name", sink.name);
            entry.put("mime", sink.mime);
            entry.put("size", sink.written);
            entry.put("at", sink.createdAt);
            entry.put("uri", sink.uri != null ? sink.uri.toString() : "");
            entry.put("path", sink.file != null ? sink.file.getAbsolutePath() : "");
            List<JSONObject> items = readHistory();
            items.add(0, entry);
            JSONArray array = new JSONArray();
            for (int index = 0; index < Math.min(items.size(), MAX_HISTORY); index++) array.put(items.get(index));
            prefs().edit().putString(HISTORY_KEY, array.toString()).apply();
        } catch (Exception ignored) {
            // A missing history entry must never fail the download itself.
        }
    }

    private List<JSONObject> readHistory() {
        List<JSONObject> items = new ArrayList<>();
        String raw = prefs().getString(HISTORY_KEY, "");
        if (raw == null || raw.isEmpty()) return items;
        try {
            JSONArray array = new JSONArray(raw);
            for (int index = 0; index < array.length(); index++) {
                JSONObject entry = array.optJSONObject(index);
                if (entry != null) items.add(entry);
            }
        } catch (Exception ignored) {
            // corrupted history: start over
        }
        return items;
    }

    private void writeHistory(List<JSONObject> items) {
        JSONArray array = new JSONArray();
        for (JSONObject entry : items) array.put(entry);
        prefs().edit().putString(HISTORY_KEY, array.toString()).apply();
    }

    String listJson() {
        JSONArray array = new JSONArray();
        for (JSONObject entry : readHistory()) array.put(entry);
        return array.toString();
    }

    // ── history UI ──────────────────────────────────────────────────────────

    void show() {
        activity.runOnUiThread(() -> {
            final List<JSONObject> items = readHistory();
            if (items.isEmpty()) {
                toast("还没有下载记录");
                return;
            }
            final List<String> labels = new ArrayList<>();
            for (JSONObject entry : items) labels.add(label(entry));
            ArrayAdapter<String> adapter = new ArrayAdapter<>(activity, android.R.layout.simple_list_item_1, labels);
            AlertDialog dialog = new AlertDialog.Builder(activity)
                    .setTitle("下载记录")
                    .setAdapter(adapter, (which, index) -> open(items.get(index)))
                    .setPositiveButton("关闭", null)
                    .setNeutralButton("清空记录", (which, index) -> confirmClear())
                    .create();
            dialog.show();
            ListView list = dialog.getListView();
            if (list != null) {
                list.setOnItemLongClickListener((parent, view, position, id) -> {
                    confirmDelete(items.get(position));
                    return true;
                });
            }
        });
    }

    private String label(JSONObject entry) {
        String name = entry.optString("name", "文件");
        long size = entry.optLong("size", 0L);
        long at = entry.optLong("at", 0L);
        String time = new SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(new Date(at));
        return name + "\n" + humanSize(size) + " · " + time;
    }

    private static String humanSize(long bytes) {
        if (bytes >= 1024L * 1024L) return String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0));
        if (bytes >= 1024L) return String.format(Locale.US, "%.0f KB", bytes / 1024.0);
        return bytes + " B";
    }

    void open(int index) {
        try {
            open(readHistory().get(index));
        } catch (Exception ignored) {
            // index vanished (history cleared concurrently)
        }
    }

    private void open(JSONObject entry) {
        try {
            Uri uri = uriFor(entry);
            if (uri == null) {
                toast("文件已被删除");
                return;
            }
            String mime = entry.optString("mime", "application/octet-stream");
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
        } catch (Exception error) {
            toast("没有能打开该文件的应用");
        }
    }

    private Uri uriFor(JSONObject entry) {
        String raw = entry.optString("uri", "");
        if (raw.startsWith("content://")) return Uri.parse(raw);
        String path = entry.optString("path", "");
        if (path.isEmpty()) return null;
        File file = new File(path);
        if (!file.exists()) return null;
        return FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
    }

    private void confirmDelete(JSONObject entry) {
        new AlertDialog.Builder(activity)
                .setMessage("删除这份下载记录？" + "\n" + entry.optString("name", "") + "\n（同时删除手机里的文件）")
                .setPositiveButton("删除", (dialog, which) -> remove(entry))
                .setNegativeButton("取消", null)
                .show();
    }

    private void remove(JSONObject entry) {
        String raw = entry.optString("uri", "");
        try {
            if (raw.startsWith("content://")) {
                activity.getContentResolver().delete(Uri.parse(raw), null, null);
            } else {
                String path = entry.optString("path", "");
                if (!path.isEmpty()) new File(path).delete();
            }
        } catch (Exception ignored) {
            // file already gone
        }
        List<JSONObject> items = readHistory();
        items.remove(entry);
        writeHistory(items);
        toast("已删除");
    }

    private void confirmClear() {
        new AlertDialog.Builder(activity)
                .setMessage("清空下载记录？（手机里的文件会保留）")
                .setPositiveButton("清空", (dialog, which) -> {
                    writeHistory(new ArrayList<>());
                    toast("已清空记录");
                })
                .setNegativeButton("取消", null)
                .show();
    }

    /**
     * Fallback for downloads the page hook cannot stream (e.g. a URL opened by a script).
     * The gateway cookie is copied on a best-effort basis, so this path may still be refused by
     * the gateway when the session cookie is HttpOnly only.
     */
    void nativeDownload(String url, String name) {
        try {
            String safeName = sanitize(name);
            android.app.DownloadManager.Request request = new android.app.DownloadManager.Request(Uri.parse(url));
            request.setTitle(safeName);
            request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "DSH/" + safeName);
            String cookie = android.webkit.CookieManager.getInstance().getCookie(url);
            if (cookie != null && !cookie.isEmpty()) request.addRequestHeader("Cookie", cookie);
            android.app.DownloadManager manager =
                    (android.app.DownloadManager) activity.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                toast("系统下载器不可用");
                return;
            }
            manager.enqueue(request);
            toast("已交给系统下载：" + safeName);
        } catch (Exception error) {
            toast("下载失败：" + error.getMessage());
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static String sanitize(String name) {
        String value = name == null ? "" : name.trim();
        if (value.isEmpty()) value = "download.bin";
        value = value.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (value.length() > 120) {
            int dot = value.lastIndexOf('.');
            if (dot > 0) value = value.substring(0, 100) + value.substring(dot);
            else value = value.substring(0, 120);
        }
        return value;
    }

    private void toast(String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_SHORT).show());
    }
}
